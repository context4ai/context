/** Shared verbatim with the offline review page: no imports or external closures. */
export function createReviewCodeCodec() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function checksum(text: string): string {
    let crc = 0xffffffff;
    for (let i = 0; i < text.length; i++) {
      crc ^= text.charCodeAt(i);
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
  }
  function pack(bytes: number[]): string {
    let value = 0, bits = 0, result = "";
    for (const byte of bytes) {
      value = (value << 8) | byte; bits += 8;
      while (bits >= 6) { bits -= 6; result += alphabet[(value >>> bits) & 63]; }
    }
    if (bits) result += alphabet[(value << (6 - bits)) & 63];
    return result;
  }
  function unpack(text: string): number[] {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("Invalid review code encoding");
    let value = 0, bits = 0;
    const bytes: number[] = [];
    for (const char of text) {
      value = (value << 6) | alphabet.indexOf(char); bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
    }
    if (pack(bytes) !== text) throw new Error("Noncanonical review code encoding");
    return bytes;
  }
  function hash(text: string): string {
    if (!/^[a-f0-9]{64}$/.test(text)) throw new Error("Review requires a complete candidate digest");
    return pack(Array.from({ length: 32 }, (_, i) => Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)));
  }
  function unhash(text: string): string {
    const bytes = unpack(text);
    if (bytes.length !== 32) throw new Error("Invalid candidate digest");
    return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function encode(scope: string, idsHash: string, contentHash: string, statuses: string[]): string[] {
    if (!/^[a-z][a-z0-9-]*$/.test(scope) || !statuses.length || statuses.length > 1_000_000 ||
      statuses.some((status) => status !== "approved" && status !== "rejected")) {
      throw new Error("Resolve every page before copying review results");
    }
    const mode = statuses.every((s) => s === "approved") ? "a" : statuses.every((s) => s === "rejected") ? "r" : "b";
    const bytes = Array<number>(Math.ceil(statuses.length / 8)).fill(0);
    if (mode === "b") statuses.forEach((s, i) => { if (s === "rejected") bytes[i >> 3]! |= 1 << (i % 8); });
    const body = ["CR1", scope, statuses.length, hash(idsHash), hash(contentHash), mode, mode === "b" ? pack(bytes) : ""].join(".");
    const code = `${body}.${checksum(body)}`;
    if (code.length <= 980) return [code];
    const total = Math.ceil(code.length / 900);
    const identity = checksum(code);
    return Array.from({ length: total }, (_, i) => `CRP1.${identity}.${i + 1}.${total}.${code.slice(i * 900, (i + 1) * 900)}`);
  }
  function decode(input: string) {
    if (input.length > 250_000) throw new Error("Review code exceeds the supported size");
    const lines = input.trim().split(/\s+/);
    let code = lines[0]!;
    if (code.startsWith("CRP1.")) {
      const parts = new Map<number, string>();
      let identity = "", total = 0;
      for (const line of lines) {
        const match = /^CRP1\.([a-f0-9]{8})\.([1-9][0-9]*)\.([1-9][0-9]*)\.(.+)$/.exec(line);
        if (!match || line.length > 980) throw new Error("Invalid review code segment");
        const index = Number(match[2]), count = Number(match[3]);
        if (count > 200 || index > count || parts.has(index) || (total && (total !== count || identity !== match[1]))) {
          throw new Error("Duplicate or mixed review code segments");
        }
        identity = match[1]!; total = count; parts.set(index, match[4]!);
      }
      if (parts.size !== total) throw new Error(`Missing review code segments: received ${parts.size} of ${total}; collect all segments before applying`);
      code = Array.from({ length: total }, (_, i) => parts.get(i + 1)).join("");
      if (checksum(code) !== identity) throw new Error("Review code segment checksum mismatch");
    } else if (lines.length !== 1 || code.length > 980) throw new Error("Copy each complete review code segment unchanged");
    const fields = code.split(".");
    if (fields.length !== 8 || fields[0] !== "CR1" || checksum(fields.slice(0, 7).join(".")) !== fields[7]) {
      throw new Error("Review code is damaged or unsupported; copy it again from the report");
    }
    const [, scope, countText, ids, content, mode, data] = fields;
    if (!/^[a-z][a-z0-9-]*$/.test(scope!) || !/^[1-9][0-9]*$/.test(countText!)) throw new Error("Invalid review scope");
    const count = Number(countText);
    if (count > 1_000_000 || !["a", "r", "b"].includes(mode!)) throw new Error("Invalid review decisions");
    const bytes = unpack(data!);
    if (mode === "b" ? bytes.length !== Math.ceil(count / 8) || (count % 8 !== 0 && bytes.at(-1)! >>> (count % 8) !== 0) : data !== "") {
      throw new Error("Invalid review decision bitmap");
    }
    const statuses = Array.from({ length: count }, (_, i): "approved" | "rejected" =>
      mode === "r" || (mode === "b" && (bytes[i >> 3]! & (1 << (i % 8)))) ? "rejected" : "approved");
    return { scope: scope!, count, idsHash: unhash(ids!), contentHash: unhash(content!), statuses };
  }
  return { encode, decode };
}
