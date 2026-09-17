import { DIAGRAM_VIEWER_SCRIPT } from "./diagramViewer.js";
import { DIAGRAM_STYLES } from "./diagramStyles.js";
/** Compiler-owned presentation only. Knowledge Markdown never becomes Vue code. */
export const siteMarkdownConfig = String.raw`
  html: false,
  attrs: { disable: true },
  config(md) {
    md.core.ruler.before('block', 'context_trusted_site', state => {
      state.md.options.html = /^(?:_site|custom)\//.test(state.env.relativePath || '');
    });
    md.block.ruler.disable('snippet');
    const linkOpen = md.renderer.rules.link_open;
    md.renderer.rules.link_open = (tokens, index, options, env, self) => {
      // Let VitePress normalize the base and .md URL before adding a target;
      // its renderer deliberately skips normalization for targeted links.
      const rendered = linkOpen ? linkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
      if (/(?:^|\/)llms\/index\.md$/.test(env.relativePath || '')) {
        tokens[index].attrSet('target', '_blank');
        tokens[index].attrJoin('rel', 'noopener noreferrer');
        return self.renderToken(tokens, index, options);
      }
      return rendered;
    };
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
    md.renderer.rules.text = (...args) => {
      const rendered = text ? text(...args) : md.utils.escapeHtml(args[0][args[1]].content);
      return /^(?:_site|custom)\//.test(args[3]?.relativePath || '') ? rendered : rendered.replace(/\{/g, '&#123;');
    };
    // Inline/indented code bypasses the text renderer. Preserve its literal
    // spelling for readers without allowing Vue to interpret interpolation.
    for (const name of ['code_inline', 'code_block']) {
      const render = md.renderer.rules[name];
      if (render) md.renderer.rules[name] = (...args) => render(...args).replace(/\{/g, '&#123;');
    }
    md.block.ruler.before('paragraph', 'context_anchor', (state, line, end, silent) => {
      const raw = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      const match = /^<a id="(section-[a-zA-Z0-9_%.-]+)"><\/a>$/.exec(raw);
      if (!match) return false;
      if (!silent) { const token = state.push('context_anchor', '', 0); token.content = match[1]; }
      state.line = line + 1;
      return true;
    }, { alt: ['paragraph'] });
    md.renderer.rules.context_anchor = (tokens, index) => '<a id="' + md.utils.escapeHtml(tokens[index].content) + '"></a>\n';
  }
`;

export const siteThemeScript = String.raw`
import DefaultTheme from 'vitepress/theme-without-fonts';
import { useData, useRoute, dataSymbol } from 'vitepress';
import { onMounted, onUnmounted, nextTick, watch, computed, ref, provide, h } from 'vue';
import './style.css';
import extensions from './extensions.js';
export default {
  extends: DefaultTheme,
  Layout: {
    setup() {
      const data = useData();
      const route = useRoute();
      const sections = computed(() => data.theme.value.contextSections || []);
      const home = computed(() => data.theme.value.contextHome || {});
      const selected = ref('');
      const allSources = ref(false);
      const mounted = ref(false);
      const language = ref('zh');
      const copiedCommand = ref('');
      let copyReset;
      const chinese = computed(() => language.value === 'zh');
      const languageKey = 'context-language:' + data.site.value.base;
      onMounted(() => {
        let saved;
        try { saved = localStorage.getItem(languageKey); } catch {}
        language.value = saved === 'en' || saved === 'zh' ? saved :
          navigator.language.toLowerCase().startsWith('en') ? 'en' : 'zh';
      });
      const changeLanguage = value => {
        language.value = value;
        try { localStorage.setItem(languageKey, value); } catch {}
      };
      const href = value => value.startsWith('/') ? data.site.value.base + value.slice(1) : value;
      const external = value => /^https?:\/\//.test(value) || value.startsWith('mailto:');
      const copyCommand = async value => {
        try {
          await navigator.clipboard.writeText(value);
          copiedCommand.value = value;
          clearTimeout(copyReset);
          copyReset = setTimeout(() => { if (copiedCommand.value === value) copiedCommand.value = ''; }, 1600);
        } catch {}
      };
      const links = items => items.flatMap(item => [
        ...(item.link ? [{ text: item.text, link: item.link }] : []),
        ...links(item.items || []),
      ]);
      const siteMap = () => h('section', { class: 'context-home-section context-home-map', 'aria-labelledby': 'context-home-map-title' }, [
        h('div', { class: 'context-home-section-heading' }, [
          h('p', { class: 'context-home-kicker' }, chinese.value ? 'KNOWLEDGE MAP' : 'KNOWLEDGE MAP'),
          h('h2', { id: 'context-home-map-title' }, chinese.value ? '网站地图' : 'Site map'),
          h('p', chinese.value ? '从主题进入知识，也可以继续查看栏目中的具体页面。' :
            'Start with a topic, then continue to the pages within each section.'),
        ]),
        h('div', { class: 'context-home-map-grid' }, sections.value.map((section, index) => {
          const pages = links(section.items || []);
          return h('article', { class: 'context-home-map-card', style: { '--context-home-delay': (index * 35) + 'ms' } }, [
            h('div', { class: 'context-home-map-card-heading' }, [
              h('h3', h('a', { href: href(section.href) }, section.title)),
              h('span', chinese.value ? section.pages.length + ' 页' : section.pages.length + ' pages'),
            ]),
            pages.length ? h('ul', pages.slice(0, 6).map(page => h('li',
              h('a', { href: href(page.link) }, page.text)))) : null,
            pages.length > 6 ? h('a', { class: 'context-home-map-more', href: href(section.href) },
              chinese.value ? '查看全部 ' + pages.length + ' 页 →' : 'View all ' + pages.length + ' pages →') : null,
          ]);
        })),
      ]);
      const resources = () => {
        const builtins = [
          { title: 'LLM Docs', description: chinese.value ? '面向 Agent 和模型的结构化知识入口。' :
            'Structured knowledge entry points for agents and models.', href: '/llms/index.html', action: chinese.value ? '打开文档' : 'Open docs' },
          { title: 'Changelog', description: chinese.value ? '查看知识内容的版本变化与更新时间。' :
            'Review knowledge versions and update history.', href: '/changelog.html', action: chinese.value ? '查看更新' : 'View updates' },
        ];
        const items = [...(home.value.resources || []), ...builtins];
        return h('section', { class: 'context-home-section context-home-resources', 'aria-labelledby': 'context-home-resources-title' }, [
          h('div', { class: 'context-home-section-heading' }, [
            h('p', { class: 'context-home-kicker' }, chinese.value ? 'RESOURCES' : 'RESOURCES'),
            h('h2', { id: 'context-home-resources-title' }, chinese.value ? '工具与资源' : 'Tools and resources'),
          ]),
          h('div', { class: 'context-home-resource-grid' }, items.map((item, index) => h('article', {
            class: 'context-home-resource-card', style: { '--context-home-delay': (index * 35) + 'ms' },
          }, [
            h('div', { class: 'context-home-resource-heading' }, [
              h('h3', item.title),
              h('div', { class: 'context-home-resource-actions' }, [
                item.command ? h('button', { class: 'context-home-install-action', type: 'button',
                  title: (chinese.value ? '复制安装命令：' : 'Copy install command: ') + item.command,
                  onClick: () => copyCommand(item.command) }, copiedCommand.value === item.command
                    ? (chinese.value ? '已复制' : 'Copied') : (chinese.value ? '安装' : 'Install')) : null,
                item.href ? h('a', { class: 'context-home-resource-action', href: href(item.href), ...(external(item.href)
                  ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, item.action || (chinese.value ? '访问' : 'Open')) : null,
              ]),
            ]),
            item.description ? h('p', item.description) : null,
          ]))),
        ]);
      };
      const poweredBy = () => home.value.branding ? h('footer', { class: 'context-home-powered' }, [
        home.value.branding.label + ' ',
        h('a', { href: home.value.branding.href, target: '_blank', rel: 'noopener noreferrer' }, home.value.branding.name),
      ]) : null;
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
        allSources.value = false;
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
      const inHome = computed(() => data.frontmatter.value.layout === 'home');
      provide(dataSymbol, { ...data, theme: computed(() => ({ ...data.theme.value,
        ...data.theme.value.contextUiLabels?.[language.value],
        sidebar: inLlms.value || inHistory.value ? [] : active.value?.items || [],
        nav: [...sections.value.map(section => ({ text: section.title, link: section.href,
          activeMatch: !inLlms.value && !inHistory.value && section.key === selected.value ? '^' : '(?!)' })),
          { text: chinese.value ? '更多' : 'More', items: [
            { text: 'LLM Docs', link: '/llms/index.html' },
            { text: 'Changelog', link: '/changelog.html' }],
            activeMatch: inLlms.value || inHistory.value ? '^' : '(?!)' }],
      })) });
      const slots = {
        'home-hero-before': () => extensions.banner ? extensions.banner() : null,
        'layout-bottom': () => extensions.floating ? h('div', { class: 'context-business-floating' }, extensions.floating()) : null,
        'nav-bar-content-after': () => h('button', { class: 'context-language', type: 'button',
          'aria-label': chinese.value ? 'Switch interface language to English' : '将界面语言切换为中文',
          title: chinese.value ? 'Switch to English' : '切换为中文',
          onClick: () => changeLanguage(chinese.value ? 'en' : 'zh') }, chinese.value ? 'EN' : '中文'),
        'home-features-before': () => [
          extensions.knowledge === undefined ? siteMap() : extensions.knowledge && extensions.knowledge(),
          extensions.resources === undefined ? resources() : extensions.resources && extensions.resources()],
        'home-features-after': () => extensions.footer === undefined ? poweredBy() : extensions.footer && extensions.footer(),
        'doc-after': () => history.value ? h('section', { class: 'context-history-cards' },
          history.value.length ? history.value.map((entry, index) =>
            h('details', { class: 'context-history-card', open: index < 3, key: entry.version }, [
              h('summary', [h('strong', entry.version), h('span', { class: 'context-history-title' }, entry.title),
                h('span', { class: 'context-history-attribution' }, [
                  (entry.actor ? entry.actor.name + ' ' : '') + (chinese.value ? '更新于 ' : 'updated on '),
                  h('time', { datetime: entry.date }, entry.date.slice(0, 10)),
                ])]),
              h('div', { class: 'context-history-body' }, [
                h('ul', entry.changes.map(change => h('li', change))),
                h('div', { class: 'context-history-meta' }, [
                  h('strong', chinese.value ? '触发来源' : 'Triggered by'),
                  h('ul', entry.triggers.map(trigger => h('li', trigger.kind + ': ' + trigger.description))),
                ]),
              ]),
            ])) : [h('p', chinese.value ? '暂无版本记录。' : 'No versions recorded yet.')]) : null,
        'sidebar-nav-before': () => h('div', { class: 'context-mobile-directory' }, [
          h('div', { class: 'context-mobile-directory-heading' }, [
            h('span', chinese.value ? '文章目录' : 'Articles'),
            h('button', { type: 'button', 'aria-label': chinese.value ? '关闭目录' : 'Close navigation',
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
                h('div', { class: 'context-sources-title' }, chinese.value ? '来源与溯源' : 'Sources'),
              ]),
              h('ul', (allSources.value ? sources : sources.slice(0, 10)).map(source => h('li', source.href
                ? h('a', { href: source.href, target: '_blank', rel: 'noopener noreferrer' }, source.label)
                : source.label))),
              sources.length > 10 && !allSources.value ? h('button', { type: 'button', class: 'context-sources-more',
                onClick: () => { allSources.value = true; } }, chinese.value ? '查看更多' : 'Show more') : null,
            ]) : null,
            (data.frontmatter.value.contextUpdated || data.theme.value.contextUpdated)
              ? h('div', { class: 'context-article-updated' }, [
                  chinese.value ? '最后更新：' : 'Last updated: ',
                  h('a', { href: data.site.value.base + 'changelog.html' },
                    h('time', { datetime: data.frontmatter.value.contextUpdated || data.theme.value.contextUpdated }, updatedLabel.value)),
                ]) : null,
          ]);
        },
      };
      // History belongs between the page heading and footer metadata.
      return () => h(DefaultTheme.Layout, { class: inHome.value ? 'context-home' :
        inLlms.value || inHistory.value ? 'context-empty-sidebar' : undefined }, { ...slots, 'doc-after': undefined,
        'doc-footer-before': () => [slots['doc-after'](), slots['doc-footer-before']()] });
    }
  },
  setup() {
    const route = useRoute();
    const { isDark } = useData();
    const viewer = ${DIAGRAM_VIEWER_SCRIPT}(async () => {
      const [{ default: mermaid }, { default: elk }] = await Promise.all([import('mermaid'), import('@mermaid-js/layout-elk')]);
      mermaid.registerLayoutLoaders(elk);
      return mermaid;
    });
    const render = async () => {
      await nextTick();
      await viewer.render(document, { dark: isDark.value, language: document.documentElement.lang || 'en' });
    };
    onMounted(render);
    onUnmounted(() => viewer.destroy());
    watch([() => route.path, isDark], render);
  }
};
`;

export const siteThemeCss = `
.context-business-floating { position: fixed; right: max(20px, env(safe-area-inset-right)); bottom: max(20px, env(safe-area-inset-bottom)); z-index: 30; max-width: calc(100vw - 40px); }
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
.VPNav, .VPNavBar, .VPNavBar .wrapper { background: var(--vp-c-bg) !important; }
.VPNavBar .title { position: static !important; padding: 0 !important; width: var(--vp-sidebar-width) !important; flex-shrink: 0; }
.VPNavBarTitle .title { font-size: 15px; font-weight: 650; border: 0 !important; }
.VPNavBar .content { flex: 1; min-width: 0; padding-left: 0 !important; }
.VPNavBar .content-body { background: var(--vp-c-bg) !important; gap: 8px; }
.VPNavBarMenu { order: -1; flex: 1; min-width: 0; }
.context-language { display: inline-flex; align-items: center; padding: 5px 7px; border: 0; border-radius: 6px; color: var(--vp-c-text-2);
  background: transparent; white-space: nowrap; font-size: 12px; font-weight: 550; cursor: pointer; }
.context-language:hover { color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); }
.VPNavBarMenuLink { font-size: 13px !important; font-weight: 550 !important; padding: 0 16px !important; }
.VPNavBarMenuLink.active { box-shadow: inset 0 -2px var(--vp-c-brand-1); }
.VPNavBarSearch { flex: 0 0 376px !important; width: 376px; padding: 0 12px !important; }
.VPNavBarSearch #local-search, .VPNavBarSearch .DocSearch-Button { width: 352px; }
.VPNavBarSearch .DocSearch-Button { display: flex; align-items: center; }
.VPNavBarSearch .DocSearch-Button-Container { display: flex; flex: 1; min-width: 0; align-items: center; }
.VPNavBarSearch .DocSearch-Button-Keys { margin-left: auto; }
.VPSidebar { border-top: 1px solid var(--vp-c-divider); border-right: 1px solid var(--vp-c-divider); scrollbar-width: thin; }
.VPSidebar .group, .VPSidebar .group + .group { border: 0; padding-top: 0; }
.VPSidebarItem .link { min-width: 0; overflow: hidden; }
.VPSidebarItem .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px !important; line-height: 20px !important; font-weight: 450 !important; }
.VPSidebarItem.level-0 { padding-bottom: 0 !important; }
.VPSidebarItem .indicator { display: none; }
.VPSidebarItem .text { padding: 0 !important; }
.VPSidebarItem .item { height: 38px; min-height: 38px; align-items: center; padding: 0 16px 0 26px; border-radius: 0; }
.VPSidebarItem.is-link:not(.is-active) > .item > .link > p.text { color: var(--vp-c-text-2); }
.VPSidebarItem.is-link:not(.is-active) > .item > .link:hover > p.text { color: var(--vp-c-brand-1); }
.VPSidebarItem.is-active > .item { background: var(--vp-c-brand-soft); box-shadow: none; }
.VPSidebarItem.is-active > .item .text { color: var(--vp-c-brand-1) !important; font-weight: 550 !important; }
.VPSidebarItem .items { margin-left: 0; padding-left: 0 !important; border-left: 0 !important; }
.VPSidebarItem.level-1 > .item { padding-left: 40px; }
.VPSidebarItem.level-2 > .item { padding-left: 54px; }
.VPSidebarItem.level-3 > .item { padding-left: 68px; }
.VPSidebarItem.level-4 > .item { padding-left: 82px; }
.VPSidebarItem.level-5 > .item { padding-left: 96px; }
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
.context-home { max-width: 100%; min-width: 0; overflow-x: clip; }
.context-home .VPContent, .context-home .VPHome, .context-home .VPHero { max-width: 100%; min-width: 0; }
.context-home .VPHome { padding-bottom: 0; }
.context-home .VPHero { position: relative; padding: 132px 0 62px; }
.context-home .VPHero::before { content: ''; position: absolute; top: -1px; right: 0; bottom: 0; left: calc(0px - var(--vp-sidebar-width)); pointer-events: none;
  background: linear-gradient(to bottom, transparent 58%, var(--vp-c-bg) 100%),
    radial-gradient(ellipse 58% 145% at 8% 18%, rgba(37,99,235,.16), transparent 72%),
    radial-gradient(ellipse 58% 150% at 68% 24%, rgba(0,190,200,.11), transparent 72%),
    linear-gradient(90deg, rgba(37,99,235,.045), rgba(0,190,200,.025) 68%, transparent); }
.context-home .VPHero .container { position: relative; box-sizing: border-box; width: min(1180px, calc(100% - 104px)); max-width: none; min-width: 0; margin-left: 52px; margin-right: auto; }
.context-home .VPHero .main { width: 100%; max-width: 980px; min-width: 0; }
.context-home .VPHero .heading { display: block; width: 100%; min-width: 0; max-width: 100%; }
.context-home .VPHero .name { display: block; width: 100%; max-width: 100%; overflow-wrap: anywhere; white-space: normal; color: transparent;
  background: linear-gradient(112deg, var(--vp-c-brand-1), var(--context-accent)); background-clip: text; -webkit-background-clip: text; }
.context-home .VPHero .text { display: block; width: 100%; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; white-space: normal;
  font-size: clamp(38px, 4.2vw, 60px); line-height: 1.08; letter-spacing: -.045em; }
.context-home .VPHero .tagline { max-width: 820px; font-size: 18px; line-height: 1.75; }
.context-home .VPHero .actions { width: 100%; min-width: 0; padding-top: 38px; flex-wrap: wrap; }
.context-home .VPFeatures { display: none; }
.context-home-section { width: min(1180px, calc(100% - 104px)); margin: 0 auto 0 52px; padding: 36px 0 44px; }
.context-home-section + .context-home-section { border-top: 1px solid var(--vp-c-divider); }
.context-home-map { padding-top: 0; }
.context-home-resources { padding-top: 6px; border-top: 0 !important; }
.context-home-section-heading { max-width: 700px; margin-bottom: 24px; }
.context-home-section-heading h2 { margin: 2px 0 8px; border: 0; font-size: 28px; line-height: 1.3; letter-spacing: -.02em; }
.context-home-section-heading > p:last-child { color: var(--vp-c-text-2); line-height: 1.7; }
.context-home-kicker { margin: 0; color: var(--vp-c-brand-1); font-size: 11px; font-weight: 700; letter-spacing: .16em; }
.context-home-map-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr)); gap: 14px; }
.context-home-map-card, .context-home-resource-card { border: 1px solid var(--vp-c-divider); background: color-mix(in srgb, var(--vp-c-bg) 88%, var(--vp-c-bg-soft));
  animation: context-home-rise .5s both; animation-delay: var(--context-home-delay); }
.context-home-map-card { min-height: 224px; padding: 22px; border-radius: 14px; }
.context-home-map-card:hover, .context-home-resource-card:hover { border-color: color-mix(in srgb, var(--vp-c-brand-1) 42%, var(--vp-c-divider));
  box-shadow: 0 14px 38px rgba(23,36,66,.08); transform: translateY(-2px); transition: border-color .18s, box-shadow .18s, transform .18s; }
.context-home-map-card-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding-bottom: 13px; border-bottom: 1px solid var(--vp-c-divider); }
.context-home-map-card h3, .context-home-resource-card h3 { margin: 0; font-size: 17px; line-height: 1.45; }
.context-home-map-card h3 a { color: var(--vp-c-text-1); }
.context-home-map-card-heading span { flex: none; color: var(--vp-c-text-2); font-size: 11px; }
.context-home-map-card ul { margin: 14px 0 0; padding: 0; list-style: none; }
.context-home-map-card li { margin: 7px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.context-home-map-card li a { color: var(--vp-c-text-2); font-size: 13px; }
.context-home-map-card li a:hover, .context-home-map-more:hover { color: var(--vp-c-brand-1); }
.context-home-map-more { display: inline-block; margin-top: 12px; color: var(--vp-c-brand-1); font-size: 12px; font-weight: 600; }
.context-home-resource-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.context-home-resource-card { min-height: 118px; padding: 16px 18px; border-radius: 12px; }
.context-home-resource-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.context-home-resource-actions { display: flex; flex: none; align-items: center; gap: 6px; }
.context-home-resource-action, .context-home-install-action { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 8px; border: 1px solid var(--vp-c-divider); border-radius: 6px;
  color: var(--vp-c-text-2); background: var(--vp-c-bg); font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap; }
.context-home-resource-action:hover, .context-home-install-action:hover { border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); }
.context-home-install-action { cursor: pointer; background: var(--vp-c-brand-soft); }
.context-home-resource-card p { margin: 8px 0 0; color: var(--vp-c-text-2); font-size: 13px; line-height: 1.55; }
.context-home-powered { width: min(1180px, calc(100% - 104px)); margin: 24px auto 0 52px; padding: 22px 0 30px; border-top: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2); font-size: 11px; text-align: right; }
.context-home-powered a { color: inherit; }
@keyframes context-home-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@media (min-width: 960px) {
  .VPSidebar { top: var(--vp-nav-height) !important; width: var(--vp-sidebar-width) !important; padding: 12px 0 48px !important; }
  .VPSidebar .curtain { display: none; }
  .VPContent.has-sidebar { padding-left: var(--vp-sidebar-width) !important; padding-right: 0 !important; }
  .context-empty-sidebar .VPContent { padding-left: var(--vp-sidebar-width) !important; padding-right: 0 !important; }
  .context-home .VPContent { padding-left: var(--vp-sidebar-width) !important; padding-right: 0 !important; }
  .VPNavBar .content { padding-right: 32px !important; }
  .VPDoc { padding: 44px 36px 80px !important; }
  .VPDoc > .container > .content { padding: 0 24px 80px 0 !important; }
}
@media (min-width: 1600px) { .VPDoc { padding-left: 52px !important; padding-right: 36px !important; } }
@media (min-width: 960px) and (max-width: 1279px) {
  .VPNavBar .title { width: 220px !important; }
  .VPNavBarMenuLink { padding: 0 9px !important; }
  .VPNavBarSearch { flex-basis: 168px !important; width: 168px; }
  .VPNavBarSearch .DocSearch-Button { width: 144px; }
  .context-home .VPHero .main { max-width: 100%; }
  .context-home-resource-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1280px) and (max-width: 1599px) {
  .VPNavBarSearch { flex-basis: 248px !important; width: 248px; }
  .VPNavBarSearch #local-search, .VPNavBarSearch .DocSearch-Button { width: 224px; }
}
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
  .context-home .VPHero { padding-top: 104px; padding-bottom: 66px; }
  .context-home .VPHero::before { left: 0; }
  .context-home .VPHero .container { width: min(calc(100% - 36px), 680px); margin-left: auto; margin-right: auto; }
  .context-home .VPHero .text { font-size: 40px; }
  .context-home .VPHero .tagline { font-size: 16px; }
  .context-home-section, .context-home-powered { width: min(calc(100% - 36px), 680px); margin-left: auto; margin-right: auto; }
  .context-home-resource-grid { grid-template-columns: 1fr; }
}
@media (max-width: 1279px) {
  .VPNavBarMenu { display: none !important; }
  .VPNavBarHamburger { display: flex !important; }
  .VPNavScreen { display: block !important; }
  .VPNavScreen { bottom: auto !important; max-height: calc(100dvh - var(--vp-nav-height)); overflow-y: auto; }
  .VPNavBarSearch { flex: 0 0 48px !important; width: 48px; padding: 0 4px !important; }
  .VPNavBarSearch #local-search, .VPNavBarSearch .DocSearch-Button { width: 40px; }
  .VPNavBarSearch .DocSearch-Button-Placeholder, .VPNavBarSearch .DocSearch-Button-Keys { display: none !important; }
}
@media (prefers-reduced-motion: reduce) {
  .context-home-map-card, .context-home-resource-card { animation: none; }
  .context-home-map-card:hover, .context-home-resource-card:hover { transform: none; }
}
.context-sources { margin-top: 0; margin-bottom: 24px; padding: 16px 20px; border: 1px solid var(--vp-c-divider); border-radius: 8px; background: var(--vp-sidebar-bg-color); color: var(--vp-c-text-2); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.context-sources-header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; margin-bottom: 8px; }
.context-sources-title { font-weight: 550; }
.context-sources-more { color: var(--vp-c-brand-1); font-size: 13px; padding: 4px 0; cursor: pointer; }
.context-provenance { margin-bottom: 24px; }
.context-provenance .context-sources { margin-bottom: 10px; }
.context-article-updated { margin-top: 0; text-align: right; color: var(--vp-c-text-2); font-size: 12px; line-height: 1.7; }
.context-sources ul { list-style: none; margin: 0; padding: 0; }
.context-sources li + li { margin-top: 6px; }
.context-sources a { color: inherit; text-decoration: none; border-bottom: 1px solid transparent; }
.context-sources a:hover { color: var(--vp-c-brand-1); border-color: currentColor; }
${DIAGRAM_STYLES}
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
  } : {
    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous page", next: "Next page" },
    sidebarMenuLabel: "Menu", returnToTopLabel: "Return to top",
    darkModeSwitchLabel: "Appearance", lightModeSwitchTitle: "Switch to light theme", darkModeSwitchTitle: "Switch to dark theme",
    search: { provider: "local" },
  };
}
