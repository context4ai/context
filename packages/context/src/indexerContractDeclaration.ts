/** Compact only information already represented in API rows. Unknown syntax
 * and unique comments remain available; this is not a TypeScript evaluator. */
export function compactContractDeclaration(raw: string, rows: string[][]): string | undefined {
  const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
  const notes = rows.map(row => row[5] ?? "");
  let declaration = "";
  let plain = "";
  const flush = () => {
    // Compact only code whitespace, never the contents of literals or retained
    // comments. Keep the indentation of the next nonempty line.
    declaration += plain.replace(/[ \t]*(?:\r?\n[ \t]*)+/gu, space =>
      (space.includes("\r\n") ? "\r\n" : "\n") + (/[ \t]*$/u.exec(space)?.[0] ?? ""));
    plain = "";
  };
  for (let i = 0; i < raw.length;) {
    const quote = raw[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      const start = i++;
      while (i < raw.length) {
        if (raw[i] === "\\") { i += 2; continue; }
        if (raw[i++] === quote) break;
      }
      flush();
      declaration += raw.slice(start, i);
    } else if (raw.startsWith("//", i)) {
      const end = raw.indexOf("\n", i);
      const next = end < 0 ? raw.length : end;
      flush();
      declaration += raw.slice(i, next);
      i = next;
    } else if (raw.startsWith("/*", i)) {
      const end = raw.indexOf("*/", i + 2);
      if (end < 0) { flush(); declaration += raw.slice(i); break; }
      const comment = raw.slice(i, end + 2);
      const body = comment.slice(2, -2).replace(/^\s*\* ?/gmu, "").trim();
      const prose = normalize(body.split(/@\w/u)[0] ?? "");
      const tags = [...body.matchAll(/@(\w+)/gu)].map(match => match[1]);
      // Unknown tags (deprecated, examples, constraints...) are not redundant.
      const duplicate = prose.length > 0 && notes.some(note => normalize(note).includes(prose))
        && tags.every(tag => tag === "i18n" || (tag === "default" || tag === "defaultValue")
          && rows.some(row => row[4] !== "unknown" && new RegExp(`@${tag}\\s+${row[4]!.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:\\s|$)`, "u").test(body)));
      if (duplicate) plain += " ";
      else { flush(); declaration += comment; }
      i = end + 2;
    } else { plain += raw[i++]; }
  }
  flush();
  declaration = declaration.trim();
  // Only flat, explicitly represented property lists are safe to omit.
  // Intersections, inheritance, call signatures and nested types stay intact.
  if (/^\{[^{}]*\}$/u.test(declaration) && !declaration.includes("/*") && !declaration.includes("//")) {
    const fields = declaration.slice(1, -1).split(";").map(item => item.trim()).filter(Boolean);
    if (fields.length > 0 && fields.every(field => {
      const match = /^(readonly\s+)?([\w$]+)(\?)?\s*:\s*(.+)$/su.exec(field);
      return match !== null && rows.some(row => row[1] === match[2]
        && row[2]!.trim() === match[4]!.trim()
        && row[3] === (match[3] ? "optional" : "required")
        && (!match[1] || row[5]?.includes("readonly")));
    })) return undefined;
  }
  return declaration;
}
