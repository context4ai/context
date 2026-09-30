use regex::Regex;
use std::sync::OnceLock;

#[derive(Clone, Debug)]
pub struct Section {
    pub id: String,
    pub start: u64,
    pub end: u64,
}

pub fn sections(text: &str) -> Result<Vec<Section>, String> {
    static OPEN: OnceLock<Regex> = OnceLock::new();
    static CLOSE: OnceLock<Regex> = OnceLock::new();
    static INVALID: OnceLock<Regex> = OnceLock::new();
    static FENCE: OnceLock<Regex> = OnceLock::new();
    let open = OPEN.get_or_init(|| {
        Regex::new(r#"^\s*<!--\s*context:section\s+id="([^"]+)"\s*-->\s*$"#).unwrap()
    });
    let close = CLOSE.get_or_init(|| Regex::new(r"^\s*<!--\s*/context:section\s*-->\s*$").unwrap());
    let invalid = INVALID.get_or_init(|| Regex::new(r"^\s*<!--\s*context:section\b").unwrap());
    let delimiter = FENCE.get_or_init(|| Regex::new(r"^ {0,3}(`{3,}|~{3,})(.*)$").unwrap());
    let mut result = Vec::new();
    let mut current: Option<(String, u64)> = None;
    let mut fence: Option<(u8, usize)> = None;
    for (i, line) in text.split('\n').enumerate() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let d = delimiter.captures(line);
        if let Some((character, length)) = fence {
            if let Some(d) = d {
                if d[1].as_bytes()[0] == character && d[1].len() >= length && d[2].trim().is_empty()
                {
                    fence = None;
                }
            }
            continue;
        }
        if let Some(d) = d {
            fence = Some((d[1].as_bytes()[0], d[1].len()));
            continue;
        }
        if let Some(m) = open.captures(line) {
            if current.is_some() {
                return Err("Nested section marker".into());
            }
            let id = m[1]
                .replace("&quot;", "\"")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&");
            if result.iter().any(|s: &Section| s.id == id) {
                return Err("Duplicate section marker".into());
            }
            current = Some((id, i as u64 + 1));
        } else if close.is_match(line) {
            let (id, start) = current.take().ok_or("Unmatched section end")?;
            result.push(Section {
                id,
                start,
                end: i as u64 + 1,
            });
        } else if invalid.is_match(line) {
            return Err("Invalid section marker".into());
        }
    }
    if current.is_some() {
        return Err("Unclosed section marker".into());
    }
    Ok(result)
}
