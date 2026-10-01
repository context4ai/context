#[cfg(target_arch = "wasm32")]
mod abi;
mod sections;
mod sources;

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const MAX_FILE: usize = 8 * 1024 * 1024;
const MAX_OUTPUT: usize = 64 * 1024;
const MAX_CACHE: usize = 12 * 1024 * 1024;

pub trait Reader {
    fn read(&mut self, path: &str) -> Result<Vec<u8>, String>;
}

#[derive(Deserialize)]
pub struct Input {
    pub abi_version: u32,
    pub operation: String,
    #[serde(default)]
    pub args: Option<Args>,
    pub files: Vec<File>,
}
#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Args {
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub include_digest: bool,
}
#[derive(Deserialize)]
pub struct File {
    pub item_id: String,
    pub path: String,
    pub start_line: u64,
    pub end_line: u64,
    pub content: String,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Default)]
pub struct Engine {
    // The host MUST bind an instance to one immutable repository/revision/scope.
    yaml: HashMap<String, Value>,
    outlines: HashMap<String, Vec<sections::Section>>,
    cache_bytes: usize,
}

pub fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', ':'])
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
}
fn join(root: &str, path: &str) -> String {
    if root.is_empty() {
        path.into()
    } else {
        format!("{root}/{path}")
    }
}
fn text(reader: &mut impl Reader, path: &str) -> Result<String, String> {
    if !safe_path(path) {
        return Err("Unsafe repository-relative path".into());
    }
    let bytes = reader.read(path)?;
    if bytes.len() > MAX_FILE {
        return Err("File exceeds plugin read budget".into());
    }
    String::from_utf8(bytes).map_err(|_| "File is not UTF-8".into())
}
fn issue(code: &str, message: &str, path: &str) -> Value {
    json!({"code": code, "message": message, "path": path})
}

pub fn diagnostic(code: &str, message: &str) -> Value {
    json!({"attachments":[{"text":format!("diagnostics:\n- {}", json!({"code":code,"message":message}))}]})
}

fn attachment(item_id: &str, sections: Vec<Value>, issues: Vec<Value>) -> Option<Value> {
    let mut seen = HashSet::new();
    let mut references = Vec::new();
    for section in sections {
        for reference in section["references"].as_array().into_iter().flatten() {
            let value = if reference
                .as_object()
                .is_some_and(|o| o.len() == 1 && o.contains_key("url"))
            {
                reference["url"].clone()
            } else {
                reference.clone()
            };
            if seen.insert(value.to_string()) {
                references.push(value);
            }
        }
    }
    if references.is_empty() && issues.is_empty() {
        return None;
    }
    let mut body = serde_json::Map::new();
    if !references.is_empty() {
        body.insert("references".into(), json!(references));
    }
    if !issues.is_empty() {
        body.insert("diagnostics".into(), json!(issues));
    }
    // Serialize, rather than interpolate, repository-controlled strings.
    let text = serde_yaml_ng::to_string(&body).expect("JSON values are YAML serializable");
    Some(json!({"item_id":item_id,"text":text}))
}

impl Engine {
    fn trim_cache(&mut self, size: usize) {
        if self.cache_bytes.saturating_add(size) > MAX_CACHE {
            self.yaml.clear();
            self.outlines.clear();
            self.cache_bytes = 0;
        }
        self.cache_bytes += size;
    }
    fn yaml(&mut self, reader: &mut impl Reader, path: &str) -> Result<&Value, String> {
        if !self.yaml.contains_key(path) {
            let content = text(reader, path)?;
            // Reject duplicate YAML keys instead of replacing them in a JSON map.
            // The YAML deserializer also limits depth and alias expansion work.
            let yaml: serde_yaml_ng::Value = serde_yaml_ng::from_str(&content)
                .map_err(|_| "Invalid YAML metadata".to_string())?;
            let value: Value =
                serde_json::to_value(yaml).map_err(|_| "Unsupported YAML metadata".to_string())?;
            self.trim_cache(content.len().saturating_mul(2));
            self.yaml.insert(path.into(), value);
        }
        Ok(&self.yaml[path])
    }
    pub fn enrich(&mut self, input: Input, reader: &mut impl Reader) -> Value {
        let mut output = Vec::new();
        let args = input.args.unwrap_or_default();
        let root = args.workspace_root.as_deref().unwrap_or(".");
        let root = if root == "." { "" } else { root };
        let mut ids = HashSet::new();
        if input.abi_version != 2
            || (!root.is_empty() && !safe_path(root))
            || !matches!(input.operation.as_str(), "read" | "read_many")
            || input.files.len() > 10
            || input.files.iter().any(|f| {
                f.item_id.is_empty()
                    || f.item_id.len() > 256
                    || f.item_id.chars().any(char::is_control)
                    || !ids.insert(f.item_id.clone())
            })
        {
            return diagnostic("INVALID_INPUT", "Expected ABI 2, unique nonempty item IDs, a safe workspace root and at most 10 read items");
        }
        let prefix = join(root, "knowledge/");
        let structure_path = join(root, "knowledge/structure.yaml");
        for file in input.files {
            let mut issues = Vec::new();
            let Some(article_path) = file.path.strip_prefix(&prefix) else {
                continue;
            };
            if !article_path.ends_with(".md") {
                continue;
            }
            let result = (|| -> Result<Vec<Value>, String> {
                if !safe_path(&file.path) || file.start_line == 0 || file.end_line < file.start_line
                {
                    return Err("Invalid returned file range".into());
                }
                // Use full immutable Markdown only to locate markers. Never return
                // unseen article text or treat the requested range as returned text.
                if !self.outlines.contains_key(&file.path) {
                    let full = text(reader, &file.path)?;
                    let outline = sections::sections(&full)?;
                    self.trim_cache(full.len());
                    self.outlines.insert(file.path.clone(), outline);
                }
                let selected: Vec<_> = self.outlines[&file.path]
                    .iter()
                    .filter(|s| s.start <= file.end_line && s.end >= file.start_line)
                    .cloned()
                    .collect();
                if selected.is_empty() {
                    return Ok(Vec::new());
                }
                let structure = self.yaml(reader, &structure_path)?;
                if structure["schema_version"] != "context.approved-structure.v1" {
                    return Err("Unsupported approved structure schema".into());
                }
                let articles = structure["articles"]
                    .as_array()
                    .ok_or("Missing structure articles")?;
                let matches: Vec<_> = articles
                    .iter()
                    .filter(|a| a["path"] == article_path)
                    .collect();
                if matches.len() != 1 {
                    return Err("Article structure is missing or ambiguous".into());
                }
                let registered = matches[0]["sections"]
                    .as_array()
                    .ok_or("Missing structure sections")?
                    .clone();
                let mut results = Vec::new();
                for section in selected {
                    let matches: Vec<_> = registered
                        .iter()
                        .filter(|s| s["id"] == section.id)
                        .collect();
                    if matches.len() != 1 {
                        issues.push(json!({"code":"SECTION_UNRESOLVED","message":"Section registration is missing or ambiguous","path":file.path,"section_id":section.id}));
                        continue;
                    }
                    let Some(refs) = matches[0]["references"].as_array() else {
                        return Err("Missing section references".into());
                    };
                    let mut references = Vec::new();
                    let mut seen = HashSet::new();
                    for reference in refs {
                        match self.reference(reader, root, reference, args.include_digest) {
                            Ok(value) => { if seen.insert(value.to_string()) { references.push(value); } },
                            Err(message) => issues.push(json!({"code":"SOURCE_UNRESOLVED","message":message,"path":file.path,"section_id":section.id,"source_ref":reference["source_ref"]})),
                        }
                    }
                    results.push(
                        json!({"path":file.path,"section_id":section.id,"references":references}),
                    );
                }
                Ok(results)
            })();
            let values = match result {
                Ok(values) => values,
                Err(message) => {
                    issues.push(issue("EVIDENCE_UNAVAILABLE", &message, &file.path));
                    Vec::new()
                }
            };
            if let Some(value) = attachment(&file.item_id, values, issues) {
                output.push(value);
            }
        }
        let result = json!({"attachments":output});
        if result.to_string().len() > MAX_OUTPUT {
            return diagnostic(
                "OUTPUT_LIMIT",
                "Evidence exceeds output budget; read a narrower range",
            );
        }
        result
    }
}
