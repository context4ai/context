#!/usr/bin/env node
// Build a single-page research report from Markdown chapters. No dependencies.
// Usage: node build.mjs <chapters-dir> <out.html> [--title T] [--subtitle S] [--labels labels.json]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [dir, out] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!dir || !out) { console.error("usage: node build.mjs <chapters-dir> <out.html> [--title T] [--subtitle S] [--labels file]"); process.exit(2); }
const LABELS = { add: "added", mod: "revised", dir: "new section", keep: "kept unchanged", report: "Report", appendix: "Appendix", outline: "On this chapter", prev: "Previous", next: "Next", copied: "Copied", ...(opt("--labels") ? JSON.parse(readFileSync(opt("--labels"), "utf8")) : {}) };
const C = { brand: "#2563eb", accent: "#00bec8", ok: "#16a34a", warn: "#d97706", bad: "#dc2626", gray: "#9ca3af", text: "#161e2e", muted: "#646b7c", border: "#e7e9ef" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- inline ----------
const PATH = /^(?:[\p{L}\p{N}_@.+\-]+\/)+(?:[\p{L}\p{N}_@.+\-*]+(?::\d+(?:-\d+)?)?)?$/u;
const shortPath = (p) => { if (p.length <= 40) return p; const s = p.split("/"); const last = s.pop(); return `${s[0]}/…/${last.length > 32 ? last.slice(0, 14) + "…" + last.slice(-14) : last}`; };
function inline(t) {
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(PATH.test(c) ? `<span class="pc" data-p="${esc(c)}" title="${esc(c)}">${esc(shortPath(c))}</span>` : `<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  t = esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, x, u) => `<a href="${u}">${x}</a>`);
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

// ---------- blocks ----------
function tree(src) {
  const tags = { "[add]": "add", "[mod]": "mod", "[dir]": "dir", "[keep]": "keep" };
  return `<pre class="tree">${src.trimEnd().split("\n").map((l) => {
    const k = Object.keys(tags).find((t) => l.trimEnd().endsWith(t));
    if (!k) return `<span>${esc(l)}</span>`;
    const body = l.trimEnd().slice(0, -k.length).trimEnd(); const m = body.match(/^([│├└─\s]*)(.*)$/u);
    return `<span class="${tags[k]}">${esc(m[1])}<i>${esc(m[2])}</i><em>${esc(LABELS[tags[k]])}</em></span>`;
  }).join("")}</pre>`;
}
function chart(src, where) {
  let d; try { d = JSON.parse(src); } catch (e) { throw new Error(`${where}: invalid chart JSON (${e.message})`); } const pal = d.colors || [C.ok, C.warn, C.bad, C.gray, C.brand, C.accent];
  if (d.type === "matrix") {
    const W = 160 + d.columns.length * 112, H = 50 + d.rows.length * 38;
    let s = `<svg viewBox="0 0 ${W} ${H}">`;
    d.columns.forEach((c, j) => { s += `<text x="${160 + j * 112 + 56}" y="22" font-size="11" text-anchor="middle" fill="${C.muted}">${esc(c)}</text>`; });
    const rec = new Set((d.recommend || []).map(([r, c]) => `${r},${c}`));
    d.rows.forEach((r, i) => { const mark = (v, j) => d.recommend ? rec.has(`${i},${j}`) : v === Math.max(...d.values[i]); s += `<text x="150" y="${61 + i * 38}" font-size="12" text-anchor="end">${esc(r)}</text>`;
      d.values[i].forEach((v, j) => { const op = 0.15 + 0.85 * v / (d.max || 5); s += `<rect x="${164 + j * 112}" y="${40 + i * 38}" width="104" height="32" rx="4" fill="${C.brand}" fill-opacity="${op.toFixed(2)}" ${mark(v, j) ? `stroke="${C.text}" stroke-width="2"` : ""}/><text x="${216 + j * 112}" y="${61 + i * 38}" font-size="12" text-anchor="middle" fill="${op > 0.6 ? "#fff" : C.text}" font-weight="${mark(v, j) ? 700 : 400}">${v}</text>`; }); });
    return fig(s + "</svg>", d.title);
  }
  if (d.type === "scatter") {
    const W = 720, H = 320, X = (v) => 70 + v / (d.xmax || 1) * 600, Y = (v) => 280 - v / (d.ymax || 1) * 250;
    let s = `<svg viewBox="0 0 ${W} ${H}"><rect x="70" y="30" width="600" height="250" fill="#f8f9fc" stroke="${C.border}"/>`;
    s += `<text x="370" y="310" font-size="12" text-anchor="middle" fill="${C.muted}">${esc(d.xlabel || "")}</text><text x="20" y="155" font-size="12" text-anchor="middle" fill="${C.muted}" transform="rotate(-90 20 155)">${esc(d.ylabel || "")}</text>`;
    d.points.forEach((p) => { s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="8" fill="${p.color || C.brand}"/><text x="${X(p.x) + 13}" y="${Y(p.y) - 2}" font-size="12.5" font-weight="700">${esc(p.label)}</text>${p.note ? `<text x="${X(p.x) + 13}" y="${Y(p.y) + 14}" font-size="11" fill="${C.muted}">${esc(p.note)}</text>` : ""}`; });
    return fig(s + "</svg>", d.title);
  }
  const max = d.max || Math.max(...d.rows.map((r) => r.values.reduce((a, b) => a + b, 0))); const W = 760, L = 130, R = 190, bw = W - L - R;
  let s = `<svg viewBox="0 0 ${W} ${d.rows.length * 34 + 20}">`;
  d.rows.forEach((r, i) => { const y = 10 + i * 34; let x = L; s += `<text x="${L - 10}" y="${y + 15}" font-size="12" text-anchor="end">${esc(r.label)}</text>`;
    r.values.forEach((v, j) => { const w = Math.max(v / max * bw, v > 0 ? 2 : 0); s += `<rect x="${x}" y="${y}" width="${w}" height="20" rx="3" fill="${pal[j % pal.length]}"/>`; if (d.segmentLabels && w > 22) s += `<text x="${x + w / 2}" y="${y + 14}" font-size="11" text-anchor="middle" fill="#fff">${v}</text>`; x += w; });
    s += `<text x="${x + 8}" y="${y + 15}" font-size="12" fill="${C.muted}">${esc(r.note ?? r.values.reduce((a, b) => a + b, 0) + (d.unit || ""))}</text>`; });
  const legend = (d.legend || []).map((l, j) => `<span><b style="background:${pal[j % pal.length]}"></b>${esc(l)}</span>`).join("");
  return fig(s + "</svg>", d.title, legend);
}
const fig = (svg, cap, legend = "") => `<figure>${svg}${legend ? `<div class="lg">${legend}</div>` : ""}${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}</figure>`;

function render(md, file = "") {
  const lines = md.replace(/\r/g, "").split("\n"); let h = ""; let i = 0;
  const isTable = (l) => /^\s*\|.*\|\s*$/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    const fence = l.match(/^```(\w*)/);
    if (fence) { const body = []; i++; while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]); i++;
      const b = body.join("\n"); h += fence[1] === "tree" ? tree(b) : fence[1] === "chart" ? chart(b, `${file}:${i}`) : `<pre><code>${esc(b)}</code></pre>`; continue; }
    const hd = l.match(/^(#{1,4})\s+(.*)$/); if (hd) { h += `<h${hd[1].length}>${inline(hd[2])}</h${hd[1].length}>`; i++; continue; }
    if (isTable(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (r) => r.trim().slice(1, -1).replace(/`[^`]*`/g, (m) => m.replace(/\|/g, "\u0001")).split("|").map((c) => c.trim().replace(/\u0001/g, "|"));
      h += `<div class="tw"><table><thead><tr>${cells(l).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>`; i += 2;
      while (i < lines.length && isTable(lines[i])) h += `<tr>${cells(lines[i++]).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`;
      h += "</tbody></table></div>"; continue; }
    if (/^>\s?/.test(l)) { const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, "")); h += `<blockquote><p>${inline(q.join(" "))}</p></blockquote>`; continue; }
    const li = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) { const ordered = /\d/.test(li[2]); h += ordered ? "<ol>" : "<ul>";
      while (i < lines.length) { const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/); if (!m) { if (/^\s{2,}\S/.test(lines[i])) { h = h.replace(/<\/li>$/, ` ${inline(lines[i].trim())}</li>`); i++; continue; } break; }
        h += `<li${m[1].length ? ' class="sub"' : ""}>${inline(m[3])}</li>`; i++; }
      h += ordered ? "</ol>" : "</ul>"; continue; }
    if (!l.trim()) { i++; continue; }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s)/.test(lines[i]) && !isTable(lines[i])) p.push(lines[i++]);
    h += `<p>${inline(p.join(" "))}</p>`;
  }
  return h;
}

// ---------- page ----------
const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
let nav = "", body = "", n = 0, inApp = false;
try { files.forEach((f, k) => {
  const app = /^[A-Z][-_.]/.test(f); const id = `c${k + 1}`; let title = f;
  const html = render(readFileSync(join(dir, f), "utf8"), f).replace(/<h([1-3])>(.*?)<\/h\1>/g, (m, lv, t) => { if (lv === "1") { title = t.replace(/<[^>]+>/g, ""); return m; } n++; return `<h${lv} id="${id}-${n}">${t}</h${lv}>`; });
  if (app && !inApp) { nav += `<div class="cap">${esc(LABELS.appendix)}</div>`; inApp = true; }
  nav += `<a href="#${id}" data-ch="${id}">${app ? "" : `<span>${k + 1}</span>`}${esc(title)}</a>`;
  body += `<article class="ch" id="${id}" data-title="${esc(title)}">${html}<div class="pager"></div></article>`;
}); } catch (e) { console.error(`build failed: ${e.message}`); process.exit(1); }
const title = opt("--title", "Research report"), sub = opt("--subtitle", "");
writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;font:15px/1.8 Inter,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:${C.text}}
header{position:fixed;inset:0 0 auto;height:56px;display:flex;align-items:center;gap:12px;padding:0 24px;border-bottom:1px solid ${C.border};background:#fffffff2;z-index:2}header span{color:${C.muted};font-size:13px}
#side{position:fixed;top:56px;bottom:0;left:0;width:260px;overflow:auto;padding:20px 14px;background:#f8f9fc;border-right:1px solid ${C.border}}#side a{display:flex;gap:8px;padding:6px 10px;border-radius:7px;color:${C.text};text-decoration:none;font-size:14px}#side a span{color:${C.muted}}#side a.on{background:#e8efff;color:${C.brand};font-weight:600}.cap{font-size:12px;color:${C.muted};margin:18px 10px 6px}
main{margin:0 230px 0 260px;padding:80px 48px 100px}.ch{display:none;max-width:940px;margin:auto}.ch.on{display:block}
#out{position:fixed;top:56px;right:0;bottom:0;width:230px;overflow:auto;padding:28px 16px;border-left:1px solid ${C.border}}#out a{display:block;color:${C.muted};text-decoration:none;font-size:13px;padding:3px 8px;border-left:2px solid transparent}#out a.h3{padding-left:20px}#out a.on{color:${C.brand};border-color:${C.brand}}
h1{font-size:28px}h2{font-size:21px;margin-top:36px;padding-top:18px;border-top:1px solid ${C.border}}h2,h3{scroll-margin-top:70px}a{color:${C.brand}}code{background:#f1f3f7;padding:1px 5px;border-radius:4px;font-size:13px}
pre{background:#f6f8fa;border:1px solid ${C.border};border-radius:8px;padding:12px 16px;overflow:auto;line-height:1.6}.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{border:1px solid ${C.border};padding:7px 10px;text-align:left;vertical-align:top}th{background:#f8f9fc}
blockquote{margin:0 0 20px;padding:10px 16px;border-left:4px solid ${C.brand};background:#f3f7ff}li.sub{margin-left:20px}
figure{margin:18px 0;padding:14px;border:1px solid ${C.border};border-radius:10px}figure svg{width:100%;height:auto}figcaption{text-align:center;color:${C.muted};font-size:13px}.lg{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:${C.muted}}.lg b{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px}
.pc{font:12.5px ui-monospace,monospace;background:#f1f3f7;border:1px solid #e5e8ef;border-radius:5px;padding:0 6px;cursor:copy;white-space:nowrap}td .pc{display:table;margin:2px 0}
.tree{font:13px/1.65 ui-monospace,"PingFang SC",monospace}.tree span{display:block}.tree i{font-style:normal;padding:0 4px;border-radius:4px}.tree em{font-style:normal;font-size:12px;margin-left:10px;padding:0 6px;border-radius:9px;color:#fff}
.tree .add i{background:#dcfce7}.tree .add em{background:${C.ok}}.tree .mod i{background:#fef3c7}.tree .mod em{background:${C.warn}}.tree .dir i{background:#dbeafe;font-weight:600}.tree .dir em{background:${C.brand}}.tree .keep i{background:#cffafe}.tree .keep em{background:#0891b2}
.pager{display:flex;justify-content:space-between;gap:16px;margin-top:48px}.pager a{flex:1;border:1px solid ${C.border};border-radius:10px;padding:10px 14px;text-decoration:none;color:${C.text}}.pager small{display:block;color:${C.muted}}
@media(max-width:1200px){#out{display:none}main{margin-right:0}}@media(max-width:820px){#side{display:none}main{margin-left:0;padding:72px 16px}}
</style></head><body><header><b>${esc(title)}</b><span>${esc(sub)}</span></header><nav id="side"><div class="cap">${esc(LABELS.report)}</div>${nav}</nav><main>${body}</main><aside id="out"></aside><script>
const CH=[...document.querySelectorAll('.ch')],S=[...document.querySelectorAll('#side a')],O=document.getElementById('out');let H=[],A=[];
function show(h){let e=document.getElementById((h||'').slice(1)),t=null;if(!e||!e.classList.contains('ch')){t=e;e=e?e.closest('.ch'):CH[0]}
CH.forEach(c=>c.classList.toggle('on',c===e));S.forEach(a=>a.classList.toggle('on',a.dataset.ch===e.id));H=[...e.querySelectorAll('h2,h3')];
O.innerHTML=H.length?'<b style="font-size:13px">${esc(LABELS.outline)}</b>'+H.map(x=>'<a class="'+x.tagName.toLowerCase()+'" href="#'+x.id+'">'+x.textContent+'</a>').join(''):'';A=[...O.querySelectorAll('a')];
const i=CH.indexOf(e),p=CH[i-1],n=CH[i+1];e.querySelector('.pager').innerHTML=(p?'<a href="#'+p.id+'"><small>${esc(LABELS.prev)}</small>'+p.dataset.title+'</a>':'<span></span>')+(n?'<a href="#'+n.id+'"><small>${esc(LABELS.next)}</small>'+n.dataset.title+'</a>':'<span></span>');
t?t.scrollIntoView():scrollTo(0,0);spy()}
function spy(){let k=-1;H.forEach((x,i)=>{if(x.getBoundingClientRect().top<100)k=i});A.forEach((a,i)=>a.classList.toggle('on',i===k))}
document.addEventListener('click',e=>{const c=e.target.closest('.pc');if(!c)return;navigator.clipboard&&navigator.clipboard.writeText(c.dataset.p);const o=c.textContent;c.textContent='${esc(LABELS.copied)}';setTimeout(()=>c.textContent=o,900)});
addEventListener('hashchange',()=>show(location.hash));addEventListener('scroll',spy,{passive:true});show(location.hash);
</script></body></html>`);
console.log(`${out}: ${files.length} chapters`);
