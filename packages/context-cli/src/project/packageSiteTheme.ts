/** Compiler-owned presentation only. Knowledge Markdown never becomes Vue code. */
export const siteMarkdownConfig = String.raw`
  html: false,
  attrs: { disable: true },
  config(md) {
    md.block.ruler.disable('snippet');
    md.inline.ruler.before('text', 'context_break', (state, silent) => {
      const match = /^<br\s*\/?\s*>/i.exec(state.src.slice(state.pos));
      if (!match) return false;
      if (!silent) state.push('hardbreak', 'br', 0);
      state.pos += match[0].length;
      return true;
    });
    md.block.ruler.before('paragraph', 'context_details', (state, line, end, silent) => {
      const raw = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      const summary = /^<summary>(.*?)<\/summary>$/.exec(raw);
      if (!summary && raw !== '<details>' && raw !== '</details>') return false;
      if (!silent) { const token = state.push('context_details', '', 0); token.content = summary
        ? '<summary>' + md.utils.escapeHtml(summary[1]).replace(/\{/g, '&#123;') + '</summary>' : raw; }
      state.line = line + 1;
      return true;
    });
    md.renderer.rules.context_details = (tokens, index) => tokens[index].content + '\n';
    const text = md.renderer.rules.text;
    md.renderer.rules.text = (...args) => (text ? text(...args) : md.utils.escapeHtml(args[0][args[1]].content)).replace(/\{/g, '&#123;');
    md.block.ruler.before('paragraph', 'context_anchor', (state, line, end, silent) => {
      const raw = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      const match = /^<a id="(section-[a-zA-Z0-9_%.-]+)"><\/a>$/.exec(raw);
      if (!match) return false;
      if (!silent) { const token = state.push('context_anchor', '', 0); token.content = match[1]; }
      state.line = line + 1;
      return true;
    });
    md.renderer.rules.context_anchor = (tokens, index) => '<a id="' + md.utils.escapeHtml(tokens[index].content) + '"></a>\n';
  }
`;

export const siteThemeScript = String.raw`
import DefaultTheme from 'vitepress/theme-without-fonts';
import { useData, useRoute, dataSymbol } from 'vitepress';
import { onMounted, nextTick, watch, computed, ref, provide, h } from 'vue';
import './style.css';
export default {
  extends: DefaultTheme,
  Layout: {
    setup() {
      const data = useData();
      const route = useRoute();
      const sections = computed(() => data.theme.value.contextSections || []);
      const selected = ref('');
      const mounted = ref(false);
      const history = computed(() => data.frontmatter.value.contextHistory
        ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data.frontmatter.value.contextHistory), char => char.charCodeAt(0)))) : null);
      onMounted(() => { mounted.value = true; });
      const updatedLabel = computed(() => {
        const value = data.frontmatter.value.contextUpdated || data.theme.value.contextUpdated;
        if (!value) return '';
        if (!mounted.value) return value.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
        const parts = new Intl.DateTimeFormat('en-GB', {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
          minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
        }).formatToParts(new Date(value));
        const part = type => parts.find(item => item.type === type)?.value || '';
        return part('year') + '-' + part('month') + '-' + part('day') + ' ' +
          part('hour') + ':' + part('minute') + ':' + part('second') + ' ' + part('timeZoneName');
      });
      watch(() => route.path, () => {
        const base = data.site.value.base;
        const path = route.path.startsWith(base) ? '/' + route.path.slice(base.length) : route.path;
        const direct = sections.value.find(section => section.href === path);
        const current = sections.value.find(section => section.key === selected.value);
        selected.value = (direct || (current?.pages.includes(path) ? current :
          sections.value.find(section => section.pages.includes(path))) || sections.value[0])?.key || '';
      }, { immediate: true });
      const active = computed(() => sections.value.find(section => section.key === selected.value));
      const inLlms = computed(() => route.path.startsWith(data.site.value.base + 'llms/'));
      const inHistory = computed(() => route.path === data.site.value.base + 'changelog.html');
      provide(dataSymbol, { ...data, theme: computed(() => ({ ...data.theme.value,
        sidebar: inLlms.value || inHistory.value ? [] : active.value?.items || [],
        nav: [...sections.value.map(section => ({ text: section.title, link: section.href,
          activeMatch: !inLlms.value && !inHistory.value && section.key === selected.value ? '^' : '(?!)' })),
          { text: 'LLM Docs', link: '/llms/index.html', activeMatch: inLlms.value ? '^' : '(?!)' },
          { text: 'Changelog', link: '/changelog.html', activeMatch: inHistory.value ? '^' : '(?!)' }],
      })) });
      const slots = {
        'doc-after': () => history.value ? h('section', { class: 'context-history-cards' },
          history.value.length ? history.value.map((entry, index) =>
            h('details', { class: 'context-history-card', open: index < 3, key: entry.version }, [
              h('summary', [h('strong', entry.version), h('span', { class: 'context-history-title' }, entry.title),
                h('span', { class: 'context-history-attribution' }, [
                  (entry.actor ? entry.actor.name + ' ' : '') + (data.lang.value.startsWith('zh') ? '更新于 ' : 'updated on '),
                  h('time', { datetime: entry.date }, entry.date.slice(0, 10)),
                ])]),
              h('div', { class: 'context-history-body' }, [
                h('ul', entry.changes.map(change => h('li', change))),
                h('div', { class: 'context-history-meta' }, [
                  h('strong', data.lang.value.startsWith('zh') ? '触发来源' : 'Triggered by'),
                  h('ul', entry.triggers.map(trigger => h('li', trigger.kind + ': ' + trigger.description))),
                ]),
              ]),
            ])) : [h('p', data.lang.value.startsWith('zh') ? '暂无版本记录。' : 'No versions recorded yet.')]) : null,
        'sidebar-nav-before': () => h('div', { class: 'context-mobile-directory' }, [
          h('div', { class: 'context-mobile-directory-heading' }, [
            h('span', data.lang.value.startsWith('zh') ? '文章目录' : 'Articles'),
            h('button', { type: 'button', 'aria-label': data.lang.value.startsWith('zh') ? '关闭目录' : 'Close navigation',
              onClick: () => document.querySelector('.VPBackdrop')?.click() }, '×'),
          ]),
          h('div', { class: 'context-mobile-sections' }, sections.value.map(section => h('a', {
            href: data.site.value.base + section.href.slice(1),
            class: section.key === selected.value ? 'active' : undefined,
          }, section.title))),
        ]),
        'doc-footer-before': () => {
          const sources = data.frontmatter.value.contextSources || [];
          return h('div', { class: 'context-provenance' }, [
            sources.length ? h('section', { class: 'context-sources' }, [
              h('div', { class: 'context-sources-header' }, [
                h('div', { class: 'context-sources-title' }, data.lang.value.startsWith('zh') ? '来源与溯源' : 'Sources'),
              ]),
              h('ul', sources.map(source => h('li', source.href
                ? h('a', { href: source.href, target: '_blank', rel: 'noopener noreferrer' }, source.label)
                : source.label))),
            ]) : null,
            (data.frontmatter.value.contextUpdated || data.theme.value.contextUpdated)
              ? h('div', { class: 'context-article-updated' }, [
                  data.lang.value.startsWith('zh') ? '最后更新：' : 'Last updated: ',
                  h('a', { href: data.site.value.base + 'changelog.html' },
                    h('time', { datetime: data.frontmatter.value.contextUpdated || data.theme.value.contextUpdated }, updatedLabel.value)),
                ]) : null,
          ]);
        },
      };
      // History belongs between the page heading and footer metadata.
      return () => h(DefaultTheme.Layout, { class: inLlms.value || inHistory.value ? 'context-empty-sidebar' : undefined }, { ...slots, 'doc-after': undefined,
        'doc-footer-before': () => [slots['doc-after'](), slots['doc-footer-before']()] });
    }
  },
  setup() {
    const route = useRoute();
    const { isDark } = useData();
    let generation = 0;
    let queue = Promise.resolve();
    const render = async () => {
      const current = ++generation;
      await nextTick();
      const nodes = [...document.querySelectorAll('.vp-doc div.language-mermaid')];
      if (!nodes.length) return;
      queue = queue.catch(() => {}).then(async () => {
        if (current !== generation) return;
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base',
          themeVariables: { darkMode: isDark.value, fontFamily: 'system-ui, sans-serif',
            primaryColor: isDark.value ? '#202127' : '#ffffff',
            primaryTextColor: isDark.value ? '#dfdfe5' : '#161e2e',
            primaryBorderColor: isDark.value ? '#92929a' : '#73737b',
            lineColor: isDark.value ? '#92929a' : '#73737b',
            secondaryColor: isDark.value ? '#292a30' : '#f6f6f7',
            tertiaryColor: isDark.value ? '#292a30' : '#f6f6f7' } });
        for (const [index, node] of nodes.entries()) {
          if (current !== generation || !node.isConnected) return;
          const code = node.querySelector('pre code');
          if (!code) continue;
          const source = code.textContent || '';
          let output = node.querySelector('.context-diagram');
          if (!output) { output = document.createElement('div'); output.className = 'context-diagram'; node.append(output); }
          const renderId = 'context-diagram-' + current + '-' + index;
          try {
            if (!await mermaid.parse(source, { suppressErrors: true })) throw new Error('Invalid diagram');
            const { svg } = await mermaid.render(renderId, source);
            if (current !== generation || !node.isConnected) return;
            output.innerHTML = svg;
            node.classList.add('context-rendered');
            if (!node.querySelector('.context-diagram-toggle')) {
              const toggle = document.createElement('button');
              toggle.className = 'context-diagram-toggle'; toggle.textContent = 'Diagram / source';
              toggle.onclick = () => node.classList.toggle('context-show-source');
              node.append(toggle);
            }
          } catch {
            document.getElementById('d' + renderId)?.remove();
            output.remove(); node.classList.remove('context-rendered');
          }
        }
      });
      await queue;
    };
    onMounted(render);
    watch([() => route.path, isDark], render);
  }
};
`;

export const siteThemeCss = `
.context-history-cards { display: grid; gap: 16px; margin: 24px 0; }
.context-history-card { border: 1px solid var(--vp-c-divider); border-radius: 12px; background: var(--vp-c-bg-soft); }
.context-history-card summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; padding: 20px; cursor: pointer; }
.context-history-card summary::before { content: '▸'; }
.context-history-card[open] summary::before { content: '▾'; }
.context-history-card summary strong { color: var(--vp-c-brand-1); font-size: 13px; }
.context-history-title { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.context-history-attribution { margin-left: auto; font-size: 13px; color: var(--vp-c-text-2); }
.context-history-body { padding: 0 24px 20px; font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.context-history-body ul { list-style: disc; padding-left: 20px; }
.context-history-meta { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--vp-c-divider); color: var(--vp-c-text-2); }
:root {
  --vp-font-family-base: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --vp-font-family-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --vp-c-brand-1: rgb(37, 99, 235); --vp-c-brand-2: #00bec8; --vp-c-brand-3: rgb(37, 99, 235);
  --context-accent: #00bec8;
  --vp-c-brand-soft: rgba(37, 99, 235, .08);
  --vp-sidebar-width: 280px;
  --vp-layout-max-width: 100%;
  --vp-nav-height: 64px;
  --vp-c-text-1: #161e2e; --vp-c-text-2: #646b7c;
  --vp-c-divider: #e7e9ef;
  --vp-sidebar-bg-color: #f8f9fc;
}
.dark {
  --vp-c-brand-1: #8eb7ff; --vp-c-brand-2: #b3cfff;
  --vp-c-brand-soft: rgba(142, 183, 255, .09);
  --vp-c-text-1: #e2e4ed; --vp-c-text-2: #a1a6b7;
  --vp-c-divider: #303440; --vp-sidebar-bg-color: #1b1d24;
}
.VPNavBar .wrapper { padding: 0 24px !important; }
.VPNavBar .container { max-width: none !important; }
.VPNavBar .title { position: static !important; padding: 0 !important; width: var(--vp-sidebar-width) !important; flex-shrink: 0; }
.VPNavBarTitle .title { font-size: 15px; font-weight: 650; border: 0 !important; }
.VPNavBar .content { flex: 1; min-width: 0; padding-left: 0 !important; }
.VPNavBar .content-body { background: var(--vp-c-bg) !important; gap: 8px; }
.VPNavBarMenu { order: -1; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.VPNavBarMenuLink { font-size: 13px !important; font-weight: 550 !important; padding: 0 16px !important; }
.VPNavBarMenuLink.active { box-shadow: inset 0 -2px var(--vp-c-brand-1); }
.VPNavBarSearch { flex-grow: 0 !important; padding: 0 12px !important; }
.VPSidebar { border-top: 1px solid var(--vp-c-divider); border-right: 1px solid var(--vp-c-divider); scrollbar-width: thin; }
.VPSidebar .group + .group { border: 0; padding-top: 8px; }
.VPSidebarItem .link { min-width: 0; overflow: hidden; }
.VPSidebarItem .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px !important; line-height: 20px !important; font-weight: 450 !important; }
.VPSidebarItem.level-0 { padding-bottom: 8px !important; }
.VPSidebarItem .indicator { display: none; }
.VPSidebarItem .text { padding: 3px 0 !important; }
.VPSidebarItem .item { min-height: 32px; padding: 3px 16px; border-radius: 0; }
.VPSidebarItem.is-active > .item { background: var(--vp-c-brand-soft); box-shadow: none; }
.VPSidebarItem.is-active > .item .text { color: var(--vp-c-brand-1) !important; font-weight: 550 !important; }
.VPSidebarItem .items { margin-left: 0; padding-left: 0 !important; border-left: 0 !important; }
.VPSidebarItem.level-1 > .item { padding-left: 30px; }
.VPSidebarItem.level-2 > .item { padding-left: 44px; }
.VPSidebarItem.level-3 > .item { padding-left: 58px; }
.VPSidebarItem.level-4 > .item { padding-left: 72px; }
.VPSidebarItem.level-5 > .item { padding-left: 86px; }
.VPSidebar .group { width: 100% !important; }
.VPSidebarItem .item:hover { background: var(--vp-c-default-soft); }
.VPDoc .container, .VPDoc > .container > .content, .VPDoc .content-container { max-width: none !important; min-width: 0 !important; }
.VPDoc > .container > .content { flex: 1; }
.VPDoc .aside { flex: 0 0 190px; width: 190px; max-width: 190px; padding-left: 24px; }
.VPDoc .aside-container, .VPDoc .aside-curtain { width: 166px; }
.VPDocAsideOutline .content { padding: 0 0 0 16px; }
.VPDocAsideOutline .outline-title { font-size: 11px; font-weight: 600; letter-spacing: .03em; color: var(--vp-c-text-2); }
.VPDocAsideOutline .outline-link { font-size: 12px !important; line-height: 20px !important; padding: 5px 0; white-space: normal; }
.vp-doc { font-size: 16px; line-height: 1.8; color: var(--vp-c-text-1); }
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
@media (min-width: 960px) {
  .VPSidebar { top: var(--vp-nav-height) !important; width: var(--vp-sidebar-width) !important; padding: 12px 0 48px !important; }
  .VPSidebar .curtain { display: none; }
  .VPContent.has-sidebar { padding-left: var(--vp-sidebar-width) !important; padding-right: 0 !important; }
  .context-empty-sidebar .VPContent { padding-left: var(--vp-sidebar-width) !important; padding-right: 0 !important; }
  .VPNavBar .content { padding-right: 32px !important; }
  .VPDoc { padding: 44px 36px 80px !important; }
  .VPDoc > .container > .content { padding: 0 24px 80px 0 !important; }
}
@media (min-width: 1600px) { .VPDoc { padding-left: 52px !important; padding-right: 36px !important; } }
.context-mobile-directory { display: none; }
@media (max-width: 959px) {
  .VPNavBar .wrapper { padding: 0 16px !important; }
  .VPNavBar .title { flex: 1; min-width: 0; }
  .VPNavBarTitle .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .VPNavBar .content { flex: 0 0 auto; }
  .VPSidebar { width: min(340px, calc(100vw - 40px)) !important; max-width: none; padding: 0 0 32px !important; }
  .context-mobile-directory { display: block; position: sticky; top: 0; z-index: 2; padding: 12px 16px; margin-bottom: 8px; border-bottom: 1px solid var(--vp-c-divider); background: var(--vp-sidebar-bg-color); }
  .context-mobile-directory-heading { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; }
  .context-mobile-directory-heading button { width: 36px; height: 36px; font-size: 24px; font-weight: 400; color: var(--vp-c-text-2); }
  .context-mobile-sections { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .context-mobile-sections a { padding: 5px 9px; border-radius: 5px; font-size: 12px; color: var(--vp-c-text-2); }
  .context-mobile-sections a.active { background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); }
  .VPNavScreen { bottom: auto !important; max-height: calc(100dvh - var(--vp-nav-height)); padding: 0 20px !important; border-bottom: 1px solid var(--vp-c-divider); box-shadow: 0 12px 24px rgba(0,0,0,.08); }
  .VPNavScreen > .container { max-width: none !important; padding: 8px 0 16px !important; }
  .VPNavScreenMenuLink { padding: 9px 0 !important; font-size: 13px !important; }
  .VPNavScreen .menu + .appearance { margin-top: 14px; }

  .VPNavBar .title { width: auto !important; }
  .vp-doc h1 { font-size: 28px; }
  .vp-doc h2 { font-size: 22px; }
  .VPDoc { padding: 32px 36px 64px !important; }
  .vp-doc a.header-anchor { margin-left: -0.8em; }
}
.context-sources { margin-top: 0; margin-bottom: 24px; padding: 16px 20px; border: 1px solid var(--vp-c-divider); border-radius: 8px; background: var(--vp-sidebar-bg-color); color: var(--vp-c-text-2); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.context-sources-header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; margin-bottom: 8px; }
.context-sources-title { font-weight: 550; }
.context-provenance { margin-bottom: 24px; }
.context-provenance .context-sources { margin-bottom: 10px; }
.context-article-updated { margin-top: 0; text-align: right; color: var(--vp-c-text-2); font-size: 12px; line-height: 1.7; }
.context-sources ul { list-style: none; margin: 0; padding: 0; }
.context-sources li + li { margin-top: 6px; }
.context-sources a { color: inherit; text-decoration: none; border-bottom: 1px solid transparent; }
.context-sources a:hover { color: var(--vp-c-brand-1); border-color: currentColor; }
.context-diagram { overflow: auto; padding: 20px; background: var(--vp-c-bg); }
.context-diagram svg { max-width: none !important; }
.context-diagram .node rect, .context-diagram .node polygon, .context-diagram .node circle,
.context-diagram .flowchart-link { stroke-width: 1px !important; }
.context-rendered:not(.context-show-source) pre, .context-rendered:not(.context-show-source) > .copy,
.context-rendered:not(.context-show-source) > .lang { display: none; }
.context-diagram-toggle { display: block; padding: 8px 14px; color: var(--vp-c-text-2); font-size: 12px; }
`;

export function siteThemeLabels(lang: string) {
  return lang.startsWith("zh") ? {
    outline: { level: [2, 3], label: "本页目录" },
    docFooter: { prev: "上一篇", next: "下一篇" },
    sidebarMenuLabel: "目录", returnToTopLabel: "返回顶部",
    darkModeSwitchLabel: "主题", lightModeSwitchTitle: "切换到日间", darkModeSwitchTitle: "切换到夜间",
    search: { provider: "local", options: { translations: {
      button: { buttonText: "搜索", buttonAriaLabel: "搜索知识库" },
      modal: { noResultsText: "没有找到相关内容", resetButtonTitle: "清空搜索", displayDetails: "显示详细内容",
        footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" } },
    } } },
  } : { outline: [2, 3], search: { provider: "local" } };
}
