export function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  }
  return w;
}

export function padToWidth(str: string, targetWidth: number): string {
  const currentWidth = displayWidth(str);
  const padCount = targetWidth - currentWidth;
  return str + " ".repeat(Math.max(0, padCount));
}

export function truncateToWidth(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const totalWidth = displayWidth(str);
  if (totalWidth <= maxWidth) return str;
  const ellipsis = "…";
  const ellipsisWidth = displayWidth(ellipsis);
  const budget = maxWidth - ellipsisWidth;
  if (budget <= 0) return ellipsis.slice(0, maxWidth);
  let w = 0;
  let i = 0;
  for (const ch of str) {
    const cw = ch.charCodeAt(0) > 0x7f ? 2 : 1;
    if (w + cw > budget) break;
    w += cw;
    i += ch.length;
  }
  return str.slice(0, i) + ellipsis;
}
