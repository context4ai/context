export interface ThriftToken {
  kind: "identifier" | "string" | "number" | "symbol";
  value: string;
  line: number;
  column: number;
}

export class ThriftSyntaxError extends Error {
  constructor(message: string, readonly line: number, readonly column: number) {
    super(`${message} at ${line}:${column}`);
    this.name = "ThriftSyntaxError";
  }
}

export function lexThrift(source: string): ThriftToken[] {
  const tokens: ThriftToken[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;
  const advance = (): string => {
    const character = source[offset++]!;
    if (character === "\n") {
      line += 1;
      column = 1;
    } else column += 1;
    return character;
  };
  while (offset < source.length) {
    const character = source[offset]!;
    if (/\s/u.test(character)) {
      advance();
      continue;
    }
    if (character === "#" || (character === "/" && source[offset + 1] === "/")) {
      while (offset < source.length && advance() !== "\n") { /* comment */ }
      continue;
    }
    if (character === "/" && source[offset + 1] === "*") {
      const startLine = line;
      const startColumn = column;
      advance();
      advance();
      let closed = false;
      while (offset < source.length) {
        if (source[offset] === "*" && source[offset + 1] === "/") {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) throw new ThriftSyntaxError("unterminated block comment", startLine, startColumn);
      continue;
    }
    const tokenLine = line;
    const tokenColumn = column;
    if (character === "\"" || character === "'") {
      const quote = advance();
      let value = "";
      let closed = false;
      while (offset < source.length) {
        const next = advance();
        if (next === quote) {
          closed = true;
          break;
        }
        if (next === "\\" && offset < source.length) value += advance();
        else value += next;
      }
      if (!closed) throw new ThriftSyntaxError("unterminated string", tokenLine, tokenColumn);
      tokens.push({ kind: "string", value, line: tokenLine, column: tokenColumn });
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      let value = "";
      while (offset < source.length && /[A-Za-z0-9_.-]/u.test(source[offset]!)) value += advance();
      tokens.push({ kind: "identifier", value, line: tokenLine, column: tokenColumn });
      continue;
    }
    if (/[0-9+-]/u.test(character)) {
      let value = "";
      while (offset < source.length && /[0-9A-Fa-fxX.eE+-]/u.test(source[offset]!)) value += advance();
      tokens.push({ kind: "number", value, line: tokenLine, column: tokenColumn });
      continue;
    }
    if ("{}()[]<>,;:=*".includes(character)) {
      tokens.push({ kind: "symbol", value: advance(), line: tokenLine, column: tokenColumn });
      continue;
    }
    throw new ThriftSyntaxError(`unsupported character ${JSON.stringify(character)}`, line, column);
  }
  return tokens;
}
