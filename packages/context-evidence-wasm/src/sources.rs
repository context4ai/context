use crate::{join, safe_path, text, Engine, Reader};
use serde_json::{json, Value};

fn string<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value[field]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Missing source {field}"))
}
fn safe_remote(value: &str) -> bool {
    !value.chars().any(char::is_control)
        && !value.contains(['?', '#'])
        && ((value.starts_with("https://") || value.starts_with("http://")) && !value.contains('@')
            || value.starts_with("git@") && value.contains(':')
            || value.starts_with("ssh://git@"))
}

// Same blob URL convention used by Context's exported source links. This does
// not probe a server or prove accessibility. Unsupported shapes stay structured.
fn code_url(remote: &str, revision: &str, path: &str, start: u64, end: u64) -> Option<String> {
    if !matches!(revision.len(), 40 | 64) || !revision.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let (scheme, rest) = if let Some(rest) = remote.strip_prefix("https://") {
        ("https", rest.to_owned())
    } else if let Some(rest) = remote.strip_prefix("http://") {
        ("http", rest.to_owned())
    } else if let Some(rest) = remote.strip_prefix("ssh://git@") {
        ("https", rest.to_owned())
    } else if let Some(rest) = remote.strip_prefix("git@") {
        let (host, repo) = rest.split_once(':')?;
        ("https", format!("{host}/{repo}"))
    } else {
        return None;
    };
    let (host, repo) = rest.split_once('/')?;
    if host.is_empty()
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
    {
        return None;
    }
    let repo = repo.trim_end_matches('/');
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if !safe_path(repo)
        || !repo
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.'))
    {
        return None;
    }
    // These providers do not use the default blob route.
    if matches!(host, "bitbucket.org" | "dev.azure.com" | "gitlab.com") {
        return None;
    }
    let mut encoded = String::new();
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            write!(&mut encoded, "%{byte:02X}").ok()?;
        }
    }
    let anchor = if start == end {
        format!("L{start}")
    } else {
        format!("L{start}-L{end}")
    };
    Some(format!(
        "{scheme}://{host}/{repo}/blob/{revision}/{encoded}#{anchor}"
    ))
}

impl Engine {
    pub(super) fn reference(
        &mut self,
        reader: &mut impl Reader,
        root: &str,
        reference: &Value,
        digest: bool,
    ) -> Result<Value, String> {
        let source_ref = string(reference, "source_ref")?;
        let (kind, name) = source_ref.split_once(':').ok_or("Invalid source_ref")?;
        let path = string(&reference["locator"], "path")?;
        let start = reference["locator"]["start_line"]
            .as_u64()
            .filter(|v| *v > 0)
            .ok_or("Invalid source start line")?;
        let end = reference["locator"]["end_line"]
            .as_u64()
            .filter(|v| *v >= start)
            .ok_or("Invalid source end line")?;
        if !safe_path(path) || !safe_path(name) {
            return Err("Unsafe source path".into());
        }
        let mut out =
            json!({"source_ref":source_ref,"path":path,"start_line":start,"end_line":end});
        if digest {
            let value = string(reference, "content_digest")?;
            if value.len() != 71
                || !value.starts_with("sha256:")
                || !value[7..].bytes().all(|c| c.is_ascii_hexdigit())
            {
                return Err("Invalid content digest".into());
            }
            out["content_digest"] = json!(value);
        }
        if matches!(kind, "note" | "sessions") {
            let (date, file) = name
                .split_once('/')
                .ok_or("Invalid managed document identity")?;
            if date.len() != 8
                || !date.bytes().all(|v| v.is_ascii_digit())
                || file.contains('/')
                || !file.ends_with(".md")
            {
                return Err("Invalid managed document identity".into());
            }
            let captured = join(root, &format!("sources/{kind}/{name}"));
            // These source kinds have no registry: their committed file is the identity.
            text(reader, &captured)?;
            out["materialized_at"] = json!(captured);
            return Ok(out);
        }
        if !matches!(kind, "repo" | "file" | "lark") {
            return Err("Unsupported source type".into());
        }
        let registry = self.yaml(reader, &join(root, &format!("sources/{kind}/index.yaml")))?;
        let entries = registry["sources"]
            .as_array()
            .ok_or("Missing registry sources")?;
        let mut found = Vec::new();
        for batch in entries {
            if let Some(modules) = batch["modules"].as_array() {
                let namespace = string(batch, "name")?;
                for entry in modules {
                    let entry_name = string(entry, "name")?;
                    let id = entry["id"].as_str().unwrap_or(entry_name);
                    if name == format!("{namespace}/{entry_name}")
                        || name == format!("{namespace}/{id}")
                    {
                        found.push((entry, Some(namespace)));
                    }
                }
            } else if kind != "repo" {
                let entry_name = string(batch, "name")?;
                if name == entry_name || batch["id"].as_str() == Some(name) {
                    found.push((batch, None));
                }
            }
        }
        if found.len() != 1 {
            return Err("Source registration is missing or ambiguous".into());
        }
        let (entry, namespace) = found[0];
        if kind == "repo" {
            let remote = string(&entry["git"], "remote")?;
            if !safe_remote(remote) {
                return Err("Source remote is unsafe or contains credentials".into());
            }
            let revision = string(&entry["git"], "ref")?;
            if revision.chars().any(char::is_control) {
                return Err("Invalid source ref".into());
            }
            let subpath = entry["subpath"].as_str().unwrap_or("");
            if !subpath.is_empty() && !safe_path(subpath) {
                return Err("Unsafe source subpath".into());
            }
            out["path"] = json!(join(subpath, path));
            out["remote"] = json!(remote);
            out["ref"] = json!(revision);
            if let Some(url) = code_url(remote, revision, &join(subpath, path), start, end) {
                let mut compact = json!({"url":url});
                if digest {
                    compact["content_digest"] = out["content_digest"].clone();
                }
                return Ok(compact);
            }
        } else {
            let base = format!(
                "sources/{kind}/{}",
                namespace.unwrap_or(string(entry, "name")?)
            );
            let materialized = entry["materializedAt"].as_str().unwrap_or(&base);
            if !safe_path(materialized)
                || !(materialized == base || materialized.starts_with(&format!("{base}/")))
            {
                return Err("Unsafe source snapshot path".into());
            }
            out["materialized_at"] = json!(join(root, materialized));
            if kind == "lark" {
                let identities: Vec<_> = ["url", "docToken", "wikiToken"]
                    .into_iter()
                    .filter(|k| entry[*k].is_string())
                    .collect();
                if identities.len() != 1 {
                    return Err("Ambiguous document identity".into());
                }
                for field in identities {
                    let value = string(entry, field)?;
                    if field == "url"
                        && !(value.starts_with("https://") || value.starts_with("http://"))
                        || value.chars().any(char::is_control)
                    {
                        return Err("Unsafe document identity".into());
                    }
                    if field == "url" && value.split('/').nth(2).is_some_and(|s| s.contains('@')) {
                        return Err("Document URL contains credentials".into());
                    }
                    out[field] = json!(value);
                }
            }
            let manifest = entry["snapshot"]["manifest"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| namespace.map(|_| format!("{base}/manifest.json")));
            if let Some(manifest) = manifest {
                if !safe_path(&manifest) || !manifest.starts_with(&format!("{base}/")) {
                    return Err("Unsafe snapshot manifest".into());
                }
                out["manifest"] = json!(join(root, &manifest));
            }
        }
        Ok(out)
    }
}
