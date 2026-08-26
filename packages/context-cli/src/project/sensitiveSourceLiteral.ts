export interface SensitiveSourceLiteralCandidate {
  line: number;
  label: string;
  value_length: number;
}

const LABELED_SECRET_RE = /\b(password|passwd|secret(?:[ _-]?key)?|access[ _-]?key|api[ _-]?key|private[ _-]?key|access[ _-]?token|refresh[ _-]?token|session[ _-]?token)\b\s*(?:[:=|]\s*|\s{2,})["']?([A-Za-z0-9/+_.-]{12,})/giu;
const PLACEHOLDER_RE = /^(?:x{4,}|\*{4,}|redacted|example|sample|placeholder|changeme|your[_-].+|<.+>|\[.+\])$/iu;

function resemblesSecret(value: string): boolean {
  if (PLACEHOLDER_RE.test(value)) return false;
  const classes = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(value)).length;
  return value.length >= 20 || classes >= 3;
}

export function sensitiveSourceLiteralCandidates(value: string): SensitiveSourceLiteralCandidate[] {
  const candidates: SensitiveSourceLiteralCandidate[] = [];
  for (const match of value.matchAll(LABELED_SECRET_RE)) {
    const secret = match[2]!;
    if (!resemblesSecret(secret)) continue;
    candidates.push({
      line: value.slice(0, match.index).split(/\r?\n/u).length,
      label: match[1]!.toLowerCase().replace(/[ _-]+/gu, "-"),
      value_length: secret.length,
    });
  }
  return candidates;
}
