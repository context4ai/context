export function structureSummaryStyles(input: {
  judgementBorder: string;
  judgementBg: string;
  judgementColor: string;
}): string {
  return `
    :root,[data-theme="light"] { color-scheme:light; --bg:#f1f1f2; --surface:#fdfdfd; --text:#181818; --secondary:#535353; --muted:#717171; --line:#e5e5e5; --brand:#ef6f2e; --brand-muted:rgba(239,111,46,.12); --brand-border:rgba(255,180,130,.65); --ok:#059669; --warn:#d97706; --danger:#dc2626; --ok-bg:#eaf6f0; --warn-bg:#fdf1e3; --danger-bg:#fdecec; }
    [data-theme="dark"] { color-scheme:dark; --bg:#181818; --surface:#252525; --text:#fbfbfb; --secondary:#b5b5b5; --muted:#8a8a8a; --line:#343434; --brand:#f1844d; --brand-muted:rgba(239,111,46,.16); --brand-border:rgba(255,180,130,.52); --ok:#3ecf8e; --warn:#f59e0b; --danger:#ef4444; --ok-bg:#17382c; --warn-bg:#3b2c16; --danger-bg:#3d2020; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { max-width:1160px; margin:0 auto; padding:28px 22px 52px; }
    h1,h2,h3,h4,p { margin:0; }
    h1 { font-size:24px; font-weight:400; }
    h2 { font-size:20px; font-weight:400; }
    h3 { font-size:16px; font-weight:400; }
    h4 { font-size:14px; font-weight:400; margin:18px 0 8px; }
    p { color:var(--secondary); }
    strong { font-weight:400; }
    table { width:100%; border-collapse:collapse; }
    th,td { text-align:left; vertical-align:top; border-top:1px solid var(--line); padding:9px 10px; }
    th { color:var(--muted); font-size:12px; font-weight:400; }
    caption { text-align:left; padding:0 0 8px; font-weight:400; }
    code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
    .i18n.zh { display:none; }
    html[data-lang="zh"] .i18n.en { display:none; }
    html[data-lang="zh"] .i18n.zh { display:inline; }
    .hero,.panel { background:var(--surface); border:1px solid var(--line); border-radius:10px; }
    .hero { padding:20px; margin-bottom:16px; }
    .hero-row { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; }
    .theme-toggle { width:40px; height:40px; flex:0 0 auto; display:inline-grid; place-items:center; border:1px solid var(--line); border-radius:7px; background:transparent; color:var(--text); cursor:pointer; font-size:18px; }
    .theme-toggle:hover { border-color:var(--brand); }
    .judgement { margin-top:10px; display:inline-flex; flex-wrap:wrap; gap:6px; align-items:center; border:1px solid ${input.judgementBorder}; background:${input.judgementBg}; color:${input.judgementColor}; border-radius:999px; padding:5px 11px; }
    .stats { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
    .stats > span,.count-pill { display:inline-flex; gap:5px; align-items:center; border:1px solid var(--line); border-radius:999px; padding:4px 9px; background:transparent; color:var(--muted); }
    .stats strong { color:var(--text); }
    .panel { padding:18px; margin-top:16px; }
    .section-title-row { display:flex; justify-content:space-between; gap:14px; align-items:center; margin-bottom:12px; }
    .attention.ok { border-color:rgba(5,150,105,.35); background:var(--ok-bg); }
    .attention-group + .attention-group { margin-top:18px; }
    .attention-group h3 { margin-bottom:10px; }
    .attention-group-body { display:grid; gap:10px; }
    .attention-item { border:1px solid var(--line); border-left-width:3px; border-radius:8px; padding:13px 15px; background:transparent; }
    .attention-item strong { display:block; font-size:15px; }
    .attention-item.danger { border-left-color:var(--danger); }
    .attention-item.danger strong { color:var(--danger); }
    .attention-item.warn { border-left-color:var(--warn); }
    .attention-item.warn strong { color:var(--warn); }
    .attention-item.info { border-left-color:var(--brand-border); }
    .explain { margin-top:9px; display:grid; gap:6px; }
    .explain-row { display:grid; grid-template-columns:minmax(92px,max-content) minmax(0,1fr); gap:18px; align-items:baseline; }
    .explain-row .k { color:var(--muted); font-size:12px; }
    .explain-row .v { color:var(--secondary); }
    .attention-detail { margin-top:10px; color:var(--muted); font-size:12px; }
    .attention-group > .attention-note { margin:-4px 0 12px; color:var(--muted); font-size:12px; }
    .attention-notes { margin:10px 0 0; padding-left:18px; display:grid; gap:5px; color:var(--secondary); font-size:12px; }
    .attention-notes li { list-style:disc; }
    .structure-tree { border-top:1px solid var(--line); padding-top:12px; }
    .subsection-title-row { display:flex; justify-content:space-between; gap:12px; align-items:center; margin:0 0 10px; }
    .collection { border-top:1px solid var(--line); padding:10px 0; }
    .collection:first-child { border-top:0; padding-top:0; }
    .collection > summary { cursor:pointer; display:flex; align-items:center; gap:8px; list-style:none; }
    .collection > summary::-webkit-details-marker { display:none; }
    .collection > summary::before { content:"▸"; color:var(--secondary); font-size:15px; line-height:1; width:16px; text-align:center; }
    .collection[open] > summary::before { content:"▾"; }
    .collection-name { font-size:16px; flex:1; }
    .collection-body { margin:8px 0 0 5px; padding-left:16px; border-left:1px solid var(--line); }
    .collection-body > .tree { margin-top:0; }
    .tree-more { margin-top:8px; }
    .tree { list-style:none; margin:8px 0 0; padding-left:0; }
    .tree .tree { border-left:1px solid var(--line); margin-left:13px; padding-left:16px; }
    .tree li { margin:8px 0; }
    .tree-node { display:flex; flex-wrap:wrap; gap:7px; align-items:center; }
    .node-title { font-weight:400; }
    .node-badges { display:inline-flex; flex-wrap:wrap; gap:4px; vertical-align:middle; }
    .badge { display:inline-flex; align-items:center; border:1px solid var(--line); border-radius:999px; padding:1px 7px; color:var(--muted); background:transparent; font-size:12px; font-weight:400; }
    .badge.kind { color:var(--brand); border-color:var(--brand-border); background:transparent; }
    .typed-relations { border-top:1px solid var(--line); margin-top:18px; padding-top:14px; }
    .typed-relations.empty { color:var(--muted); }
    .relation-list { display:grid; gap:8px; margin-top:10px; }
    .relation { display:grid; grid-template-columns:minmax(0,1fr) max-content minmax(0,1fr); gap:8px; align-items:center; border:1px solid var(--line); border-radius:8px; padding:8px; background:transparent; }
    .relation > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .relation strong { color:var(--brand); white-space:nowrap; font-weight:400; }
    .page-grid { display:grid; gap:10px; }
    .page-card { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px 16px; border-top:1px solid var(--line); padding:13px 0; }
    .page-card:first-child { border-top:0; }
    .page-main h3 { display:flex; flex-wrap:wrap; gap:7px; align-items:center; margin-bottom:4px; }
    .path-line { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:var(--muted); overflow-wrap:anywhere; }
    .sources { display:flex; flex-wrap:wrap; gap:5px; margin-top:7px; align-items:center; }
    .sources > span { display:inline-flex; border:1px solid var(--line); border-radius:6px; padding:1px 7px; background:transparent; color:var(--muted); font-size:12px; }
    .sources .src-label { border:0; padding:0; color:var(--muted); font-size:12px; }
    .page-status { margin-top:7px; color:var(--muted); font-size:12px; }
    .page-side { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; align-content:flex-start; min-width:210px; }
    .page-side > span { border:1px solid var(--line); border-radius:8px; padding:5px 8px; color:var(--muted); background:transparent; }
    .page-side strong { margin-right:4px; color:var(--text); }
    .page-flags { grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:6px; }
    .page-flags .flag { display:inline-flex; align-items:center; gap:4px; border:1px solid rgba(217,119,6,.4); border-radius:6px; padding:1px 8px; background:var(--warn-bg); color:var(--warn); font-size:12px; text-decoration:none; }
    .page-flags .flag::before { content:"⚠"; font-size:11px; }
    .page-flags .flag::after { content:"↗"; opacity:.55; font-size:11px; }
    .page-flags .flag:hover,.page-flags .flag:focus { border-color:var(--warn); outline:none; }
    .appendix > summary,.detail-block > summary,.sub-detail > summary { cursor:pointer; font-weight:400; }
    .detail-block,.sub-detail { border-top:1px solid var(--line); padding:12px 0; }
    .appendix-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; }
    .mini-stats { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0 12px; }
    .mini-stats span { border:1px solid var(--line); border-radius:999px; padding:3px 8px; color:var(--muted); }
    .copy-code { display:inline-block; max-width:min(72vw,720px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; cursor:pointer; border:1px solid transparent; border-radius:5px; padding:1px 3px; }
    .copy-code:hover,.copy-code:focus { border-color:var(--brand-border); background:var(--brand-muted); outline:none; }
    .copy-code[data-copied="true"]::after { content:" Copied"; color:var(--brand); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; font-size:11px; }
    html[data-lang="zh"] .copy-code[data-copied="true"]::after { content:" 已复制"; }
    .muted { color:var(--muted); }
    .num { text-align:right; white-space:nowrap; }
    @media (max-width:800px) {
      main { padding:18px 12px 36px; }
      .hero-row,.page-card { grid-template-columns:1fr; display:grid; }
      .explain-row { grid-template-columns:minmax(72px,max-content) minmax(0,1fr); gap:12px; }
      .page-side { justify-content:flex-start; min-width:0; }
      .relation { grid-template-columns:1fr; }
    }
  `;
}
