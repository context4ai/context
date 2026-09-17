/** Reader typography shared by the website and standalone Review. */
export function readerContentStyles(selector: string): string {
  return String.raw`
.vp-doc { font-size: 16px; line-height: 1.8; color: var(--vp-c-text-1); }
.vp-doc hr { margin: 28px 0; border: 0; border-top: 1px solid var(--vp-c-divider); height: 0; }
.vp-doc p, .vp-doc li { line-height: 1.8; }
.vp-doc h1 { font-size: 36px; font-weight: 700; line-height: 1.3; letter-spacing: -.025em; margin-bottom: 28px; }
.vp-doc h2 { font-size: 25px; font-weight: 650; line-height: 1.4; margin: 46px 0 22px; padding: 0 0 14px; border-top: 0; border-bottom: 1px solid var(--vp-c-divider); }
.vp-doc h3 { font-size: 19px; font-weight: 600; line-height: 1.5; margin: 30px 0 14px; }
.vp-doc a { color: inherit; font-weight: 500; text-decoration: none; border-bottom: 1px solid transparent; transition: color .15s, border-color .15s; }
.vp-doc a:hover { color: var(--vp-c-brand-1); border-bottom-color: currentColor; }
.vp-doc a.header-anchor { top: -0.06em !important; line-height: inherit; border: 0; color: var(--vp-c-brand-1); }
.vp-doc blockquote { margin: 24px 0; padding: 16px 20px; border-left: 3px solid var(--context-accent); border-radius: 0 5px 5px 0; background: var(--vp-c-brand-soft); color: var(--vp-c-text-2); }
.vp-doc blockquote p { margin: 0; font-size: 15px; }
.vp-doc blockquote a { color: var(--vp-c-brand-1); }
.vp-doc table { width: 100%; overflow-x: auto; font-size: 14px; border-collapse: collapse; margin: 24px 0; }
.vp-doc th { background: var(--vp-sidebar-bg-color); font-weight: 600; }
.vp-doc th, .vp-doc td { padding: 11px 14px; border-color: var(--vp-c-divider); line-height: 1.7; }
.vp-doc tr:nth-child(2n) { background: var(--vp-c-bg); }
.vp-doc :not(pre) > code { font-size: .88em; color: var(--vp-c-text-1); background: var(--vp-sidebar-bg-color); border: 1px solid var(--vp-c-divider); border-radius: 4px; }
.vp-doc div[class*='language-'] { border: 1px solid var(--vp-c-divider); border-radius: 6px; }
.vp-doc details { margin: 20px 0; border: 1px solid var(--vp-c-divider); border-radius: 6px; padding: 12px 16px; }
.vp-doc summary { cursor: pointer; font-size: 14px; font-weight: 550; }
.vp-doc img { max-width: 100%; height: auto; }
`.replaceAll(".vp-doc", selector);
}
