const BOM = "\uFEFF";

export function normalizeMarkdown(input: string): string {
  let text = input;

  // § 5.3.1 char layer: Unicode NFC + strip BOM
  text = text.normalize("NFC");
  if (text.startsWith(BOM)) {
    text = text.slice(BOM.length);
  }

  // § 5.3.2 text layer
  // unify line endings to \n
  text = text.replace(/\r\n?/g, "\n");

  // strip trailing whitespace per line (preserve leading indentation)
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n");

  // collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, "\n\n");

  // unify list markers * / + to - (only when at line start, followed by space)
  text = text.replace(/^(\s*)[*+]([ \t])/gm, "$1-$2");

  // close unclosed fence blocks (if ``` count is odd, append a closing fence)
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 === 1) {
    if (!text.endsWith("\n")) text += "\n";
    text += "```\n";
  }

  return text;
}

export function slugify(input: string, maxLen = 60): string {
  let s = input.normalize("NFC").toLowerCase();
  s = s.replace(/[\s\u3000]+/g, "-");
  s = s.replace(/[^a-z0-9\-\u4e00-\u9fff]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/g, "");
  if (s.length === 0) s = "untitled";
  return s;
}
