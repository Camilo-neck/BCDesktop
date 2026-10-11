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
            if self.day_slots(d).any(|b| b) {
                out |= 1 << d.index();
            }
        }
        out
    }
}

/// Idle minutes between the first and last class of each day, summed over the week.
pub fn gap_minutes(mask: &WeekMask) -> u32 {
    let mut total = 0u32;
    for d in Day::ALL {
        let slots: Vec<bool> = mask.day_slots(d).collect();
        let (Some(first), Some(last)) = (
            slots.iter().position(|b| *b),
            slots.iter().rposition(|b| *b),
        ) else {
            continue;
        };
        let busy = slots[first..=last].iter().filter(|b| **b).count();
        total += ((last - first + 1 - busy) as u32) * SLOT_MINUTES as u32;
    }
    total
}

/// Earliest start and latest end over the week, in minutes.
pub fn span(mask: &WeekMask) -> Option<(u16, u16)> {
    let mut lo = usize::MAX;
    let mut hi = 0usize;
    for d in Day::ALL {
        let slots: Vec<bool> = mask.day_slots(d).collect();
        if let (Some(f), Some(l)) = (
            slots.iter().position(|b| *b),
            slots.iter().rposition(|b| *b),
        ) {
            lo = lo.min(f);
            hi = hi.max(l + 1);
        }
    }
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
}
