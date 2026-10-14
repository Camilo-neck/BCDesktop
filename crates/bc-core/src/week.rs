//! A week as a fixed-size bitset of 10-minute slots.
//!
//! The Python backend compared every pair of `"HH:MM"` strings to detect collisions.
//! Here each group is reduced once to a [`WeekMask`]; two groups collide exactly
//! when their masks intersect, which is 16 `AND`s regardless of how many sessions
//! they have.

use serde::{Deserialize, Serialize};

use crate::model::{Day, Session};

pub const SLOT_MINUTES: u16 = 10;
pub const SLOTS_PER_DAY: usize = (24 * 60 / SLOT_MINUTES) as usize; // 144
const WORDS: usize = (SLOTS_PER_DAY * 7).div_ceil(64); // 16

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub struct WeekMask([u64; WORDS]);

impl std::fmt::Debug for WeekMask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "WeekMask({} slots)", self.count())
    }
}

impl WeekMask {
    pub const EMPTY: WeekMask = WeekMask([0; WORDS]);

    pub fn from_sessions<'a>(sessions: impl IntoIterator<Item = &'a Session>) -> WeekMask {
        let mut m = WeekMask::EMPTY;
        for s in sessions {
            m.add_range(s.day, s.start, s.end);
        }
        m
    }

    /// Mark `[start, end)` on `day`. Partial slots count as busy.
    pub fn add_range(&mut self, day: Day, start: u16, end: u16) {
        if end <= start {
            return;
        }
        let first = (start / SLOT_MINUTES) as usize;
        let last = (end.div_ceil(SLOT_MINUTES) as usize).min(SLOTS_PER_DAY);
        let base = day.index() * SLOTS_PER_DAY;
        for slot in first..last {
            let bit = base + slot;
            self.0[bit / 64] |= 1 << (bit % 64);
        }
    }

    /// Every slot of `day`, or the slots outside `[from, to)` on every day.
    pub fn whole_day(day: Day) -> WeekMask {
        let mut m = WeekMask::EMPTY;
        m.add_range(day, 0, 24 * 60);
        m
    }

    pub fn outside_window(from: u16, to: u16) -> WeekMask {
        let mut m = WeekMask::EMPTY;
        for d in Day::ALL {
            m.add_range(d, 0, from);
            m.add_range(d, to, 24 * 60);
        }
        m
    }

    #[inline]
    pub fn intersects(&self, other: &WeekMask) -> bool {
        self.0.iter().zip(other.0.iter()).any(|(a, b)| a & b != 0)
    }

    #[inline]
    pub fn union(&self, other: &WeekMask) -> WeekMask {
        let mut out = *self;
        out.union_with(other);
        out
    }

    #[inline]
    pub fn union_with(&mut self, other: &WeekMask) {
        for (a, b) in self.0.iter_mut().zip(other.0.iter()) {
            *a |= b;
        }
    }

    pub fn intersection_count(&self, other: &WeekMask) -> u32 {
        self.0
            .iter()
            .zip(other.0.iter())
            .map(|(a, b)| (a & b).count_ones())
            .sum()
    }

    pub fn count(&self) -> u32 {
        self.0.iter().map(|w| w.count_ones()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.0.iter().all(|w| *w == 0)
    }

    pub fn day_slots(&self, day: Day) -> impl Iterator<Item = bool> + '_ {
        let base = day.index() * SLOTS_PER_DAY;
        (0..SLOTS_PER_DAY).map(move |s| {
            let bit = base + s;
            self.0[bit / 64] & (1 << (bit % 64)) != 0
        })
    }

    /// Busy days as a 7-bit set (bit 0 = Monday).
    pub fn days(&self) -> u8 {
        let mut out = 0u8;
        for d in Day::ALL {
            if self.day_extent(d).is_some() {
                out |= 1 << d.index();
            }
        }
        out
    }

    /// First and last busy slot of `day` and how many slots are busy, or `None` for a free day.
    /// Reads whole words instead of single bits: the generator calls it for every schedule it scores.
    fn day_extent(&self, day: Day) -> Option<DayExtent> {
        let start = day.index() * SLOTS_PER_DAY;
        let end = start + SLOTS_PER_DAY;
        let mut extent: Option<DayExtent> = None;
        let mut bit = start;
        while bit < end {
            // The day's bits that live in this word, shifted down to bit 0.
            let offset = bit % 64;
            let len = (64 - offset).min(end - bit);
            let chunk = (self.0[bit / 64] >> offset) & (u64::MAX >> (64 - len));
            if chunk != 0 {
                let first = bit - start + chunk.trailing_zeros() as usize;
                let last = bit - start + 63 - chunk.leading_zeros() as usize;
                let e = extent.get_or_insert(DayExtent {
                    first,
                    last,
                    busy: 0,
                });
                e.last = last;
                e.busy += chunk.count_ones();
            }
            bit += len;
        }
        extent
    }
}

/// Busy slots of one day: first and last (inclusive, as slot indexes in the day) and their count.
struct DayExtent {
    first: usize,
    last: usize,
    busy: u32,
}

/// Idle minutes between the first and last class of each day, summed over the week.
pub fn gap_minutes(mask: &WeekMask) -> u32 {
    Day::ALL
        .iter()
        .filter_map(|d| mask.day_extent(*d))
        .map(|e| (e.last - e.first + 1) as u32 - e.busy)
        .sum::<u32>()
        * SLOT_MINUTES as u32
}

/// Earliest start and latest end over the week, in minutes.
pub fn span(mask: &WeekMask) -> Option<(u16, u16)> {
    let extents = Day::ALL.iter().filter_map(|d| mask.day_extent(*d));
    let (lo, hi) = extents.fold((usize::MAX, 0), |(lo, hi), e| {
        (lo.min(e.first), hi.max(e.last + 1))
    });
    (lo != usize::MAX).then(|| (lo as u16 * SLOT_MINUTES, hi as u16 * SLOT_MINUTES))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(day: Day, a: u16, b: u16) -> Session {
        Session {
            day,
            start: a * 60,
            end: b * 60,
            room: String::new(),
        }
    }

    #[test]
    fn touching_sessions_do_not_collide() {
        let a = WeekMask::from_sessions(&[s(Day::Mon, 7, 9)]);
        let b = WeekMask::from_sessions(&[s(Day::Mon, 9, 11)]);
        assert!(!a.intersects(&b));
        let c = WeekMask::from_sessions(&[s(Day::Mon, 8, 10)]);
        assert!(a.intersects(&c));
        let d = WeekMask::from_sessions(&[s(Day::Tue, 7, 9)]);
        assert!(!a.intersects(&d));
    }

    #[test]
    fn gaps_and_span() {
        let m =
            WeekMask::from_sessions(&[s(Day::Mon, 7, 9), s(Day::Mon, 11, 13), s(Day::Wed, 14, 16)]);
        assert_eq!(gap_minutes(&m), 120);
        assert_eq!(span(&m), Some((420, 960)));
        assert_eq!(m.days(), 0b101);
    }

    #[test]
    fn window_mask() {
        let outside = WeekMask::outside_window(7 * 60, 18 * 60);
        assert!(!outside.intersects(&WeekMask::from_sessions(&[s(Day::Fri, 7, 18)])));
        assert!(outside.intersects(&WeekMask::from_sessions(&[s(Day::Fri, 17, 19)])));
    }

    fn minutes(day: Day, start: u16, end: u16) -> Session {
        Session {
            day,
            start,
            end,
            room: String::new(),
        }
    }

    /// Reference values computed slot by slot: gaps, span and busy days.
    fn scanned_metrics(m: &WeekMask) -> (u32, Option<(u16, u16)>, u8) {
        let (mut gaps, mut lo, mut hi, mut days) = (0, usize::MAX, 0, 0u8);
        for d in Day::ALL {
            let slots: Vec<bool> = m.day_slots(d).collect();
            let (Some(first), Some(last)) = (
                slots.iter().position(|b| *b),
                slots.iter().rposition(|b| *b),
            ) else {
                continue;
            };
            let busy = slots[first..=last].iter().filter(|b| **b).count();
            gaps += (last - first + 1 - busy) as u32 * SLOT_MINUTES as u32;
            lo = lo.min(first);
            hi = hi.max(last + 1);
            days |= 1 << d.index();
        }
        let span = (lo != usize::MAX).then(|| (lo as u16 * SLOT_MINUTES, hi as u16 * SLOT_MINUTES));
        (gaps, span, days)
    }

    #[test]
    fn bitwise_week_metrics_match_the_slot_scan() {
        let weeks = [
            vec![],
            vec![s(Day::Mon, 7, 9), s(Day::Mon, 11, 13), s(Day::Wed, 14, 16)],
            // First and last slot of a day.
            vec![s(Day::Tue, 0, 1), s(Day::Tue, 23, 24)],
            // Last day of the week, with touching sessions.
            vec![s(Day::Sun, 7, 9), s(Day::Sun, 9, 11)],
            // Thursday 2:00 to 4:00 crosses the boundary between two 64-bit words.
            vec![minutes(Day::Thu, 120, 240), minutes(Day::Thu, 300, 310)],
            // Partial slots and every day busy.
            Day::ALL
                .iter()
                .map(|d| minutes(*d, 7 * 60 + 5, 21 * 60 + 55))
                .collect(),
        ];
        for sessions in weeks {
            let m = WeekMask::from_sessions(&sessions);
            assert_eq!(
                (gap_minutes(&m), span(&m), m.days()),
                scanned_metrics(&m),
                "{sessions:?}"
            );
        }
    }
}
