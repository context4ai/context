import { readerContentStyles } from "./readerContentStyles.js";
import { DIAGRAM_STYLES } from "./diagramStyles.js";
/** Shared website design tokens; review layout remains a standalone offline document. */
export const REVIEW_SITE_STYLES = String.raw`
:root{--blue:#2563eb;--text:#161e2e;--muted:#646b7c;--line:#e7e9ef;--bg:#fff;--side:#f8f9fc;--green:#28734f;--red:#b7444c;--amber:#93651d}*{box-sizing:border-box}body{margin:0;color:var(--text);background:var(--bg);font:14px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{opacity:.35;cursor:not-allowed}[hidden]{display:none!important}header{height:64px;padding:0 24px;display:flex;align-items:center;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}#home{border:0;background:none;color:var(--text);width:280px;flex-shrink:0;text-align:left;font-size:15px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}nav{display:flex;flex:1;min-width:0;overflow:auto;align-self:stretch}nav button{border:0;background:none;color:var(--text);padding:0 16px;font-size:13px;font-weight:550;white-space:nowrap}nav .active{color:var(--blue);box-shadow:inset 0 -2px var(--blue)}.new,nav .new{color:var(--green)}.modify,nav .modify{color:var(--amber)}.badge{display:inline-block;margin-left:7px;padding:1px 6px;font-size:10px;line-height:18px;vertical-align:middle;border-radius:4px;font-weight:600;letter-spacing:0}.badge.new{color:var(--green);background:color-mix(in srgb,var(--green) 10%,var(--bg))}.badge.modify{color:var(--amber);background:color-mix(in srgb,var(--amber) 10%,var(--bg))}.badge.removed{color:var(--red);background:color-mix(in srgb,var(--red) 10%,var(--bg))}.removed,nav .removed,.node.removed{color:var(--red)}.badge{border:1px solid color-mix(in srgb,currentColor 18%,transparent)}.tools{display:flex;align-items:center;gap:8px;position:relative;margin-left:12px}.btn{border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);padding:5px 10px;font-size:12px;line-height:22px;white-space:nowrap}.primary{color:var(--bg);background:var(--blue);border-color:var(--blue)}#theme,#language{margin-left:8px;flex-shrink:0}.layout{display:grid;grid-template-columns:280px minmax(0,1fr)}aside{height:calc(100vh - 64px);position:sticky;top:64px;overflow:auto;background:var(--side);border-right:1px solid var(--line);padding:12px 0 80px}.node{display:block;width:100%;text-align:left;border:0;background:none;height:38px;min-height:38px;padding:9px 16px 9px 26px;font-size:13px;font-weight:450;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}.node.directory{color:var(--text)}.node.selected.unchanged{color:var(--blue);font-weight:550}.node.new{color:var(--green)}.node.modify{color:var(--amber)}.node.selected{background:color-mix(in srgb,var(--blue) 8%,transparent)}.caret{float:right}.node:hover{background:#8e96aa1a}main{min-width:0;padding:44px 60px 100px 36px}h1{font-size:36px;line-height:1.3;letter-spacing:-.025em;margin:0 0 28px}h2{font-size:25px;line-height:1.4;font-weight:650;margin:46px 0 22px;border-bottom:1px solid var(--line);padding-bottom:14px}h3{font-size:19px;font-weight:600;line-height:1.5;margin:30px 0 14px}article{font-size:16px;line-height:1.8}article>h1>.badge{margin-left:12px}article a{color:inherit}article a:hover{color:var(--blue)}article table{border-collapse:collapse;font-size:14px;display:block;overflow:auto}article th,article td{border:1px solid var(--line);padding:11px 14px}article th{background:var(--side)}pre{overflow:auto;background:var(--side);padding:16px}blockquote{padding:16px 20px;margin:24px 0;border-left:3px solid var(--context-accent);background:color-mix(in srgb,var(--blue) 8%,transparent);color:var(--muted)}.home .layout{display:block}.home aside{display:none}.home main{width:1120px;max-width:calc(100% - 280px);margin-left:280px;padding-top:32px}.home article{font-size:14px}.home h1{font-size:28px;margin-bottom:12px}.home h2{font-size:19px;margin:24px 0 12px;padding-bottom:10px}.home h3{font-size:15px;margin:16px 0 10px}.stats{font-size:12px;color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:8px}.cards button{border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--text);text-align:left;font-size:13px;line-height:20px;padding:10px 14px}.cards button:hover{border-color:var(--blue)}.review-unchanged-heading{color:var(--muted)}.review-omitted{margin:20px 0;padding:18px 20px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);font-size:13px}.changed{position:relative;display:flow-root;color:var(--amber);padding:0 76px 0 0;margin:20px 0}.changed>.badge{position:absolute;right:0;top:4px}.changed>:nth-child(2){margin-top:0}.changed>:last-child{margin-bottom:0}.changed details{color:inherit}.changed.removed{color:var(--red)}.workspace-tree{font:12px/1.9 ui-monospace,monospace;border:1px solid var(--line);border-radius:8px;padding:16px;background:var(--side);overflow:auto}.workspace-tree button{border:0;background:none;color:var(--text);padding:0;font:inherit;white-space:nowrap}.note{font-size:12px;color:var(--muted)}footer{position:fixed;bottom:0;left:280px;right:0;background:var(--bg);border-top:1px solid var(--line);padding:12px 35px;display:flex;gap:10px;z-index:4}footer .btn{min-width:76px}dialog{width:560px;max-width:90vw;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:20px;font-size:13px;line-height:1.65}dialog::backdrop{background:#131b3255}dialog h2{font-size:17px;margin:0 0 12px;border:0;padding:0}dialog textarea{width:100%;height:130px;border:1px solid var(--line);border-radius:6px;padding:10px;font:11px/1.6 monospace;background:var(--side);color:var(--text)}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.dark{--bg:#171b24;--side:#1b1d24;--text:#e2e4ed;--muted:#a1a6b7;--line:#303440;--blue:#8eb7ff;--green:#83c9a0;--amber:#dab779;--red:#e49a9e}@media(min-width:1600px){main,.home main{padding-left:52px}}@media(max-width:1279px){#home{width:220px}nav button{padding:0 9px}.tools{gap:4px}}@media(max-width:1050px){header{height:auto;flex-wrap:wrap;min-height:64px}nav{order:3;flex-basis:100%;height:44px}.tools{margin-left:auto}}@media(max-width:700px){.layout{display:block}aside{position:relative;top:0;height:200px}main,.home main{width:100%;max-width:100%;margin:0;padding:24px 20px 90px}footer{left:0;padding:10px;flex-wrap:wrap}footer input{flex-basis:100%}.tools{flex-wrap:wrap}h1{font-size:28px}}
${readerContentStyles("article")}
article code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
article :not(pre)>code{padding:3px 6px;overflow-wrap:break-word}
article p{margin:16px 0}article strong{font-weight:600}
article ul,article ol{padding-left:1.25rem;margin:16px 0}
article li+li{margin-top:8px}article li>p{margin:0}
article pre{border:1px solid var(--line);border-radius:6px;padding:20px 24px;line-height:1.7}
article pre code{font-size:14px;color:var(--text)}
article .review-unchanged-heading{color:var(--muted)}
article .changed{color:var(--amber)}
article .changed pre code,article .changed blockquote{color:inherit}
article .changed.removed{color:var(--red)}
article .changed :not(pre)>code{color:inherit;background:color-mix(in srgb,currentColor 5%,var(--bg))}
.old-title{color:var(--muted);margin-left:6px}
article.review-new-page{color:var(--green)}
article.review-new-page :not(pre)>code,article.review-new-page pre code,article.review-new-page blockquote{color:inherit}
article.review-new-page :not(pre)>code{background:color-mix(in srgb,var(--green) 6%,var(--bg))}
${DIAGRAM_STYLES}
article.review-new-page .language-mermaid{--context-text:var(--green);--context-muted-text:var(--green)}
article .changed .language-mermaid{--context-text:var(--amber);--context-muted-text:var(--amber)}
article .changed.removed .language-mermaid{--context-text:var(--red);--context-muted-text:var(--red)}
article.review-new-page .context-diagram-shell,article .changed .context-diagram-shell{--diagram-text:var(--context-text)}
header { gap: 0; }
header #home { width: 242px; }
header nav { scrollbar-width: none; }
header nav::-webkit-scrollbar { display: none; }
header nav button { padding: 0 11px; }
.tools { flex-shrink: 0; gap: 16px; }
.reading-progress { min-width: 225px; }
#counts { display: flex; align-items: center; justify-content: space-between; gap: 8px; white-space: nowrap; font-size: 12px; color: var(--muted); }
#counts b { font-weight: 650; color: var(--text); font-variant-numeric: tabular-nums; }
#counts .separator { color: var(--line); }
#revisions-link { border: 0; padding: 0; background: transparent; color: var(--muted); font-size: inherit; }
#revisions-link.has-notes, #revisions-link.has-notes b { color: var(--amber); }
#revisions-link:hover, #revisions-link[aria-pressed="true"] { color: var(--blue); text-decoration: none; }
.read-track { height: 2px; margin-top: 5px; background: var(--line); border-radius: 2px; overflow: hidden; }
#read-fill { display: block; height: 100%; width: 0; background: var(--blue); transition: width .2s ease; }
.badge.read { color: var(--blue); background: color-mix(in srgb,var(--blue) 8%,var(--bg)); font-size: 9px; letter-spacing: .03em; }
.badge.has-feedback { color: var(--amber); background: color-mix(in srgb,var(--amber) 8%,var(--bg)); }
aside { top: var(--header-height,64px); height: calc(100vh - var(--header-height,64px)); }
.node { height: auto; min-height: 38px; }
.node .node-content { display: flex; align-items: center; min-width: 0; gap: 5px; }
.node .node-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.node .node-status { margin-left: auto; display: inline-flex; gap: 3px; flex-shrink: 0; }
.node .badge { margin: 0; padding: 0 4px; line-height: 17px; }
.node .caret { margin-left: auto; }
main { padding-bottom: 160px; }
.home main { max-width: 1100px; width: calc(100% - 280px); }
.home h1 { font-size: 28px; }
.revision-index main { max-width: 1060px; }
.revision-index h1 { font-size: 28px; margin-bottom: 12px; }
.revision-index .revision-card { margin: 18px 0; padding: 22px 24px; border: 1px solid var(--line); background: var(--bg); border-radius: 9px; }
.revision-card h2 { border: 0; padding: 0; margin: 0 0 8px; font-size: 17px; line-height: 1.5; }
.revision-title { border: 0; padding: 0; background: transparent; color: var(--text); text-align: left; font-size: inherit; font-weight: 600; }
.revision-title:hover { color: var(--blue); }
.revision-title .arrow { color: var(--muted); font-size: 14px; margin-left: 5px; }
.revision-path { color: var(--muted); font-size: 11px; margin: 0 0 15px; overflow-wrap: anywhere; }
.revision-body { font-size: 14px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.empty-notes { padding: 38px 24px; margin: 24px 0; border: 1px dashed var(--line); border-radius: 9px; color: var(--muted); text-align: center; }
footer { align-items: center; flex-wrap: nowrap; padding: 12px 35px; gap: 12px; }
#revision-note { display: block; flex: 1 1 0%; min-width: 0; height: 42px; max-height: 112px; resize: none; overflow-y: auto; border: 1px solid var(--line); border-radius: 6px; padding: 9px 12px; background: var(--side); color: var(--text); font: inherit; font-size: 14px; line-height: 22px; }
#revision-note::placeholder { color: var(--muted); opacity: .85; }
#revision-note:focus { outline: 2px solid color-mix(in srgb,var(--blue) 25%,transparent); outline-offset: 0; border-color: var(--blue); }
#clear-note { flex-shrink: 0; min-width: 108px; height: 36px; }
#clear-note:disabled { opacity: .4; }
#toast { position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); z-index: 20; max-width: calc(100vw - 32px); border: 1px solid var(--line); border-radius: 8px; padding: 10px 18px; color: var(--text); background: var(--bg); box-shadow: 0 5px 24px #17244222; font-size: 13px; }
#copied-notes { height: 240px; font: 13px/1.8 inherit; resize: vertical; }
.copy-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.copy-heading h2 { margin: 0; }
.copy-heading h2.copy-success { color: var(--green); }
#copy-countdown { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
#copy-preview { position: relative; max-height: min(400px, calc(100dvh - 180px)); overflow: hidden; border: 1px solid var(--line); border-radius: 7px; background: var(--side); }
#copy-preview-text { padding: 14px 16px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.85; }
.copy-ellipsis { display: none; position: absolute; bottom: 0; left: 0; right: 0; height: 40px; padding: 13px 16px 2px; background: linear-gradient(transparent, var(--side) 35%); color: var(--muted); font-size: 16px; }
#copy-preview.has-overflow .copy-ellipsis { display: block; }
button:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
@media (min-width: 1600px) { .home main { max-width: 1100px; } }
@media (max-width: 1200px) { header #home { width: 205px; } .tools { gap: 10px; } header nav button { padding: 0 8px; } }
@media (max-width: 1050px) { header { padding: 10px 20px 0; } header nav { order: 3; flex-basis: 100%; height: 42px; } header #home { flex: 1; width: auto; } .tools { margin-left: 8px; } }
@media (max-width: 700px) {
  header { padding: 10px 14px 0; gap: 6px 0; }
  header #home { flex: 1 1 auto; font-size: 14px; }
  header .tools { order: 2; width: 100%; margin-left: 0; justify-content: space-between; flex-wrap: nowrap; padding: 4px 0; }
  header .reading-progress { flex: 1; min-width: 0; max-width: 260px; }
  header #theme, header #language { margin-left: 6px; }
  header nav { order: 3; margin-top: 2px; }
  aside { top: 0; position: relative; height: 180px; }
  main, .home main { width: 100%; max-width: 100%; margin: 0; padding: 24px 20px 150px; }
  .home h1 { font-size: 26px; }
  footer { left: 0; flex-wrap: nowrap; gap: 8px; padding: 10px 12px; }
  #revision-note { flex: 1 1 0%; font-size: 14px; }
  #clear-note { min-width: 96px; padding: 5px 8px; }
  .revision-index .revision-card { padding: 18px; }
  .changed { padding-right: 0; }
  .changed > .badge { position: static; margin: 0 0 10px; }
}

`;
