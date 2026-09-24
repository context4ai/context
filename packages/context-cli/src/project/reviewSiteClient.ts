/** Standalone reader: browser progress and plain revision notes, never approval authority. */
export const REVIEW_SITE_CLIENT = `
const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const words = {
  read: ['已读', 'Read'], revisions: ['修订', 'Revisions'], total: ['总', 'Total'], unit: ['篇', ''],
  copy: ['复制修订意见', 'Copy revision notes'], home: ['本次内容', 'This update'],
  homeHint: ['阅读文章，可在正文下方填写修订意见。完成后返回会话确认或反馈。', 'Read the articles and add revision notes below. Return to the conversation to confirm or share feedback.'],
  navigate: ['目录与文章', 'Directories and articles'], files: ['预期工作区变化', 'Expected workspace changes'],
  note: ['输入本篇修订意见……', 'Enter revision notes for this article…'], clear: ['清空本条修订', 'Clear this note'],
  revisionTitle: ['修订意见', 'Revision notes'], revisionHint: ['点击文章标题返回正文，继续编辑修订意见。', 'Select an article title to return to the article and edit its notes.'],
  empty: ['暂无修订意见', 'No revision notes yet'], emptyHint: ['可在文章正文下方填写修订意见。', 'Add revision notes below an article.'],
  emptyCopy: ['暂无修订意见，可返回会话确认。', 'No revision notes. You can confirm in the conversation.'],
  copied: ['已复制修订意见，可粘贴到会话中。', 'Revision notes copied. Paste them into the conversation.'],
  manualCopy: ['请手动复制修订意见', 'Copy revision notes manually'], manualHint: ['自动复制不可用，请复制下方文本并回复到会话中。', 'Automatic copy is unavailable. Copy the text below and reply in the conversation.'],
  close: ['关闭', 'Close'], baseline: ['无 Git 导航基线，目录沿用当前工作区；未推断历史目录变化。', 'No Git navigation baseline. The current workspace navigation is shown.'],
  approvedContext: ['既有正文，仅供对照。', 'Existing content, shown for reference.'], unchanged: ['本次未变更内容略。', 'Unchanged content omitted.'],
  previous: ['查看旧文本', 'Previous text'], removed: ['移除或替换的旧内容', 'Removed or replaced content'],
  removedNav: ['移除的目录条目', 'Removed navigation entries'], unplaced: ['待落位文章', 'Unplaced articles'],
  sources: ['来源引用', 'Sources'], feedbackTag: ['修订', 'Notes'],
};
let language = 'zh';
const t = key => words[key]?.[language === 'zh' ? 0 : 1] || key;
const candidates = DATA.pages.filter(page => page.candidate_id);
const pagesById = new Map(DATA.pages.map(page => [page.id, page]));
const read = new Set();
const notes = new Map();
const expanded = new Set();
let selected = null;
let active = null;
let view = 'home';
let toastTimer;
let copyTimer;
const storageKey = 'context-reading-v1:' + DATA.storageScope;

function restore() {
  for (const page of candidates) {
    if (page.revisionInstruction?.trim()) notes.set(page.id, page.revisionInstruction);
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    language = saved.language === 'en' ? 'en' : 'zh';
    document.body.classList.toggle('dark', saved.dark === true);
    for (const page of candidates) {
      const entry = saved.pages?.[page.id];
      if (entry?.version !== page.readVersion) continue;
      if (entry.read === true) read.add(page.id);
      if (typeof entry.note === 'string') {
        if (entry.note.trim()) notes.set(page.id, entry.note);
        else notes.delete(page.id);
      }
    }
  } catch { /* The report remains usable when local storage is unavailable. */ }
}

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      language, dark: document.body.classList.contains('dark'),
      pages: Object.fromEntries(candidates.map(page => [page.id, {
        version: page.readVersion, read: read.has(page.id), note: notes.get(page.id) || '',
      }])),
    }));
  } catch { /* Reading and copying still work without storage access. */ }
}

function revisedPages() { return candidates.filter(page => (notes.get(page.id) || '').trim()); }
function countText(label, count) { return \`\${label} <b>\${count}</b>\${language === 'zh' ? ' 篇' : ''}\`; }
function badges(page) {
  if (!page?.candidate_id) return '';
  return (read.has(page.id) ? '<span class="badge read">READ</span>' : '')
    + ((notes.get(page.id) || '').trim() ? \`<span class="badge has-feedback">\${t('feedbackTag')}</span>\` : '');
}
function badge(change) {
  if (!change || change === 'unchanged') return '';
  const label = { new: 'New', modify: 'Modify', removed: 'Remove' }[change] || change;
  return \`<span class="badge \${escape(change)}">\${escape(label)}</span>\`;
}
function descendants(key, seen = new Set()) {
  if (seen.has(key)) return [];
  seen.add(key);
  return DATA.nodes.filter(node => node.parent === key).flatMap(node => [node, ...descendants(node.key, seen)]);
}
function nodeChange(node) {
  if (node.removed) return 'removed';
  const nested = descendants(node.key);
  const changes = [node.change, ...nested.map(child => child.change),
    ...[node, ...nested].map(child => pagesById.get(child.page)?.change)];
  return nested.some(child => child.removed) || changes.includes('modify') ? 'modify' : changes.includes('new') ? 'new' : 'unchanged';
}
function nodeTitle(node) { return node.key === 'review-unplaced' ? t('unplaced') : node.title; }
function nodeLabel(node) {
  const title = escape(nodeTitle(node));
  return (node.removed ? \`<del>\${title}</del>\` : title)
    + (node.oldTitle ? \`<small class="old-title"> ← \${escape(node.oldTitle)}</small>\` : '');
}
function rootFor(pageId) {
  let node = DATA.nodes.find(item => item.page === pageId);
  const seen = new Set();
  while (node?.parent && !seen.has(node.key)) { seen.add(node.key); node = DATA.nodes.find(item => item.key === node.parent); }
  return node?.key || null;
}

function updateCounts() {
  const revised = revisedPages().length;
  $('counts').innerHTML = \`<span>\${countText(t('read'), read.size)}</span><span class="separator">/</span>\`
    + \`<button id="revisions-link" class="\${revised ? 'has-notes' : ''}" aria-pressed="\${view === 'revisions'}">\${countText(t('revisions'), revised)}</button>\`
    + \`<span class="separator">/</span><span>\${countText(t('total'), candidates.length)}</span>\`;
  $('revisions-link').onclick = () => { view = 'revisions'; selected = null; location.hash = 'revisions'; render(); window.scrollTo(0, 0); };
  $('read-fill').style.width = (candidates.length ? read.size / candidates.length * 100 : 0) + '%';
  const track = document.querySelector('.read-track');
  track.setAttribute('aria-valuenow', String(read.size));
  track.setAttribute('aria-valuemax', String(candidates.length));
}

function renderNav() {
  const roots = DATA.nodes.filter(node => !node.parent).sort((a, b) => a.order - b.order);
  $('top').innerHTML = roots.map(node => \`<button data-root="\${escape(node.key)}" class="\${nodeChange(node)}\${active === node.key ? ' active' : ''}">\${nodeLabel(node)}</button>\`).join('');
  function nodeButton(node, depth) {
    const page = pagesById.get(node.page);
    const isDirectory = DATA.nodes.some(child => child.parent === node.key);
    return \`<button data-node="\${escape(node.key)}" title="\${escape(nodeTitle(node))}" class="node \${isDirectory ? 'directory ' : ''}\${nodeChange(node)}\${selected === node.page ? ' selected' : ''}" style="padding-left:\${26 + 14 * depth}px">\`
      + \`<span class="node-content"><span class="node-title">\${nodeLabel(node)}</span>\`
      + \`<span class="node-status">\${badges(page)}</span>\${isDirectory ? '<span class="caret">›</span>' : ''}</span></button>\`;
  }
  let content = '';
  function walk(key, depth, seen = new Set()) {
    if (seen.has(key)) return;
    seen.add(key);
    for (const node of DATA.nodes.filter(item => item.parent === key).sort((a, b) => a.order - b.order)) {
      content += nodeButton(node, depth);
      if (expanded.has(node.key) || node.page === selected || descendants(node.key).some(child => child.page === selected)) walk(node.key, depth + 1, seen);
    }
  }
  if (active) walk(active, 0);
  else content = roots.map(node => nodeButton(node, 0)).join('');
  $('tree').innerHTML = content;
}

function workspaceTree() {
  const root = {};
  for (const page of candidates) {
    let node = root;
    for (const part of ('knowledge/' + page.path).split('/')) node = node[part] ??= {};
    node.$page = page;
  }
  function lines(node, depth = 0) {
    return Object.entries(node).filter(([key]) => key !== '$page').sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => {
      const label = child.$page ? \`<button data-page="\${escape(child.$page.id)}">\${escape(key)}</button>\${badge(child.$page.change)}\${badges(child.$page)}\` : escape(key) + '/';
      return \`<div style="padding-left:\${depth * 18}px">\${label}</div>\${lines(child, depth + 1)}\`;
    }).join('');
  }
  return \`<div class="workspace-tree">\${lines(root)}</div>\`;
}

function renderHome() {
  $('article').innerHTML = \`<h1>\${t('home')}</h1><p class="stats">\${t('homeHint')}</p>\`
    + (DATA.navigationBaseline === 'current' ? \`<p class="note">\${t('baseline')}</p>\` : '')
    + \`<h2>\${t('navigate')}</h2>\`
    + DATA.nodes.filter(node => !node.parent).map(node => {
      const ids = new Set([node, ...descendants(node.key)].map(item => item.page));
      const pages = candidates.filter(page => ids.has(page.id));
      if (!pages.length) return '';
      return \`<section class="home-group"><h3>\${nodeLabel(node)}\${badge(nodeChange(node))}</h3><div class="cards">\`
        + pages.map(page => \`<button data-page="\${escape(page.id)}">\${escape(page.title)}\${badge(page.change)}<span data-status-for="\${escape(page.id)}">\${badges(page)}</span></button>\`).join('') + '</div></section>';
    }).join('')
    + (DATA.nodes.some(node => node.removed) ? \`<h2>\${t('removedNav')}</h2><ul>\${DATA.nodes.filter(node => node.removed).map(node => \`<li class="removed">\${nodeLabel(node)}</li>\`).join('')}</ul>\` : '')
    + \`<h2>\${t('files')}</h2>\${workspaceTree()}\`;
}

function renderRevisions() {
  const pages = revisedPages();
  $('article').innerHTML = \`<h1>\${t('revisionTitle')} <span class="revision-count">· \${pages.length}</span></h1><p class="stats">\${t('revisionHint')}</p>\`
    + (pages.length ? pages.map(page => \`<section class="revision-card"><h2><button class="revision-title" data-page="\${escape(page.id)}">\${escape(page.title)}<span class="arrow" aria-hidden="true">↗</span></button></h2>\`
      + \`<p class="revision-path">\${escape(page.path)}</p><p class="revision-body">\${escape(notes.get(page.id))}</p></section>\`).join('')
      : \`<div class="empty-notes">\${t('empty')}<br><span class="note">\${t('emptyHint')}</span></div>\`);
}

function resizeInput() {
  const input = $('revision-note');
  input.style.height = '42px';
  input.style.height = Math.min(112, Math.max(42, input.scrollHeight + 2)) + 'px';
}

function render() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.body.classList.toggle('home', view === 'home');
  document.body.classList.toggle('revision-index', view === 'revisions');
  const page = pagesById.get(selected);
  $('article').classList.toggle('review-new-page', view === 'article' && page?.change === 'new');
  renderNav();
  updateCounts();
  if (view === 'home') renderHome();
  else if (view === 'revisions') renderRevisions();
  else if (page) {
    $('article').innerHTML = \`<h1>\${escape(page.title)}\${badge(page.change)}<span id="article-status">\${badges(page)}</span></h1>\`
      + (page.previousPath ? \`<p class="note">\${escape(page.previousPath)} → \${escape(page.path)}</p>\` : '')
      + (page.candidate_id ? page.html : page.html ? \`<p class="note">\${t('approvedContext')}</p>\${page.html}\` : \`<div class="review-omitted">\${t('unchanged')}</div>\`)
      + (page.sources.length ? \`<details><summary>\${t('sources')}</summary><ul>\${page.sources.map(source => \`<li>\${escape(source)}</li>\`).join('')}</ul></details>\` : '');
  }
  document.querySelectorAll('[data-label]').forEach(element => { element.textContent = t(element.dataset.label); });
  $('footer').hidden = !(view === 'article' && page?.candidate_id);
  $('revision-note').value = page ? notes.get(page.id) || '' : '';
  $('revision-note').placeholder = t('note');
  $('clear-note').textContent = t('clear');
  $('clear-note').disabled = !page || !(notes.get(page.id) || '').trim();
  $('copy-notes').textContent = t('copy');
  $('copy-close').textContent = t('close');
  $('language').textContent = language === 'zh' ? 'EN' : '中文';
  if (!$('footer').hidden) resizeInput();
  globalThis.contextDiagramViewer?.render($('article'), { dark: document.body.classList.contains('dark'), language });
}

function showPage(id, updateHash = true) {
  const page = pagesById.get(id);
  if (!page) return;
  selected = id;
  active = rootFor(id) || active;
  view = 'article';
  if (page.candidate_id) { read.add(page.id); persist(); }
  if (updateHash) history.replaceState(null, '', '#article=' + encodeURIComponent(id));
  render();
  window.scrollTo(0, 0);
  const currentNode = $('tree').querySelector('.selected');
  if (currentNode) $('tree').scrollTop = Math.max(0, currentNode.offsetTop - $('tree').offsetTop - $('tree').clientHeight / 3);
}

function showToast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

function feedbackText() {
  return t('revisionTitle') + '\\n\\n' + revisedPages().map(page =>
    \`《\${page.title}》\\n\${language === 'zh' ? '文章 ID' : 'Article ID'}：\${page.id}\\n\${language === 'zh' ? '修订意见' : 'Revision notes'}：\${notes.get(page.id)}\`
  ).join('\\n\\n');
}

async function copyNotes() {
  if (!revisedPages().length) { showToast(t('emptyCopy')); return; }
  const text = feedbackText();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    showCopyDialog(text, true);
  } catch {
    showCopyDialog(text, false);
  }
}

function showCopyDialog(text, copied) {
  clearInterval(copyTimer);
  $('copy-title').textContent = copied ? (language === 'zh' ? '✓ 已复制修订意见' : '✓ Revision notes copied') : t('manualCopy');
  $('copy-title').classList.toggle('copy-success', copied);
  $('copy-summary').textContent = copied ? (language === 'zh' ? '可返回会话粘贴以下修订意见。' : 'Paste these revision notes into the conversation.') : t('manualHint');
  $('copy-preview').hidden = !copied;
  $('copy-preview').classList.remove('has-overflow');
  $('copy-preview-text').textContent = text;
  $('copied-notes').hidden = copied;
  $('copied-notes').value = text;
  $('copy-close').parentElement.hidden = copied;
  $('copy-countdown').hidden = !copied;
  $('copy-countdown').textContent = language === 'zh' ? '5 秒后关闭' : 'Closes in 5s';
  if (!$('copy-dialog').open) $('copy-dialog').showModal();
  if (!copied) {
    $('copied-notes').focus();
    $('copied-notes').select();
    return;
  }
  const preview = $('copy-preview');
  preview.classList.toggle('has-overflow', preview.scrollHeight > preview.clientHeight);
  const deadline = performance.now() + 5000;
  copyTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    $('copy-countdown').textContent = language === 'zh' ? \`\${remaining} 秒后关闭\` : \`Closes in \${remaining}s\`;
    if (!remaining) { clearInterval(copyTimer); $('copy-dialog').close(); }
  }, 100);
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.page) showPage(button.dataset.page);
  else if (button.dataset.root) {
    active = button.dataset.root;
    const node = DATA.nodes.find(item => item.key === active);
    const children = descendants(active);
    const preferred = candidates.find(page => [node, ...children].some(item => item?.page === page.id));
    const pageId = preferred?.id || node?.page || children.find(child => child.page)?.page;
    if (pageId) showPage(pageId);
    else render();
  } else if (button.dataset.node) {
    const node = DATA.nodes.find(item => item.key === button.dataset.node);
    if (node.page) showPage(node.page);
    else { expanded.has(node.key) ? expanded.delete(node.key) : expanded.add(node.key); renderNav(); }
  }
});

$('revision-note').addEventListener('input', event => {
  const page = pagesById.get(selected);
  if (!page?.candidate_id) return;
  const value = event.target.value;
  if (value.trim()) notes.set(page.id, value);
  else notes.delete(page.id);
  $('clear-note').disabled = !value.trim();
  persist();
  updateCounts();
  renderNav();
  $('article-status').innerHTML = badges(page);
  resizeInput();
});
$('clear-note').onclick = () => {
  notes.delete(selected);
  persist();
  $('revision-note').value = '';
  $('revision-note').dispatchEvent(new Event('input', { bubbles: true }));
  $('revision-note').focus();
};
$('home').onclick = () => { selected = null; active = null; view = 'home'; history.replaceState(null, '', location.pathname + location.search); render(); window.scrollTo(0, 0); };
$('theme').onclick = () => { document.body.classList.toggle('dark'); persist(); render(); };
$('language').onclick = () => { language = language === 'zh' ? 'en' : 'zh'; persist(); render(); };
$('copy-notes').onclick = copyNotes;
$('copy-close').onclick = () => $('copy-dialog').close();
$('copy-dialog').onclose = () => clearInterval(copyTimer);
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#article=')) showPage(decodeURIComponent(location.hash.slice(9)), false);
  else { selected = null; view = location.hash === '#revisions' ? 'revisions' : 'home'; render(); }
});
new ResizeObserver(() => { document.documentElement.style.setProperty('--header-height', document.querySelector('header').offsetHeight + 'px'); }).observe(document.querySelector('header'));
restore();
if (location.hash.startsWith('#article=')) showPage(decodeURIComponent(location.hash.slice(9)), false);
else { if (location.hash === '#revisions') view = 'revisions'; render(); }
`;
