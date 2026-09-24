/** Legacy CLI input compatibility only. Never embedded in the reading report. */
export function createReviewFeedbackCodec() {
  type Feedback = { scope: string; idsHash: string; contentHash: string; baselineHash: string;
    statuses: Array<"approved" | "rejected" | "pending" | "revised">;
    repairs: Array<{ index: number; instruction: string }> };
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function checksum(text: string) {
    let crc = 0xffffffff;
    for (let i = 0; i < text.length; i++) { crc ^= text.charCodeAt(i); for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
  }
  function validate(value: Feedback): Feedback {
    if (!value || !/^[a-z][a-z0-9-]*$/.test(value.scope) ||
      ![value.idsHash, value.contentHash, value.baselineHash].every(h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)) ||
      !Array.isArray(value.statuses) || !value.statuses.length || value.statuses.length > 100000 ||
      value.statuses.some(s => !["approved", "rejected", "pending", "revised"].includes(s)) ||
      value.statuses.every(s => s === "pending") || !Array.isArray(value.repairs)) throw new Error("Invalid review feedback scope or decisions");
    const seen = new Set<number>();
    for (const repair of value.repairs) {
      if (!repair || !Number.isInteger(repair.index) || seen.has(repair.index) || value.statuses[repair.index] !== "revised" ||
        typeof repair.instruction !== "string" || !repair.instruction.trim() || repair.instruction.length > 20000)
        throw new Error("Invalid or conflicting revision instruction");
      seen.add(repair.index);
    }
    if (value.statuses.filter(s => s === "revised").length !== seen.size) throw new Error("Missing revision instruction");
    return value;
  }
  function encode(value: Feedback): string {
    validate(value);
    const bytes = new TextEncoder().encode(JSON.stringify({ scope: value.scope, idsHash: value.idsHash, contentHash: value.contentHash, baselineHash: value.baselineHash, statuses: value.statuses }));
    let bits = 0, carry = 0, data = "";
    for (const byte of bytes) { carry = (carry << 8) | byte; bits += 8; while (bits >= 6) { bits -= 6; data += alphabet[(carry >>> bits) & 63]; } }
    if (bits) data += alphabet[(carry << (6 - bits)) & 63];
    const body = `CR2.${data}`;
    const repairs = value.repairs.map(r => JSON.stringify([r.index, r.instruction])).join("\n");
    const trailer = repairs ? `\n${repairs}` : "";
    const code = `${body}.${checksum(body + trailer)}${trailer}`;
    if (code.length > 250000) throw new Error("Review feedback is too large; shorten instructions or review a smaller scope");
    return code;
  }
  function decode(raw: string): Feedback {
    const code = raw.trim();
    if (code.length > 250000) throw new Error("Review feedback exceeds supported size");
    const [header, ...lines] = code.split("\n");
    const trailer = lines.length ? `\n${lines.join("\n")}` : "";
    const match = /^CR2\.([A-Za-z0-9_-]+)\.([a-f0-9]{8})$/.exec(header!);
    if (!match || checksum(`CR2.${match[1]}` + trailer) !== match[2]) throw new Error("Review feedback is damaged or incomplete; copy the full code again");
    let bits = 0, carry = 0; const bytes: number[] = [];
    for (const char of match[1]!) { carry = (carry << 6) | alphabet.indexOf(char); bits += 6; if (bits >= 8) { bits -= 8; bytes.push((carry >>> bits) & 255); } }
    const headerValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes))) as Feedback;
    const value = validate({ ...headerValue, repairs: lines.map(line => {
      const row = JSON.parse(line) as unknown;
      if (!Array.isArray(row) || row.length !== 2) throw new Error("Invalid revision instruction line");
      return { index: row[0] as number, instruction: row[1] as string };
    }) });
    if (encode(value) !== code) throw new Error("Noncanonical review feedback encoding");
    return value;
  }
  return { encode, decode };
}
