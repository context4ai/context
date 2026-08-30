export interface SqlSourceStatement {
  text: string;
  startOffset: number;
  line: number;
  column: number;
}

interface SqlLexicalState {
  quote: "'" | "\"" | "`" | "]" | null;
  dollarTag: string | null;
  lineComment: boolean;
  blockDepth: number;
}

function position(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function dollarTagAt(source: string, offset: number): string | null {
  if (source[offset] !== "$") return null;
  const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(source.slice(offset));
  return match?.[0] ?? null;
}

function sqlTokenStart(source: string): number {
  let index = 0;
  while (index < source.length) {
    if (/\s/u.test(source[index]!)) {
      index += 1;
      continue;
    }
    if (source.startsWith("--", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }
    break;
  }
  return index;
}

function pushStatement(source: string, start: number, end: number, statements: SqlSourceStatement[]): void {
  const raw = source.slice(start, end);
  const leading = sqlTokenStart(raw);
  const text = raw.slice(leading).trimEnd();
  if (text.length === 0) return;
  const startOffset = start + leading;
  statements.push({ text, startOffset, ...position(source, startOffset) });
}

function consumeActiveRegion(source: string, index: number, state: SqlLexicalState): number | null {
  const current = source[index]!;
  const next = source[index + 1];
  if (state.lineComment) {
    if (current === "\n") state.lineComment = false;
    return index;
  }
  if (state.blockDepth > 0) {
    if (current === "/" && next === "*") {
      state.blockDepth += 1;
      return index + 1;
    }
    if (current === "*" && next === "/") {
      state.blockDepth -= 1;
      return index + 1;
    }
    return index;
  }
  if (state.dollarTag !== null) {
    if (!source.startsWith(state.dollarTag, index)) return index;
    const end = index + state.dollarTag.length - 1;
    state.dollarTag = null;
    return end;
  }
  if (state.quote === null) return null;
  if (state.quote === "]") {
    if (current === "]" && next === "]") return index + 1;
    if (current === "]") state.quote = null;
    return index;
  }
  if (current === "\\") return index + 1;
  if (current === state.quote && next === state.quote) return index + 1;
  if (current === state.quote) state.quote = null;
  return index;
}

/** Splits top-level SQL semicolons while preserving quoted/commented bodies. */
export function splitSqlStatements(source: string): SqlSourceStatement[] {
  const statements: SqlSourceStatement[] = [];
  let start = 0;
  const state: SqlLexicalState = { quote: null, dollarTag: null, lineComment: false, blockDepth: 0 };
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]!;
    const next = source[index + 1];
    const consumed = consumeActiveRegion(source, index, state);
    if (consumed !== null) {
      index = consumed;
      continue;
    }
    if (current === "-" && next === "-") {
      state.lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      state.blockDepth = 1;
      index += 1;
      continue;
    }
    if (current === "'" || current === "\"" || current === "`") {
      state.quote = current;
      continue;
    }
    if (current === "[") {
      state.quote = "]";
      continue;
    }
    const tag = dollarTagAt(source, index);
    if (tag !== null) {
      state.dollarTag = tag;
      index += tag.length - 1;
      continue;
    }
    if (current === ";") {
      pushStatement(source, start, index, statements);
      start = index + 1;
    }
  }
  if (state.quote !== null || state.dollarTag !== null || state.blockDepth > 0) {
    throw new SyntaxError("unterminated SQL quote, dollar body, or block comment");
  }
  pushStatement(source, start, source.length, statements);
  return statements;
}
