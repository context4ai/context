export const REVIEW_HTML_STYLES = `
  :root, [data-theme="light"] {
    color-scheme: light;
    --sb-bg-base:#f1f1f2; --sb-bg-surface:#f7f7f7; --sb-bg-elevated:#fdfdfd; --sb-bg-hover:#ebebec; --sb-bg-active:#e1e1e4;
    --sb-text-primary:#181818; --sb-text-secondary:#535353; --sb-text-muted:#717171;
    --sb-border-default:#e5e5e5; --sb-border-strong:#d5d5d5;
    --sb-brand:#ef6f2e; --sb-brand-text:rgba(255,255,255,.85); --sb-brand-border:rgba(255,180,130,.65);
    --sb-success:#059669; --sb-error:#dc2626; --sb-warning:#d97706;
  }
  [data-theme="dark"] {
    color-scheme: dark;
    --sb-bg-base:#181818; --sb-bg-surface:#202020; --sb-bg-elevated:#252525; --sb-bg-hover:#2b2b2b; --sb-bg-active:#343434;
    --sb-text-primary:#fbfbfb; --sb-text-secondary:#b5b5b5; --sb-text-muted:#8a8a8a;
    --sb-border-default:#2f2f2f; --sb-border-strong:#3a3a3a;
    --sb-brand:#ef6f2e; --sb-brand-text:rgba(255,255,255,.85); --sb-brand-border:rgba(255,180,130,.65);
    --sb-success:#3ecf8e; --sb-error:#ef4444; --sb-warning:#f59e0b;
  }
  * { box-sizing: border-box; }
  html, body { height:100%; }
  body { margin:0; overflow:hidden; background:var(--sb-bg-base); color:var(--sb-text-primary); font:14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  button, textarea { font: inherit; }
  .shell { height:100vh; padding:22px; display:grid; grid-template-rows:auto minmax(0, 1fr); gap:18px; overflow:hidden; }
  .header { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:center; gap:16px; }
  .titleline { min-width:0; display:flex; flex-direction:column; align-items:flex-start; gap:4px; }
  #count-state { max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .toolbar { display:flex; align-items:center; gap:10px; justify-content:flex-end; white-space:nowrap; }
  .bulk-actions { display:flex; align-items:center; gap:8px; }
  h1 { margin:0; font-size:28px; font-weight:500; letter-spacing:0; }
  .subtle { color:var(--sb-text-secondary); }
  .layout { min-height:0; display:grid; grid-template-columns:minmax(260px, 375px) minmax(0, 1fr); gap:22px; align-items:stretch; }
  .panel { min-height:0; background:var(--sb-bg-surface); border:1px solid var(--sb-border-default); border-radius:8px; overflow:hidden; }
  .candidate-panel { display:grid; grid-template-rows:auto auto minmax(0, 1fr); }
  .detail-panel { display:grid; grid-template-rows:auto minmax(0, 1fr); }
  .panel-head { padding:14px 16px; border-bottom:1px solid var(--sb-border-default); color:var(--sb-text-secondary); font-size:12px; text-transform:uppercase; }
  .candidate-head { display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; gap:10px; }
  .filters { display:flex; align-items:center; gap:8px; text-transform:none; font-size:12px; }
  .filter { display:inline-flex; align-items:center; gap:5px; cursor:pointer; color:var(--sb-text-secondary); }
  .filter input { margin:0; accent-color:var(--sb-brand); }
  #list { min-height:0; overflow:auto; }
  .candidate-group { border-bottom:1px solid var(--sb-border-default); }
  .candidate-group-title { width:100%; display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:start; gap:10px; padding:12px 12px 8px 16px; color:var(--sb-text-secondary); font-size:12px; font-weight:600; overflow-wrap:anywhere; cursor:pointer; user-select:none; }
  .group-label { min-width:0; display:grid; grid-template-columns:auto minmax(0, 1fr); align-items:center; gap:7px; }
  .group-key { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .group-count { grid-column:2; justify-self:start; margin-top:4px; color:var(--sb-text-muted); font-weight:400; }
  .group-actions { display:grid; justify-items:end; gap:5px; flex:0 0 auto; }
  .group-btn { border:1px solid var(--sb-border-default); border-radius:999px; padding:2px 8px; background:transparent; color:var(--sb-text-secondary); cursor:pointer; font-size:12px; }
  .group-btn:hover { border-color:var(--sb-brand); color:var(--sb-text-primary); }
  .candidate { width:100%; display:block; text-align:left; padding:10px 16px 12px 30px; border:0; color:var(--sb-text-primary); background:transparent; cursor:pointer; }
  .candidate + .candidate { border-top:1px solid var(--sb-border-default); }
  .candidate:hover, .candidate.active { background:var(--sb-bg-hover); }
  .candidate-title { min-width:0; display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .candidate-title-text { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .candidate-tags { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
  .candidate-summary { display:-webkit-box; margin-top:5px; overflow:hidden; color:var(--sb-text-muted); font-size:12px; line-height:1.45; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
  .meta { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; color:var(--sb-text-muted); font-size:12px; }
  .badge { border:1px solid var(--sb-border-strong); border-radius:999px; padding:1px 7px; color:var(--sb-text-secondary); background:transparent; }
  .badge.pending { border-color:rgba(245,158,11,.55); color:var(--sb-warning); }
  .badge.approved { border-color:rgba(62,207,142,.55); color:var(--sb-success); }
  .badge.rejected { border-color:rgba(239,68,68,.55); color:var(--sb-error); }
  .badge.warning { border-color:rgba(245,158,11,.55); color:var(--sb-warning); }
  .notice { padding:10px 12px; border:1px solid var(--sb-border-strong); border-radius:8px; background:var(--sb-bg-elevated); color:var(--sb-text-secondary); }
  .notice.warning { border-color:rgba(245,158,11,.55); color:var(--sb-warning); }
  .section-list { display:grid; gap:12px; }
  .section-card { display:grid; gap:10px; padding:12px; border:1px solid var(--sb-border-default); border-radius:8px; background:var(--sb-bg-elevated); }
  .section-card.empty { color:var(--sb-text-secondary); }
  .section-header { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .section-title { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
  .section-title code { overflow-wrap:anywhere; }
  .section-summary { color:var(--sb-text-secondary); }
  .section-source-refs { display:grid; gap:5px; margin-top:8px; color:var(--sb-text-muted); font-size:12px; }
  .section-source-refs code { overflow-wrap:anywhere; }
  .section-body { max-height:360px; overflow:auto; }
  .evidence-details, .technical-details { border:1px solid var(--sb-border-default); border-radius:8px; background:var(--sb-bg-surface); }
  .evidence-details > summary, .technical-details > summary { cursor:pointer; padding:8px 10px; color:var(--sb-text-secondary); font-size:12px; }
  .technical-details > pre { border:0; border-top:1px solid var(--sb-border-default); border-radius:0 0 8px 8px; background:transparent; }
  .page-location { min-width:0; color:var(--sb-text-muted); font-size:12px; overflow-wrap:anywhere; }
  .repair-hint { margin:0; font-size:12px; color:var(--sb-text-muted); }
  #modal-copy-state { min-height:1.5em; font-size:12px; }
  .technical-content { display:grid; gap:10px; padding:0 10px 10px; border-top:1px solid var(--sb-border-default); }
  .technical-content .meta { margin-top:10px; }
  .technical-content code { overflow-wrap:anywhere; }
  .detail { min-height:0; overflow:auto; padding:18px; display:grid; align-content:start; gap:16px; }
  .detail-titlebar { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .detail-heading { min-width:0; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .detail h2 { margin:0; font-size:22px; font-weight:500; letter-spacing:0; overflow-wrap:anywhere; }
  code, pre, textarea { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { margin:0; white-space:pre-wrap; overflow:visible; padding:14px; border-radius:8px; border:1px solid var(--sb-border-default); background:var(--sb-bg-elevated); color:var(--sb-text-primary); }
  .actions { display:flex; gap:10px; flex-wrap:wrap; }
  .btn { border:1px solid var(--sb-border-strong); background:transparent; color:var(--sb-text-primary); padding:8px 12px; border-radius:6px; cursor:pointer; }
  .btn:disabled { opacity:.55; cursor:not-allowed; }
  .language-btn { width:76px; flex-shrink:0; }
  .icon-btn { width:40px; height:40px; display:inline-grid; place-items:center; padding:0; font-size:18px; }
  .btn:hover { border-color:var(--sb-brand); }
  .btn.primary { background:var(--sb-brand); border-color:var(--sb-brand-border); color:var(--sb-brand-text); }
  .btn.brand { background:var(--sb-brand); border-color:var(--sb-brand-border); color:var(--sb-brand-text); }
  .btn.brand.ready { filter:brightness(1.04); }
  .btn.reject.active { border-color:var(--sb-error); color:var(--sb-error); }
  .btn.approve.active { border-color:var(--sb-success); color:var(--sb-success); }
  textarea { width:100%; min-height:120px; resize:vertical; border:1px solid var(--sb-border-strong); border-radius:8px; padding:12px; background:var(--sb-bg-elevated); color:var(--sb-text-primary); }
  .empty { padding:28px; color:var(--sb-text-secondary); border:1px dashed var(--sb-border-strong); border-radius:8px; }
  .modal { position:fixed; inset:0; z-index:10; display:grid; place-items:center; padding:24px; background:rgba(0,0,0,.45); }
  .modal.hidden { display:none; }
  .modal-card { width:min(920px, 100%); max-height:min(720px, 92vh); display:grid; grid-template-rows:auto minmax(0, 1fr) auto; gap:14px; border:1px solid var(--sb-border-default); border-radius:8px; background:var(--sb-bg-surface); padding:18px; box-shadow:0 16px 44px rgba(0,0,0,.22); }
  .modal-card h2 { margin:0; font-size:20px; font-weight:500; letter-spacing:0; }
  .modal-body { min-height:0; overflow:auto; }
  .modal-actions { display:flex; justify-content:flex-end; align-items:center; gap:10px; }
  #search { margin:10px; min-width:0; padding:9px; border:1px solid var(--sb-border-default); border-radius:6px; background:var(--sb-bg-elevated); color:var(--sb-text-primary); }
  .reader-navigation, .code-navigation { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
  .code-navigation { margin:12px 0; }
  .code-navigation[hidden] { display:none; }
  .reader-body { min-width:0; line-height:1.7; overflow-wrap:anywhere; }
  .reader-body h1 { font-size:26px; }
  .reader-body h2, .reader-body h3 { margin:24px 0 10px; }
  .reader-body details { margin:12px 0; }
  .reader-body summary { cursor:pointer; font-weight:500; }
  .reader-body p { margin:10px 0; }
  .reader-body a { color:var(--sb-brand); }
  .reader-body blockquote { margin-left:0; padding-left:16px; border-left:3px solid var(--sb-border-strong); }
  .reader-body pre { overflow:auto; white-space:pre; }
  .reader-body code { font-size:.9em; }
  .table-scroll { max-width:100%; overflow:auto; }
  .reader-body table { border-collapse:collapse; width:100%; }
  .reader-body td, .reader-body th { text-align:left; vertical-align:top; padding:8px 10px; border:1px solid var(--sb-border-default); }
  .reader-body th { background:var(--sb-bg-hover); }
  #decision-summary ul { max-height:160px; overflow:auto; }
  @media (max-width: 820px) {
    .header { grid-template-columns:minmax(0, 1fr); }
    .toolbar { justify-content:flex-start; flex-wrap:wrap; }
    body { overflow:auto; }
    .shell { height:auto; min-height:100vh; overflow:visible; padding:18px; }
    .layout { grid-template-columns:1fr; }
    .candidate-panel { max-height:42vh; }
    .detail-panel { display:block; overflow:visible; }
    .detail { overflow:visible; }
    .detail-titlebar { display:grid; }
  }
`;
