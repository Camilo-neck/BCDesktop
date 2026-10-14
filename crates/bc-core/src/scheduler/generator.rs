use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashSet};

use serde::{Deserialize, Serialize};

use super::{Constraints, Preferences, Selection, TimeOfDay};
use crate::model::{Course, Day};
use crate::week::{gap_minutes, span, WeekMask, SLOT_MINUTES};

/// Upper bound on search nodes; keeps the UI responsive on huge inputs.
const NODE_BUDGET: u64 = 4_000_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub courses: Vec<Course>,
    #[serde(default)]
    pub constraints: Constraints,
    #[serde(default)]
    pub preferences: Preferences,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    40
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub gap_minutes: u32,
    pub days: u8,
    pub credits: u32,
    pub earliest: u16,
    pub latest: u16,
    pub favorites: u32,
    pub min_spots: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSchedule {
    pub selections: Vec<Selection>,
    /// Courses left out of this schedule (only when not all of them fit).
    pub omitted: Vec<String>,
    pub score: f64,
    pub metrics: Metrics,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unschedulable {
    pub code: String,
    pub name: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResult {
    pub schedules: Vec<GeneratedSchedule>,
    /// Courses with no group left after applying the constraints.
    pub unschedulable: Vec<Unschedulable>,
    /// True when every schedulable course is in every result.
    pub complete: bool,
    pub explored: u64,
    /// True when the node budget ran out before the search finished.
    pub truncated: bool,
}

struct Candidate {
    group_id: String,
    mask: WeekMask,
    spots: Option<u32>,
    favorite: bool,
}

struct Slot {
    code: String,
    credits: u32,
    candidates: Vec<Candidate>,
    /// The student fixed this course's group, so no result may leave it out.
    locked: bool,
}

/// Heap entry ordered by score so the worst kept schedule is on top.
struct Ranked(f64, GeneratedSchedule);

impl PartialEq for Ranked {
    fn eq(&self, o: &Self) -> bool {
        self.0.total_cmp(&o.0) == Ordering::Equal
    }
}
impl Eq for Ranked {}
impl PartialOrd for Ranked {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Ranked {
    fn cmp(&self, o: &Self) -> Ordering {
        self.0.total_cmp(&o.0)
    }
}

fn forbidden_mask(c: &Constraints) -> WeekMask {
    let mut m = WeekMask::EMPTY;
    if !c.days.is_empty() {
        for d in Day::ALL.iter().filter(|d| !c.days.contains(d)) {
            m.union_with(&WeekMask::whole_day(*d));
        }
    }
    if let Some((from, to)) = c.window {
        m.union_with(&WeekMask::outside_window(from, to));
    }
    for b in &c.blocks {
        m.add_range(b.day, b.start, b.end);
    }
    m
}

/// Why `course` has no candidate group left, for the student.
fn empty_reason(course: &Course, locked: Option<&Selection>, mut filters: Vec<&str>) -> String {
    if course.groups.is_empty() {
        return "No tiene grupos publicados".to_owned();
    }
    if let Some(l) = locked {
        return format!("El grupo {} que fijaste ya no se ofrece", l.group_id);
    }
    filters.sort_unstable();
    filters.dedup();
    format!("Ningún grupo cumple los filtros ({})", filters.join(", "))
}

fn build_slots(req: &GenerateRequest) -> (Vec<Slot>, Vec<Unschedulable>) {
    let c = &req.constraints;
    let forbidden = forbidden_mask(c);
    let excluded: HashSet<&Selection> = c.excluded.iter().collect();
    let favorites: HashSet<&Selection> = req.preferences.favorites.iter().collect();
    let mut slots = Vec::new();
    let mut unschedulable = Vec::new();
    let mut seen = HashSet::new();
    // Weeks of the locked groups kept so far, with their course name, to report locks that collide.
    let mut locked_masks: Vec<(WeekMask, &str)> = Vec::new();

    for course in &req.courses {
        if !seen.insert(course.code.as_str()) {
            continue;
        }
        let locked = c.locked.iter().find(|s| s.course_code == course.code);
        let mut reasons = Vec::new();
        let candidates: Vec<Candidate> = course
            .groups
            .iter()
            .filter(|g| {
                let sel = Selection {
                    course_code: course.code.clone(),
                    group_id: g.id.clone(),
                };
                if let Some(l) = locked {
                    return l.group_id == g.id;
                }
                if excluded.contains(&sel) {
                    reasons.push("excluido");
                    return false;
                }
                if c.only_with_spots && g.spots == Some(0) {
                    reasons.push("sin cupos");
                    return false;
                }
                if WeekMask::from_sessions(&g.sessions).intersects(&forbidden) {
                    reasons.push("fuera de tus días u horas");
                    return false;
                }
                true
            })
            .map(|g| {
                let sel = Selection {
                    course_code: course.code.clone(),
                    group_id: g.id.clone(),
                };
                Candidate {
                    group_id: g.id.clone(),
                    mask: WeekMask::from_sessions(&g.sessions),
                    spots: g.spots,
                    favorite: favorites.contains(&sel),
                }
            })
            .collect();

        let clash = locked
            .and(candidates.first())
            .and_then(|cand| locked_masks.iter().find(|(m, _)| m.intersects(&cand.mask)));
        let reason = if candidates.is_empty() {
            Some(empty_reason(course, locked, reasons))
        } else {
            clash.map(|(_, name)| format!("Choca con el grupo fijado de {name}"))
        };
        if let Some(reason) = reason {
            unschedulable.push(Unschedulable {
                code: course.code.clone(),
                name: course.name.clone(),
                reason,
            });
            continue;
        }
        if locked.is_some() {
            locked_masks.push((candidates[0].mask, course.name.as_str()));
        }
        slots.push(Slot {
            code: course.code.clone(),
            credits: course.credits as u32,
            candidates,
            locked: locked.is_some(),
        });
    }
    // Fail-first: the most constrained course is decided first.
    slots.sort_by_key(|s| s.candidates.len());
    (slots, unschedulable)
}

struct Search<'a> {
    slots: &'a [Slot],
    prefs: &'a Preferences,
    max_credits: u32,
    limit: usize,
    allow_skip: bool,
    best_count: usize,
    heap: BinaryHeap<Ranked>,
    chosen: Vec<Option<usize>>,
    explored: u64,
    truncated: bool,
    /// Slots outside the preferred time of day, built once per search.
    off_hours: Option<WeekMask>,
}

fn preferred_window(t: TimeOfDay) -> Option<(u16, u16)> {
    match t {
        TimeOfDay::Any => None,
        TimeOfDay::Morning => Some((6 * 60, 13 * 60)),
        TimeOfDay::Afternoon => Some((12 * 60, 18 * 60)),
        TimeOfDay::Evening => Some((17 * 60, 22 * 60)),
    }
}

impl Search<'_> {
    /// Score and metrics of the current choice. Allocates nothing: it runs for every complete
    /// schedule the search reaches, and most of them are discarded.
    fn score(&self, mask: &WeekMask) -> (f64, Metrics) {
        let mut credits = 0;
        let mut favorites = 0;
        let mut min_spots: Option<u32> = None;
        let mut spot_penalty = 0.0;
        for (slot, pick) in self.slots.iter().zip(&self.chosen) {
            let Some(i) = pick else { continue };
            let cand = &slot.candidates[*i];
            credits += slot.credits;
            favorites += cand.favorite as u32;
            if let Some(s) = cand.spots {
                min_spots = Some(min_spots.map_or(s, |m| m.min(s)));
                spot_penalty += 10.0 / (1.0 + s as f64);
            }
        }
        let gaps = gap_minutes(mask);
        let days = mask.days().count_ones() as u8;
        let (earliest, latest) = span(mask).unwrap_or((0, 0));
        let off_hours = self
            .off_hours
            .map(|outside| mask.intersection_count(&outside) as f64 * SLOT_MINUTES as f64 / 60.0)
            .unwrap_or(0.0);

        let score =
            self.prefs.gaps * gaps as f64 / 60.0 + self.prefs.days * days as f64 + 0.5 * off_hours
                - 1.5 * favorites as f64
                + self.prefs.spots * spot_penalty;
        let metrics = Metrics {
            gap_minutes: gaps,
            days,
            credits,
            earliest,
            latest,
            favorites,
            min_spots,
        };
        ((score * 100.0).round() / 100.0, metrics)
    }

    /// The full result for the current choice, copying the course and group ids it lists.
    fn schedule(&self, score: f64, metrics: Metrics) -> GeneratedSchedule {
        let mut selections = Vec::new();
        let mut omitted = Vec::new();
        for (slot, pick) in self.slots.iter().zip(&self.chosen) {
            match pick {
                Some(i) => selections.push(Selection {
                    course_code: slot.code.clone(),
                    group_id: slot.candidates[*i].group_id.clone(),
                }),
                None => omitted.push(slot.code.clone()),
            }
        }
        GeneratedSchedule {
            selections,
            omitted,
            score,
            metrics,
        }
    }

    fn record(&mut self, mask: &WeekMask, included: usize) {
        if included < self.best_count {
            return;
        }
        if included > self.best_count {
            self.best_count = included;
            self.heap.clear();
        }
        let (score, metrics) = self.score(mask);
        // Once `limit` schedules are kept, only one better than the worst of them gets built.
        if self.heap.len() >= self.limit {
            if !self.heap.peek().is_some_and(|worst| score < worst.0) {
                return;
            }
            self.heap.pop();
        }
        let built = self.schedule(score, metrics);
        self.heap.push(Ranked(score, built));
    }

    fn dfs(&mut self, i: usize, mask: WeekMask, credits: u32, included: usize) {
        self.explored += 1;
        if self.explored > NODE_BUDGET {
            self.truncated = true;
            return;
        }
        if i == self.slots.len() {
            self.record(&mask, included);
            return;
        }
        // Not enough courses left to beat the best partial result.
        if self.allow_skip && included + (self.slots.len() - i) < self.best_count {
            return;
        }
        let slot = &self.slots[i];
        for (ci, cand) in slot.candidates.iter().enumerate() {
            if cand.mask.intersects(&mask) || credits + slot.credits > self.max_credits {
                continue;
            }
            self.chosen[i] = Some(ci);
            self.dfs(
                i + 1,
                mask.union(&cand.mask),
                credits + slot.credits,
                included + 1,
            );
            if self.truncated {
                return;
            }
        }
        self.chosen[i] = None;
        if self.allow_skip && !slot.locked {
            self.dfs(i + 1, mask, credits, included);
        }
    }

    fn run(
        slots: &[Slot],
        req: &GenerateRequest,
        allow_skip: bool,
    ) -> (Vec<GeneratedSchedule>, u64, bool) {
        let mut s = Search {
            slots,
            prefs: &req.preferences,
            max_credits: req
                .constraints
                .max_credits
                .filter(|m| *m > 0)
                .unwrap_or(u32::MAX),
            limit: req.limit.clamp(1, 500),
            allow_skip,
            best_count: if allow_skip { 1 } else { slots.len() },
            heap: BinaryHeap::new(),
            chosen: vec![None; slots.len()],
            explored: 0,
            truncated: false,
            off_hours: preferred_window(req.preferences.time_of_day)
                .map(|(from, to)| WeekMask::outside_window(from, to)),
        };
        s.dfs(0, WeekMask::EMPTY, 0, 0);
        let mut out: Vec<_> = s.heap.into_vec().into_iter().map(|r| r.1).collect();
        out.sort_by(|a, b| a.score.total_cmp(&b.score));
        (out, s.explored, s.truncated)
    }
}

pub fn generate(req: &GenerateRequest) -> GenerateResult {
    let (slots, unschedulable) = build_slots(req);
    if slots.is_empty() {
        return GenerateResult {
            schedules: Vec::new(),
            unschedulable,
            complete: false,
            explored: 0,
            truncated: false,
        };
    }
    let (full, explored, truncated) = Search::run(&slots, req, false);
    if !full.is_empty() {
        return GenerateResult {
            schedules: full,
            unschedulable,
            complete: true,
            explored,
            truncated,
        };
    }
    let (partial, explored2, truncated2) = Search::run(&slots, req, true);
    GenerateResult {
        schedules: partial,
        unschedulable,
        complete: false,
        explored: explored + explored2,
        truncated: truncated || truncated2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CourseSource, Group, Session, Typology};
    use chrono::Utc;

    fn group(id: &str, sessions: &[(Day, u16, u16)], spots: Option<u32>) -> Group {
        Group {
            id: id.into(),
            label: format!("({id}) Grupo {id}"),
            professors: vec![],
            faculty: String::new(),
            sessions: sessions
                .iter()
                .map(|(d, a, b)| Session {
                    day: *d,
                    start: a * 60,
                    end: b * 60,
                    room: String::new(),
                })
                .collect(),
            duration: String::new(),
            shift: String::new(),
            spots,
            starts_on: None,
            ends_on: None,
        }
    }

    fn course(code: &str, credits: u8, groups: Vec<Group>) -> Course {
        Course {
            code: code.into(),
            name: format!("Curso {code}"),
            credits,
            typology: Typology::Other,
            groups,
            fetched_at: Utc::now(),
            source: CourseSource::Sia,
            career: None,
        }
    }

    fn req(courses: Vec<Course>) -> GenerateRequest {
        GenerateRequest {
            courses,
            constraints: Constraints::default(),
            preferences: Preferences::default(),
            limit: 50,
        }
    }

    #[test]
    fn finds_all_conflict_free_combinations() {
        let r = req(vec![
            course(
                "A",
                3,
                vec![
                    group("1", &[(Day::Mon, 7, 9)], Some(10)),
                    group("2", &[(Day::Tue, 7, 9)], Some(10)),
                ],
            ),
            course(
                "B",
                3,
                vec![
                    group("1", &[(Day::Mon, 8, 10)], Some(10)),
                    group("2", &[(Day::Wed, 7, 9)], Some(10)),
                ],
            ),
        ]);
        let out = generate(&r);
        assert!(out.complete);
        // A1+B1 collide; the other three combinations are valid.
        assert_eq!(out.schedules.len(), 3);
        for s in &out.schedules {
            assert_eq!(s.selections.len(), 2);
            assert!(
                !(s.selections
                    .iter()
                    .any(|x| x.course_code == "A" && x.group_id == "1")
                    && s.selections
                        .iter()
                        .any(|x| x.course_code == "B" && x.group_id == "1"))
            );
        }
    }

    #[test]
    fn ranks_compact_schedules_first() {
        let r = req(vec![
            course("A", 3, vec![group("1", &[(Day::Mon, 7, 9)], None)]),
            course(
                "B",
                3,
                vec![
                    group("far", &[(Day::Mon, 14, 16)], None),
                    group("near", &[(Day::Mon, 9, 11)], None),
                ],
            ),
        ]);
        let out = generate(&r);
        assert_eq!(
            out.schedules[0]
                .selections
                .iter()
                .find(|s| s.course_code == "B")
                .unwrap()
                .group_id,
            "near"
        );
        assert_eq!(out.schedules[0].metrics.gap_minutes, 0);
        assert_eq!(out.schedules[1].metrics.gap_minutes, 300);
    }

    #[test]
    fn respects_filters_and_credits() {
        let mut r = req(vec![
            course(
                "A",
                4,
                vec![
                    group("1", &[(Day::Sat, 7, 9)], Some(3)),
                    group("2", &[(Day::Mon, 7, 9)], Some(0)),
                ],
            ),
            course("B", 4, vec![group("1", &[(Day::Tue, 7, 9)], Some(3))]),
        ]);
        r.constraints.days = vec![Day::Mon, Day::Tue, Day::Wed, Day::Thu, Day::Fri];
        r.constraints.only_with_spots = true;
        let out = generate(&r);
        assert_eq!(out.unschedulable.len(), 1);
        assert_eq!(out.unschedulable[0].code, "A");

        let mut r2 = req(vec![
            course("A", 4, vec![group("1", &[(Day::Mon, 7, 9)], None)]),
            course("B", 4, vec![group("1", &[(Day::Tue, 7, 9)], None)]),
        ]);
        r2.constraints.max_credits = Some(6);
        let out2 = generate(&r2);
        assert!(!out2.complete);
        assert_eq!(out2.schedules[0].selections.len(), 1);
        assert_eq!(out2.schedules[0].omitted.len(), 1);
    }

    #[test]
    fn maximises_courses_when_some_collide() {
        let r = req(vec![
            course("A", 3, vec![group("1", &[(Day::Mon, 7, 9)], None)]),
            course("B", 3, vec![group("1", &[(Day::Mon, 7, 9)], None)]),
            course("C", 3, vec![group("1", &[(Day::Tue, 7, 9)], None)]),
        ]);
        let out = generate(&r);
        assert!(!out.complete);
        assert!(out
            .schedules
            .iter()
            .all(|s| s.selections.len() == 2 && s.omitted.len() == 1));
        assert_eq!(out.schedules.len(), 2);
    }

    #[test]
    fn locked_and_blocks() {
        let mut r = req(vec![course(
            "A",
            3,
            vec![
                group("1", &[(Day::Mon, 7, 9)], None),
                group("2", &[(Day::Tue, 7, 9)], None),
            ],
        )]);
        r.constraints.blocks = vec![super::super::Block {
            day: Day::Tue,
            start: 8 * 60,
            end: 12 * 60,
            label: "Trabajo".into(),
        }];
        assert_eq!(generate(&r).schedules.len(), 1);
        r.constraints.blocks.clear();
        r.constraints.locked = vec![Selection {
            course_code: "A".into(),
            group_id: "2".into(),
        }];
        let out = generate(&r);
        assert_eq!(out.schedules.len(), 1);
        assert_eq!(out.schedules[0].selections[0].group_id, "2");
    }

    fn lock(code: &str, group_id: &str) -> Selection {
        Selection {
            course_code: code.into(),
            group_id: group_id.into(),
        }
    }

    #[test]
    fn locked_course_is_kept_when_another_collides_with_it() {
        let mut r = req(vec![
            course("A", 3, vec![group("1", &[(Day::Mon, 7, 9)], None)]),
            course("B", 3, vec![group("1", &[(Day::Mon, 8, 10)], None)]),
        ]);
        r.constraints.locked = vec![lock("B", "1")];
        let out = generate(&r);
        assert!(!out.complete);
        assert_eq!(out.schedules.len(), 1);
        assert_eq!(out.schedules[0].selections, vec![lock("B", "1")]);
        assert_eq!(out.schedules[0].omitted, vec!["A".to_string()]);
    }

    #[test]
    fn colliding_locked_courses_are_reported() {
        let mut r = req(vec![
            course("A", 3, vec![group("1", &[(Day::Mon, 7, 9)], None)]),
            course("B", 3, vec![group("1", &[(Day::Mon, 8, 10)], None)]),
        ]);
        r.constraints.locked = vec![lock("A", "1"), lock("B", "1")];
        let out = generate(&r);
        assert_eq!(out.unschedulable.len(), 1);
        assert_eq!(out.unschedulable[0].code, "B");
        assert_eq!(
            out.unschedulable[0].reason,
            "Choca con el grupo fijado de Curso A"
        );
        assert!(out.complete);
        assert_eq!(out.schedules[0].selections, vec![lock("A", "1")]);
    }

    #[test]
    fn missing_locked_group_has_a_clear_reason() {
        let mut r = req(vec![course(
            "A",
            3,
            vec![group("1", &[(Day::Mon, 7, 9)], None)],
        )]);
        r.constraints.locked = vec![lock("A", "99")];
        let out = generate(&r);
        assert_eq!(out.unschedulable.len(), 1);
        assert_eq!(
            out.unschedulable[0].reason,
            "El grupo 99 que fijaste ya no se ofrece"
        );
    }
}
