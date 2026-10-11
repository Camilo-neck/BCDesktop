//! Small text helpers shared by the parsers.

/// Uppercase, accent-free, single-spaced form used to compare names coming from
/// different SIA pages ("Cálculo  Integral" == "CALCULO INTEGRAL").
pub fn normalize(s: &str) -> String {
    let ascii = deunicode::deunicode(s);
    collapse_ws(&ascii).to_uppercase()
}

/// Collapse every whitespace run (including non-breaking spaces) to one space and trim.
pub fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() || ch == '\u{a0}' {
            pending_space = !out.is_empty();
        } else {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
            out.push(ch);
        }
    }
    out
}

/// Text between the last pair of parentheses: "Álgebra Lineal (1000003-B)" -> "1000003-B".
pub fn code_in_parens(s: &str) -> Option<&str> {
    let open = s.rfind('(')?;
    let close = s[open..].find(')')? + open;
    let inner = s[open + 1..close].trim();
    (!inner.is_empty()).then_some(inner)
}

/// Strip a trailing " (CODE)" from a course title.
pub fn strip_code(s: &str) -> &str {
    match s.rfind(" (") {
        Some(i) if s.ends_with(')') => s[..i].trim_end(),
        _ => s.trim(),
    }
}

/// Parse "HH:MM" into minutes since midnight.
pub fn parse_hhmm(s: &str) -> Option<u16> {
    let s = s.trim().trim_end_matches('.');
    let (h, m) = s.split_once(':')?;
    let h: u16 = h.trim().parse().ok()?;
    let m: u16 = m.trim().get(..2).unwrap_or(m.trim()).parse().ok()?;
    (h <= 24 && m < 60).then_some(h * 60 + m)
}

pub fn format_hhmm(minutes: u16) -> String {
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_accents_and_spacing() {
        assert_eq!(normalize("  Cálculo\u{a0} Integral "), "CALCULO INTEGRAL");
        assert_eq!(normalize("MIÉRCOLES"), "MIERCOLES");
    }

    #[test]
    fn extracts_codes() {
        assert_eq!(
            code_in_parens("Álgebra Lineal (1000003-B)"),
            Some("1000003-B")
        );
        assert_eq!(strip_code("Álgebra Lineal (1000003-B)"), "Álgebra Lineal");
        assert_eq!(code_in_parens("Sin código"), None);
    }

    #[test]
    fn parses_hours() {
        assert_eq!(parse_hhmm("07:00"), Some(420));
        assert_eq!(parse_hhmm("13:00."), Some(780));
        assert_eq!(parse_hhmm("x"), None);
        assert_eq!(format_hhmm(450), "07:30");
    }
}
