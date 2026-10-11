//! iCalendar (RFC 5545) export: works with Google, Outlook and Apple Calendar
//! without connecting any account.

use chrono::{Duration, NaiveDate, Utc};

use super::CalendarEvent;
use crate::text::format_hhmm;

pub const TIMEZONE: &str = "America/Bogota";

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}

/// Fold lines longer than 75 octets as the RFC requires.
fn fold(line: &str) -> String {
    let mut out = String::with_capacity(line.len() + line.len() / 70 * 3);
    let mut width = 0;
    for ch in line.chars() {
        let len = ch.len_utf8();
        if width + len > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(ch);
        width += len;
    }
    out
}

fn local(date: NaiveDate, minutes: u16) -> String {
    format!(
        "{}T{}00",
        date.format("%Y%m%d"),
        format_hhmm(minutes).replace(':', "")
    )
}

/// UNTIL must be UTC when DTSTART has a TZID; 23:59:59 in Bogotá is 04:59:59Z next day.
fn until_utc(date: NaiveDate) -> String {
    format!("{}T045959Z", (date + Duration::days(1)).format("%Y%m%d"))
}

pub fn to_ics(calendar_name: &str, events: &[CalendarEvent]) -> String {
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let mut lines: Vec<String> = vec![
        "BEGIN:VCALENDAR".into(),
        "VERSION:2.0".into(),
        "PRODID:-//BetterCampus//Desktop//ES".into(),
        "CALSCALE:GREGORIAN".into(),
        "METHOD:PUBLISH".into(),
        format!("X-WR-CALNAME:{}", escape(calendar_name)),
        format!("X-WR-TIMEZONE:{TIMEZONE}"),
        "BEGIN:VTIMEZONE".into(),
        format!("TZID:{TIMEZONE}"),
        "BEGIN:STANDARD".into(),
        "DTSTART:19700101T000000".into(),
        "TZOFFSETFROM:-0500".into(),
        "TZOFFSETTO:-0500".into(),
        "TZNAME:-05".into(),
        "END:STANDARD".into(),
        "END:VTIMEZONE".into(),
    ];
    for (i, e) in events.iter().enumerate() {
        let first = e.first_date();
        if first > e.until {
            continue;
        }
        lines.extend([
            "BEGIN:VEVENT".into(),
            format!("UID:{}-{}-{}@bettercampus", stamp, i, e.day.ical()),
            format!("DTSTAMP:{stamp}"),
            format!("DTSTART;TZID={TIMEZONE}:{}", local(first, e.start)),
            format!("DTEND;TZID={TIMEZONE}:{}", local(first, e.end)),
            format!(
                "RRULE:FREQ=WEEKLY;BYDAY={};UNTIL={}",
                e.day.ical(),
                until_utc(e.until)
            ),
            format!("SUMMARY:{}", escape(&e.summary)),
        ]);
        if !e.location.is_empty() {
            lines.push(format!("LOCATION:{}", escape(&e.location)));
        }
        if !e.description.is_empty() {
            lines.push(format!("DESCRIPTION:{}", escape(&e.description)));
        }
        lines.extend([
            "BEGIN:VALARM".into(),
            "ACTION:DISPLAY".into(),
            "DESCRIPTION:Clase".into(),
            "TRIGGER:-PT10M".into(),
            "END:VALARM".into(),
            "END:VEVENT".into(),
        ]);
    }
    lines.push("END:VCALENDAR".into());
    let mut out = String::new();
    for l in lines {
        out.push_str(&fold(&l));
        out.push_str("\r\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Day;

    #[test]
    fn writes_weekly_events() {
        let e = CalendarEvent {
            summary: "Cálculo, integral; grupo 1".into(),
            location: "401-204".into(),
            description: "Línea 1\nLínea 2".into(),
            day: Day::Tue,
            start: 7 * 60,
            end: 9 * 60,
            from: NaiveDate::from_ymd_opt(2026, 8, 24).unwrap(),
            until: NaiveDate::from_ymd_opt(2026, 12, 17).unwrap(),
            color: None,
        };
        let ics = to_ics("2026-2", &[e]);
        assert!(ics.contains("DTSTART;TZID=America/Bogota:20260825T070000"));
        assert!(ics.contains("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261218T045959Z"));
        assert!(ics.contains("SUMMARY:Cálculo\\, integral\\; grupo 1"));
        assert!(ics.contains("DESCRIPTION:Línea 1\\nLínea 2"));
        assert!(ics.lines().all(|l| l.len() <= 76));
    }
}
