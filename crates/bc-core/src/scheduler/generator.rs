use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashSet};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::{Constraints, Preferences, Selection, TimeOfDay};
use crate::model::{Course, Day};
use crate::week::{gap_minutes, span, WeekMask, SLOT_MINUTES};

/// Longest a search may run; past it the best schedules found so far are returned.
const TIME_BUDGET: Duration = Duration::from_secs(2);
/// Nodes between two clock reads: reading it on every node would cost more than the node.
const CLOCK_INTERVAL: u64 = 1024;

// Score terms besides the student's weights. `Search::bound` relies on every term but gaps
// only growing as courses are added: keep it that way when changing the score.
const OFF_HOURS_WEIGHT: f64 = 0.5;
const FAVORITE_BONUS: f64 = 1.5;
/// Penalty of a group with no spots left; it shrinks as spots grow.
const SCARCE_SPOTS_PENALTY: f64 = 10.0;
/// Slack for float rounding: a branch is pruned only when its bound is clearly worse.
const BOUND_MARGIN: f64 = 1e-6;

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
    /// True when the time budget ran out before the search finished.
    pub truncated: bool,
}

struct Candidate {
    group_id: String,
    mask: WeekMask,
    /// Busy days and busy slots per day of `mask`.
    days: u8,
    day_slots: [u32; 7],
    /// Slots of `mask` outside the preferred time of day.
    off_hours_slots: u32,
    spots: Option<u32>,
    spot_penalty: f64,
    favorite: bool,
}

fn spot_penalty(spots: Option<u32>) -> f64 {
    spots.map_or(0.0, |s| SCARCE_SPOTS_PENALTY / (1.0 + s as f64))
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
    let off_hours = preferred_window(req.preferences.time_of_day)
        .map_or(WeekMask::EMPTY, |(from, to)| {
            WeekMask::outside_window(from, to)
        });
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
                let mask = WeekMask::from_sessions(&g.sessions);
                Candidate {
                    group_id: g.id.clone(),
                    mask,
                    days: mask.days(),
                    day_slots: mask.busy_slots_per_day(),
                    off_hours_slots: mask.intersection_count(&off_hours),
                    spots: g.spots,
                    spot_penalty: spot_penalty(g.spots),
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

fn preferred_window(t: TimeOfDay) -> Option<(u16, u16)> {
    match t {
        TimeOfDay::Any => None,
        TimeOfDay::Morning => Some((6 * 60, 13 * 60)),
        TimeOfDay::Afternoon => Some((12 * 60, 18 * 60)),
        TimeOfDay::Evening => Some((17 * 60, 22 * 60)),
    }
}

/// What the courses from each depth on can still add, so a branch can be judged before it is
/// explored. Index `i` covers the courses `i..`.
struct Remaining {
    /// How many have a favorite group.
    favorites: Vec<u32>,
    /// The least spot penalty they must add (none for a course the search may skip).
    spot_penalty: Vec<f64>,
    /// The most slots they can fill on each day.
    day_slots: Vec<[u32; 7]>,
    /// Their credits in ascending order, as running sums.
    cheapest_credits: Vec<Vec<u32>>,
}

impl Remaining {
    fn new(slots: &[Slot], allow_skip: bool) -> Remaining {
        let n = slots.len();
        let mut r = Remaining {
            favorites: vec![0; n + 1],
            spot_penalty: vec![0.0; n + 1],
            day_slots: vec![[0; 7]; n + 1],
            cheapest_credits: Vec::with_capacity(n + 1),
        };
        for (i, slot) in slots.iter().enumerate().rev() {
            let cands = &slot.candidates;
            r.favorites[i] = r.favorites[i + 1] + cands.iter().any(|c| c.favorite) as u32;
            let least_penalty = if allow_skip && !slot.locked {
                0.0
            } else {
                cands
                    .iter()
                    .map(|c| c.spot_penalty)
                    .fold(f64::INFINITY, f64::min)
            };
            r.spot_penalty[i] = r.spot_penalty[i + 1] + least_penalty;
            let mut day_slots = r.day_slots[i + 1];
            for (d, most) in day_slots.iter_mut().enumerate() {
                *most += cands.iter().map(|c| c.day_slots[d]).max().unwrap_or(0);
            }
            r.day_slots[i] = day_slots;
        }
        for i in 0..=n {
            let mut credits: Vec<u32> = slots[i..].iter().map(|s| s.credits).collect();
            credits.sort_unstable();
            let running = credits.iter().scan(0, |sum, c| {
                *sum += c;
                Some(*sum)
            });
            r.cheapest_credits.push(running.collect());
        }
        r
    }
}

/// The choice so far, with the running totals the score and the bound need. Candidates in a
/// choice never overlap, so slot counts add up.
#[derive(Clone, Copy)]
struct Partial {
    mask: WeekMask,
    credits: u32,
    included: usize,
    days: u8,
    off_hours_slots: u32,
    favorites: u32,
    spot_penalty: f64,
}

impl Partial {
    const EMPTY: Partial = Partial {
        mask: WeekMask::EMPTY,
        credits: 0,
        included: 0,
        days: 0,
        off_hours_slots: 0,
        favorites: 0,
        spot_penalty: 0.0,
    };

    fn with(&self, cand: &Candidate, credits: u32) -> Partial {
        Partial {
            mask: self.mask.union(&cand.mask),
            credits: self.credits + credits,
            included: self.included + 1,
            days: self.days | cand.days,
            off_hours_slots: self.off_hours_slots + cand.off_hours_slots,
            favorites: self.favorites + cand.favorite as u32,
            spot_penalty: self.spot_penalty + cand.spot_penalty,
        }
    }
}

/// The terms of a schedule's score, before weighting.
struct ScoreTerms {
    gap_minutes: u32,
    days: u32,
    off_hours_slots: u32,
    favorites: u32,
    spot_penalty: f64,
}

struct Search<'a> {
    slots: &'a [Slot],
    prefs: &'a Preferences,
    remaining: Remaining,
    /// The bound assumes no weight rewards a worse term; a negative weight turns pruning off.
    prunable: bool,
    max_credits: u32,
    limit: usize,
    allow_skip: bool,
    best_count: usize,
    heap: BinaryHeap<Ranked>,
    chosen: Vec<Option<usize>>,
    explored: u64,
    truncated: bool,
    deadline: Instant,
}

impl Search<'_> {
    /// Lower score is better.
    fn weigh(&self, t: &ScoreTerms) -> f64 {
        self.prefs.gaps * t.gap_minutes as f64 / 60.0
            + self.prefs.days * t.days as f64
            + OFF_HOURS_WEIGHT * (t.off_hours_slots as f64 * SLOT_MINUTES as f64 / 60.0)
            - FAVORITE_BONUS * t.favorites as f64
            + self.prefs.spots * t.spot_penalty
    }

    /// Score and metrics of the current choice. Allocates nothing: it runs for every complete
    /// schedule the search reaches, and most of them are discarded.
    fn score(&self, p: &Partial) -> (f64, Metrics) {
        let min_spots = self
            .slots
            .iter()
            .zip(&self.chosen)
            .filter_map(|(slot, pick)| slot.candidates[(*pick)?].spots)
            .min();
        let gaps = gap_minutes(&p.mask);
        let (earliest, latest) = span(&p.mask).unwrap_or((0, 0));
        let score = self.weigh(&ScoreTerms {
            gap_minutes: gaps,
            days: p.days.count_ones(),
            off_hours_slots: p.off_hours_slots,
            favorites: p.favorites,
            spot_penalty: p.spot_penalty,
        });
        let metrics = Metrics {
            gap_minutes: gaps,
            days: p.days.count_ones() as u8,
            credits: p.credits,
            earliest,
            latest,
            favorites: p.favorites,
            min_spots,
        };
        ((score * 100.0).round() / 100.0, metrics)
    }

    /// A score no schedule completed from `p` at depth `i` can beat. Days, off-hours slots and
    /// spot penalties only grow as courses are added, and favorites grow at most by the courses
    /// left that have one. Gaps can shrink, but on each day at most by the slots the courses left
    /// can fill there.
    fn bound(&self, i: usize, p: &Partial) -> f64 {
        let r = &self.remaining;
        let gap_slots: u32 = p
            .mask
            .gap_slots_per_day()
            .iter()
            .zip(&r.day_slots[i])
            .map(|(gap, fillable)| gap.saturating_sub(*fillable))
            .sum();
        self.weigh(&ScoreTerms {
            gap_minutes: gap_slots * SLOT_MINUTES as u32,
            days: p.days.count_ones(),
            off_hours_slots: p.off_hours_slots,
            favorites: p.favorites + r.favorites[i],
            spot_penalty: p.spot_penalty + r.spot_penalty[i],
        })
    }

    /// The most courses a schedule completed from `p` at depth `i` can hold: the ones left,
    /// cheapest first, while they fit under the credit cap.
    fn reachable(&self, i: usize, p: &Partial) -> usize {
        let room = self.max_credits.saturating_sub(p.credits);
        p.included + self.remaining.cheapest_credits[i].partition_point(|c| *c <= room)
    }

    /// True when `limit` schedules are kept and nothing reachable from `p` can enter them.
    fn cannot_improve(&self, i: usize, p: &Partial, reachable: usize) -> bool {
        // A branch that may include more courses would replace every kept schedule.
        if !self.prunable || self.heap.len() < self.limit || reachable > self.best_count {
            return false;
        }
        let worst = self
            .heap
            .peek()
            .expect("the heap holds `limit` schedules")
            .0;
        self.bound(i, p) > worst + BOUND_MARGIN
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

    fn record(&mut self, p: &Partial) {
        if p.included < self.best_count {
            return;
        }
        if p.included > self.best_count {
            self.best_count = p.included;
            self.heap.clear();
        }
        let (score, metrics) = self.score(p);
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

    fn out_of_time(&mut self) -> bool {
        self.explored += 1;
        if self.explored.is_multiple_of(CLOCK_INTERVAL) && Instant::now() >= self.deadline {
            self.truncated = true;
        }
        self.truncated
    }

    /// Depth-first over the courses: stop when time runs out, record a complete choice, prune a
    /// branch that can't hold enough courses or beat the kept schedules, then try each group that
    /// fits and, when allowed, leaving the course out.
    fn dfs(&mut self, i: usize, p: Partial) {
        if self.out_of_time() {
            return;
        }
        if i == self.slots.len() {
            self.record(&p);
            return;
        }
        let reachable = self.reachable(i, &p);
        if reachable < self.best_count || self.cannot_improve(i, &p, reachable) {
            return;
        }
        let slot = &self.slots[i];
        for (ci, cand) in slot.candidates.iter().enumerate() {
            if cand.mask.intersects(&p.mask) || p.credits + slot.credits > self.max_credits {
                continue;
            }
            self.chosen[i] = Some(ci);
            self.dfs(i + 1, p.with(cand, slot.credits));
            if self.truncated {
                return;
            }
        }
        self.chosen[i] = None;
        if self.allow_skip && !slot.locked {
            self.dfs(i + 1, p);
        }
    }

    fn run(
        slots: &[Slot],
        req: &GenerateRequest,
        allow_skip: bool,
        deadline: Instant,
    ) -> (Vec<GeneratedSchedule>, u64, bool) {
        let prefs = &req.preferences;
        let mut s = Search {
            slots,
            prefs,
            remaining: Remaining::new(slots, allow_skip),
            prunable: prefs.gaps >= 0.0 && prefs.days >= 0.0 && prefs.spots >= 0.0,
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
            deadline,
        };
        s.dfs(0, Partial::EMPTY);
        let mut out: Vec<_> = s.heap.into_vec().into_iter().map(|r| r.1).collect();
        out.sort_by(|a, b| a.score.total_cmp(&b.score));
        (out, s.explored, s.truncated)
    }
}

pub fn generate(req: &GenerateRequest) -> GenerateResult {
    generate_until(req, Instant::now() + TIME_BUDGET)
}

/// `generate` with the time limit as an argument, so tests can run out of time on purpose.
fn generate_until(req: &GenerateRequest, deadline: Instant) -> GenerateResult {
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
    let (full, explored, truncated) = Search::run(&slots, req, false, deadline);
    if !full.is_empty() {
        return GenerateResult {
            schedules: full,
            unschedulable,
            complete: true,
            explored,
            truncated,
        };
    }
    let (partial, explored2, truncated2) = Search::run(&slots, req, true, deadline);
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
    fn courses_that_fill_the_credit_cap_exactly_fit() {
        let mut r = req(vec![
            course("A", 4, vec![group("1", &[(Day::Mon, 7, 9)], None)]),
            course("B", 3, vec![group("1", &[(Day::Tue, 7, 9)], None)]),
            course("C", 3, vec![group("1", &[(Day::Wed, 7, 9)], None)]),
        ]);
        r.constraints.max_credits = Some(10);
        assert!(generate(&r).complete);
        r.constraints.max_credits = Some(7);
        let out = generate(&r);
        assert!(!out.complete);
        assert!(out.schedules.iter().all(|s| s.selections.len() == 2));
        assert_eq!(out.schedules.len(), 3);
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

    #[test]
    fn running_out_of_time_returns_the_best_found_so_far() {
        // 12 groups per course on separate hours: 12^3 complete schedules, more nodes than one
        // clock interval.
        let courses = Day::ALL[..3]
            .iter()
            .enumerate()
            .map(|(k, day)| {
                let groups = (0..12)
                    .map(|h| group(&h.to_string(), &[(*day, 6 + h, 7 + h)], None))
                    .collect();
                course(&k.to_string(), 3, groups)
            })
            .collect();
        let out = generate_until(&req(courses), Instant::now());
        assert!(out.truncated);
        assert!(!out.schedules.is_empty());
        assert_eq!(out.explored, CLOCK_INTERVAL);
    }

    /// Deterministic xorshift numbers: the same inputs on every run, without a dependency.
    struct Rng(u64);

    impl Rng {
        fn below(&mut self, n: u64) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0 % n
        }
    }

    /// Four courses of one to four groups with one or two random sessions: at most 256
    /// schedules, so a limit of 500 keeps all of them and never prunes.
    fn random_courses(rng: &mut Rng) -> Vec<Course> {
        (0..4)
            .map(|k| {
                let groups = (0..1 + rng.below(4))
                    .map(|g| {
                        let sessions: Vec<_> = (0..1 + rng.below(2))
                            .map(|_| {
                                let start = 6 + rng.below(14) as u16;
                                (
                                    Day::ALL[rng.below(6) as usize],
                                    start,
                                    start + 1 + rng.below(3) as u16,
                                )
                            })
                            .collect();
                        let spots = (rng.below(3) > 0).then(|| rng.below(30) as u32);
                        group(&g.to_string(), &sessions, spots)
                    })
                    .collect();
                course(&k.to_string(), 2 + rng.below(3) as u8, groups)
            })
            .collect()
    }

    #[test]
    fn pruning_keeps_the_best_schedules() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let times = [
            TimeOfDay::Any,
            TimeOfDay::Morning,
            TimeOfDay::Afternoon,
            TimeOfDay::Evening,
        ];
        let (mut pruned_nodes, mut all_nodes) = (0, 0);
        for case in 0..200 {
            let mut r = req(random_courses(&mut rng));
            r.preferences.gaps = [0.0, 1.0, 3.0][case % 3];
            r.preferences.days = [3.0, 0.0, 1.0][case % 3];
            r.preferences.time_of_day = times[case % 4];
            r.preferences.spots = [0.3, 3.0][case % 2];
            r.preferences.favorites = r
                .courses
                .iter()
                .filter(|_| rng.below(2) == 0)
                .map(|c| lock(&c.code, "0"))
                .collect();
            r.constraints.max_credits = [None, Some(6), Some(9)][case % 3];
            r.limit = 500;
            let all = generate(&r);
            r.limit = 5;
            let pruned = generate(&r);

            let best: Vec<f64> = all.schedules.iter().take(5).map(|s| s.score).collect();
            let kept: Vec<f64> = pruned.schedules.iter().map(|s| s.score).collect();
            assert_eq!(kept, best, "case {case}");
            assert_eq!(pruned.complete, all.complete, "case {case}");
            pruned_nodes += pruned.explored;
            all_nodes += all.explored;
        }
        // The comparison above means nothing if the bound never prunes.
        assert!(pruned_nodes < all_nodes, "{pruned_nodes} of {all_nodes}");
    }
}
