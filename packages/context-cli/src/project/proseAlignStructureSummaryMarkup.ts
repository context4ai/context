export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

export function label(en: string, zh: string): string {
  return '<span class="i18n en">' + escapeHtml(en) + '</span><span class="i18n zh">' + escapeHtml(zh) + "</span>";
}
