import { readerContentStyles } from "./readerContentStyles.js";
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
    // The generated website config declares contextLocaleMarker; null when the site has no translations.
    const contextLocale = typeof contextLocaleMarker === 'string' ? contextLocaleMarker : null;
    md.block.ruler.before('paragraph', 'context_locale', (state, line, end, silent) => {
      if (!contextLocale) return false;
      const raw = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      const open = raw.startsWith('<!-- ' + contextLocale + ' ') && raw.endsWith(' -->');
      const original = raw.startsWith('<!-- ' + contextLocale + ':original ') && raw.endsWith(' -->');
      if (!open && !original && raw !== '<!-- /' + contextLocale + ' -->') return false;
      if (!silent) {
        const token = state.push('context_locale', '', 0);
        const value = raw.slice(raw.indexOf(' ', 5) + 1, -4).trim();
        token.meta = open ? { tags: value.split(/\s+/).filter(tag => /^[A-Za-z0-9-]+$/.test(tag)) } : original ? { original: value } : {};
      }
      state.line = line + 1;
      return true;
    }, { alt: ['paragraph'] });
    md.renderer.rules.context_locale = (tokens, index) => {
      const meta = tokens[index].meta;
      if (meta.tags) return '<div data-context-locales="' + meta.tags.join(' ') + '" lang="' + meta.tags[0] + '">\n';
      if (meta.original) return '<p><button type="button" class="context-locale-original">' + md.utils.escapeHtml(meta.original) + '</button></p>\n';
      return '</div>\n';
    };
  }
`;

export const siteThemeScript = String.raw`
import DefaultTheme from 'vitepress/theme-without-fonts';
import { useData, useRoute, dataSymbol, onContentUpdated, getScrollOffset } from 'vitepress';
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
      const copiedCommand = ref('');
      let copyReset;
      // Every reader language ships in the page. The head script marks the
      // active one on <html> before first paint and the stylesheet hides the
      // rest, so server markup never depends on the reader's choice.
      const readers = computed(() => data.theme.value.contextLocales);
      const locale = ref(readers.value.primary);
      const isChinese = tag => String(tag).toLowerCase().startsWith('zh');
      const chinese = computed(() => isChinese(locale.value));
      const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      const both = (zh, en) => zh === en ? zh : readers.value.tags.map(tag => h('span', { 'data-context-locales': tag, lang: tag }, isChinese(tag) ? zh : en));
      const bothHtml = (zh, en) => zh === en ? escape(zh) : readers.value.tags
        .map(tag => '<span data-context-locales="' + tag + '" lang="' + tag + '">' + escape(isChinese(tag) ? zh : en) + '</span>').join('');
      const activeLocale = () => document.documentElement.dataset.contextLocale || readers.value.primary;
      const applyLocale = () => {
        const current = activeLocale();
        // The outline reads headings on content updates; hidden languages must not appear in it.
        document.querySelectorAll('.VPDoc [data-context-locales]').forEach(block => {
          const hidden = !block.dataset.contextLocales.split(' ').includes(current);
          block.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => heading.classList.toggle('ignore-header', hidden));
        });
        const titles = data.frontmatter.value.contextTitles;
        if (titles) document.title = (titles[current] || titles[readers.value.primary]) + ' | ' + (readers.value.titles[current] || data.site.value.title);
      };
      const setLocale = tag => {
        document.documentElement.dataset.contextLocale = tag;
        try { localStorage.setItem(readers.value.preferenceKey, tag); } catch {}
        locale.value = tag;
      };
      const scrollToElement = element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - getScrollOffset() -
        (parseInt(getComputedStyle(element).paddingTop, 10) || 0));
      // Anchors repeat across languages and search results can point into a hidden one.
      const revealHash = (switched = false) => {
        const id = decodeURIComponent(location.hash.slice(1));
        if (!id) return;
        const targets = [...document.querySelectorAll('[id="' + CSS.escape(id) + '"]')];
        const visible = targets.find(element => element.getClientRects().length);
        // The browser already scrolled to the first match unless it was hidden.
        if (visible) { if (switched || visible !== targets[0]) scrollToElement(visible); return; }
        const block = targets[0]?.closest('[data-context-locales]');
        if (!block) return;
        setLocale(block.dataset.contextLocales.split(' ')[0]);
        nextTick(() => requestAnimationFrame(() => revealHash(true)));
      };
      onContentUpdated(() => { applyLocale(); setTimeout(() => revealHash()); });
      const onHashChange = () => revealHash();
      const switchToOriginal = event => { if (event.target.closest?.('.context-locale-original')) setLocale(readers.value.primary); };
      onMounted(() => {
        locale.value = activeLocale();
        window.addEventListener('hashchange', onHashChange);
        document.addEventListener('click', switchToOriginal);
      });
      onUnmounted(() => {
        window.removeEventListener('hashchange', onHashChange);
        document.removeEventListener('click', switchToOriginal);
      });
      watch(locale, () => nextTick(applyLocale));
      const toolIcons = {
        sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
        moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>',
        github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>',
        search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
      };
      const shortLabel = tag => isChinese(tag) ? '中文' : String(tag).split('-')[0].toUpperCase();
      const toggleTheme = () => {
        const apply = async () => { data.isDark.value = !data.isDark.value; await nextTick(); };
        if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply);
        else apply();
      };
      // VitePress keeps the search dialog and its Cmd/Ctrl+K shortcut; its own button stays hidden.
      const openSearch = () => document.querySelector('.VPNavBarSearch .DocSearch-Button')?.click();
      const socialIcon = icon => icon === 'github' ? h('span', { innerHTML: toolIcons.github })
        : typeof icon === 'object' ? h('span', { innerHTML: icon.svg }) : h('span', { class: 'vpi-social-' + icon });
      // One toolbar in every width replaces VitePress's appearance switch, social links and overflow menu.
      const tools = () => {
        const tags = readers.value.tags;
        const next = tag => tags[(tags.indexOf(tag) + 1) % tags.length];
        const label = readers.value.labels[next(locale.value)];
        const themeLabel = chinese.value ? '切换主题' : 'Toggle theme';
        const searchLabel = chinese.value ? '搜索' : 'Search';
        return h('div', { class: 'context-tools' }, [
          ...(data.theme.value.search ? [
            h('span', { class: 'context-shortcut', 'aria-hidden': 'true' }, [
              h('kbd', { class: 'context-kbd-meta' }, '⌘'), h('kbd', { class: 'context-kbd-ctrl' }, 'Ctrl'), h('kbd', null, 'K')]),
            h('button', { class: 'context-tool context-tool-icon', type: 'button', title: searchLabel, 'aria-label': searchLabel,
              'aria-keyshortcuts': 'Meta+K Control+K', onClick: openSearch }, h('span', { innerHTML: toolIcons.search })),
          ] : []),
          h('button', { class: 'context-tool context-tool-icon', type: 'button', title: themeLabel, 'aria-label': themeLabel, onClick: toggleTheme }, [
            h('span', { class: 'context-tool-sun', innerHTML: toolIcons.sun }), h('span', { class: 'context-tool-moon', innerHTML: toolIcons.moon })]),
          ...(data.theme.value.socialLinks || []).map(link => h('a', { class: 'context-tool context-tool-icon', href: link.link,
            target: '_blank', rel: 'noopener', title: link.ariaLabel || String(link.icon), 'aria-label': link.ariaLabel || String(link.icon) }, socialIcon(link.icon))),
          h('button', { class: 'context-tool context-language', type: 'button', title: label, 'aria-label': label,
            onClick: () => setLocale(next(activeLocale())) },
            tags.map(tag => h('span', { 'data-context-locales': tag, lang: next(tag) }, shortLabel(next(tag))))),
        ]);
      };
      const navLink = item => ({ text: item.text,
        ...(item.origin ? { link: mounted.value ? window.location.origin + item.link : item.link, target: '_self', noIcon: true } : { link: item.link }) });
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
          h('p', { class: 'context-home-kicker' }, 'KNOWLEDGE MAP'),
          h('h2', { id: 'context-home-map-title' }, both('网站地图', 'Site map')),
          h('p', both('从主题进入知识，也可以继续查看栏目中的具体页面。', 'Start with a topic, then continue to the pages within each section.')),
        ]),
        h('div', { class: 'context-home-map-grid' }, sections.value.map((section, index) => {
          const pages = links(section.items || []);
          return h('article', { class: 'context-home-map-card', style: { '--context-home-delay': (index * 35) + 'ms' } }, [
            h('div', { class: 'context-home-map-card-heading' }, [
              h('h3', h('a', { href: href(section.href), innerHTML: section.label })),
              h('span', both(section.pages.length + ' 页', section.pages.length + ' pages')),
            ]),
            pages.length ? h('ul', pages.slice(0, 6).map(page => h('li',
              h('a', { href: href(page.link), innerHTML: page.text })))) : null,
            pages.length > 6 ? h('a', { class: 'context-home-map-more', href: href(section.href) },
              both('查看全部 ' + pages.length + ' 页 →', 'View all ' + pages.length + ' pages →')) : null,
          ]);
        })),
      ]);
      const resourceGrid = (items, tag) => h('div', { class: 'context-home-resource-grid',
        ...(tag ? { 'data-context-locales': tag, lang: tag } : {}) }, [...items, ...[
        { title: 'LLM Docs', description: both('面向 Agent 和模型的结构化知识入口。', 'Structured knowledge entry points for agents and models.'),
          href: '/llms/index.html', action: both('打开文档', 'Open docs') },
        { title: 'Changelog', description: both('查看知识内容的版本变化与更新时间。', 'Review knowledge versions and update history.'),
          href: '/changelog.html', action: both('查看更新', 'View updates') },
      ]].map((item, index) => h('article', {
        class: 'context-home-resource-card', style: { '--context-home-delay': (index * 35) + 'ms' },
      }, [
        h('div', { class: 'context-home-resource-heading' }, [
          h('h3', item.title),
          h('div', { class: 'context-home-resource-actions' }, [
            item.command ? h('button', { class: 'context-home-install-action', type: 'button',
              title: (chinese.value ? '复制安装命令：' : 'Copy install command: ') + item.command,
              onClick: () => copyCommand(item.command) }, copiedCommand.value === item.command
                ? both('已复制', 'Copied') : both('安装', 'Install')) : null,
            item.href ? h('a', { class: 'context-home-resource-action', href: href(item.href), ...(external(item.href)
              ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, item.action || both('访问', 'Open')) : null,
          ]),
        ]),
        item.description ? h('p', item.description) : null,
      ])));
      const resources = () => h('section', { class: 'context-home-section context-home-resources', 'aria-labelledby': 'context-home-resources-title' }, [
        h('div', { class: 'context-home-section-heading' }, [
          h('p', { class: 'context-home-kicker' }, 'RESOURCES'),
          h('h2', { id: 'context-home-resources-title' }, both('工具与资源', 'Tools and resources')),
        ]),
        ...(home.value.localeResources ? Object.entries(home.value.localeResources).map(([tag, items]) => resourceGrid(items, tag))
          : [resourceGrid(home.value.resources || [])]),
      ]);
      const poweredBy = () => home.value.branding ? h('footer', { class: 'context-home-powered' }, [
        home.value.branding.label + ' ',
        h('a', { href: home.value.branding.href, target: '_blank', rel: 'noopener noreferrer' }, home.value.branding.name),
      ]) : null;
      const history = computed(() => data.frontmatter.value.contextHistory
        ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data.frontmatter.value.contextHistory), char => char.charCodeAt(0)))) : null);
      // Pages prerender in the light theme and hydration keeps that markup, so site
      // components that read isDark are mounted again for readers starting dark.
      const startedDark = ref(false);
      const custom = name => extensions[name]({ key: startedDark.value ? 'client' : 'prerender' });
      onMounted(() => { mounted.value = true; startedDark.value = data.isDark.value; });
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
      // Descendants, including site extensions, read the reader language as lang.
      // The frontmatter carries it too so the content refreshes its outline on a switch.
      provide(dataSymbol, { ...data, lang: computed(() => locale.value), frontmatter: computed(() => {
        const value = data.frontmatter.value;
        const actions = value.hero && value.contextHeroActions?.[locale.value];
        return { ...value, contextLocale: locale.value, ...(actions ? { hero: { ...value.hero, actions } } : {}) };
      }), theme: computed(() => ({ ...data.theme.value,
        ...data.theme.value.contextUiLabels?.[chinese.value ? 'zh' : 'en'],
        sidebar: inLlms.value || inHistory.value ? [] : active.value?.items || [],
        nav: [...sections.value.map(section => ({ text: section.label, link: section.href,
          activeMatch: !inLlms.value && !inHistory.value && section.key === selected.value ? '^' : '(?!)' })),
          ...(data.theme.value.contextNav || []).map(navLink),
          { text: bothHtml('更多', 'More'), items: [
            ...(data.theme.value.contextMore || []).map(navLink),
            { text: 'LLM Docs', link: '/llms/index.html' },
            { text: 'Changelog', link: '/changelog.html' }],
            activeMatch: inLlms.value || inHistory.value ? '^' : '(?!)' }],
      })) });
      const slots = {
        'nav-bar-title-before': () => extensions.brand ? h('span', { class: 'context-brand' }, custom('brand')) : null,
        'home-hero-before': () => extensions.banner ? custom('banner') : null,
        'layout-bottom': () => extensions.floating ? h('div', { class: 'context-business-floating' }, extensions.floating()) : null,
        'nav-bar-content-after': tools,
        'home-features-before': () => [
          extensions.knowledge === undefined ? siteMap() : extensions.knowledge && custom('knowledge'),
          extensions.resources === undefined ? resources() : extensions.resources && custom('resources')],
        'home-features-after': () => extensions.footer === undefined ? poweredBy() : extensions.footer && custom('footer'),
        'doc-after': () => history.value ? h('section', { class: 'context-history-cards' },
          history.value.length ? history.value.map((entry, index) =>
            h('details', { class: 'context-history-card', open: index < 3, key: entry.version }, [
              h('summary', [h('strong', entry.version), h('span', { class: 'context-history-title' }, entry.title),
                h('span', { class: 'context-history-attribution' }, [
                  entry.actor ? entry.actor.name + ' ' : '', both('更新于 ', 'updated on '),
                  h('time', { datetime: entry.date }, entry.date.slice(0, 10)),
                ])]),
              h('div', { class: 'context-history-body' }, [
                h('ul', entry.changes.map(change => h('li', change))),
                h('div', { class: 'context-history-meta' }, [
                  h('strong', both('触发来源', 'Triggered by')),
                  h('ul', entry.triggers.map(trigger => h('li', trigger.kind + ': ' + trigger.description))),
                ]),
              ]),
            ])) : [h('p', both('暂无版本记录。', 'No versions recorded yet.'))]) : null,
        'sidebar-nav-before': () => h('div', { class: 'context-mobile-directory' }, [
          h('div', { class: 'context-mobile-directory-heading' }, [
            h('span', both('文章目录', 'Articles')),
            h('button', { type: 'button', 'aria-label': chinese.value ? '关闭目录' : 'Close navigation',
              onClick: () => document.querySelector('.VPBackdrop')?.click() }, '×'),
          ]),
          h('div', { class: 'context-mobile-sections' }, sections.value.map(section => h('a', {
            href: data.site.value.base + section.href.slice(1),
            class: section.key === selected.value ? 'active' : undefined, innerHTML: section.label,
          }))),
        ]),
        'doc-footer-before': () => {
          const sources = data.frontmatter.value.contextSources || [];
          return h('div', { class: 'context-provenance' }, [
            sources.length ? h('section', { class: 'context-sources' }, [
              h('div', { class: 'context-sources-header' }, [
                h('div', { class: 'context-sources-title' }, both('来源与溯源', 'Sources')),
              ]),
              h('ul', (allSources.value ? sources : sources.slice(0, 10)).map(source => h('li', source.href
                ? h('a', { href: source.href, target: '_blank', rel: 'noopener noreferrer' }, source.label)
                : source.label))),
              sources.length > 10 && !allSources.value ? h('button', { type: 'button', class: 'context-sources-more',
                onClick: () => { allSources.value = true; } }, both('查看更多', 'Show more')) : null,
            ]) : null,
            (data.frontmatter.value.contextUpdated || data.theme.value.contextUpdated)
              ? h('div', { class: 'context-article-updated' }, [
                  both('最后更新：', 'Last updated: '),
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
  --vp-nav-height: 60px;
  /* One centred container for the top bar, home sections and the article layout. */
  --context-layout: 1440px;
  --context-gutter: 32px;
  /* Distance from a full-width box's edge to the container; percentages resolve against that box. */
  --context-edge: max(var(--context-gutter), calc((100% - var(--context-layout)) / 2 + var(--context-gutter)));
  --context-content: min(calc(100% - 2 * var(--context-gutter)), calc(var(--context-layout) - 2 * var(--context-gutter)));
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
.VPNavBar .wrapper { padding: 0 var(--context-edge) !important; }
.VPNavBar .container { max-width: none !important; position: relative; }
.VPNav, .VPNavBar, .VPNavBar .wrapper { background: var(--vp-c-bg) !important; }
.VPNavBar .title { position: static !important; padding: 0 !important; width: auto !important; flex-shrink: 0; }
.VPNavBarTitle .title { gap: 10px; font-size: 15px; font-weight: 600; letter-spacing: -.01em; border: 0 !important; }
.context-brand { display: inline-flex; align-items: center; gap: 10px; }
/* One full-width rule in the divider color; VitePress starts it after its own sidebar width. */
.VPNavBar .divider { padding-left: 0 !important; }
.VPNavBar .divider-line { background-color: var(--vp-c-divider) !important; }
.VPNavBar .content { flex: 1; min-width: 0; padding-left: 0 !important; padding-right: 0 !important; }
.VPNavBar .content-body { background: var(--vp-c-bg) !important; gap: 4px; justify-content: flex-end; }
/* Centered in the top bar, as on the Source Graph header. VitePress positions these
   wrappers once scrolled or beside a sidebar, which would shift the menu. */
.VPNavBar .content, .VPNavBar .content-body { position: static !important; }
.VPNavBarMenu { position: absolute; top: 0; left: 50%; transform: translateX(-50%); }
.VPNavBar .appearance, .VPNavBar .social-links, .VPNavBarExtra, .VPNavScreen .appearance, .VPNavScreen .social-links { display: none !important; }
.context-tools { display: flex; align-items: center; gap: 4px; }
.context-tool { display: inline-grid; place-items: center; height: 32px; min-width: 32px; padding: 0 10px; border: 0; border-radius: 8px;
  background: transparent; color: var(--vp-c-text-2); white-space: nowrap; font-size: 13px; font-weight: 400; cursor: pointer; transition: color .2s, background-color .2s; }
.context-tool:hover { color: var(--vp-c-text-1); background: color-mix(in srgb, var(--vp-c-text-1) 4%, transparent); }
.context-tool-icon { padding: 0; }
.context-tool svg { display: block; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.context-tool [class^="vpi-social-"] { width: 16px; height: 16px; }
.context-tool-sun, .dark .context-tool-moon { display: none; }
.dark .context-tool-sun { display: block; }
.vp-doc .context-locale-original { padding: 0; border: 0; color: var(--vp-c-brand-1); font-weight: 500; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.VPNavBarMenuLink { font-size: 13px !important; font-weight: 550 !important; padding: 0 16px !important; }
.VPNavBarMenuGroup .button { padding: 0 16px !important; }
.VPNavBarMenuLink.active { box-shadow: inset 0 -2px var(--vp-c-brand-1); }
.VPNavBarSearch { display: none !important; }
.context-shortcut { display: inline-flex; gap: 3px; margin-right: -2px; pointer-events: none; user-select: none;
  font: 12px/1 var(--vp-font-family-base); color: color-mix(in srgb, var(--vp-c-text-3) 70%, transparent); }
.context-shortcut kbd { font: inherit; }
.context-kbd-meta, .mac .context-kbd-ctrl { display: none; }
.mac .context-kbd-meta { display: inline-block; }
.VPLocalSearchBox { --vp-local-search-bg: var(--vp-c-bg); --vp-local-search-result-bg: var(--vp-c-bg); --vp-local-search-result-border: transparent;
  --vp-local-search-result-selected-bg: color-mix(in srgb, var(--vp-c-brand-1) 7%, var(--vp-c-bg)); --vp-local-search-result-selected-border: transparent; }
.VPLocalSearchBox .backdrop { background: rgba(15, 17, 21, .18) !important; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.dark .VPLocalSearchBox .backdrop { background: rgba(0, 0, 0, .45) !important; }
.VPLocalSearchBox .shell { padding: 0 !important; gap: 0 !important; overflow: hidden; }
.VPLocalSearchBox .search-bar { height: 52px; padding: 0 10px 0 16px !important; border: 0 !important; border-radius: 0 !important; }
.VPLocalSearchBox .results, .VPLocalSearchBox .no-results { border-top: 1px solid var(--vp-c-divider); }
.VPLocalSearchBox .search-icon { margin: 0 !important; font-size: 16px !important; color: var(--vp-c-text-3); }
.VPLocalSearchBox .search-input { height: 100%; padding: 0 12px !important; font-size: 15px !important; }
.VPLocalSearchBox .search-input::-webkit-search-cancel-button { display: none; }
.VPLocalSearchBox .search-actions button { padding: 6px !important; border-radius: 6px; color: var(--vp-c-text-3); }
.VPLocalSearchBox .search-actions button .local-search-icon { font-size: 16px; }
.VPLocalSearchBox .search-actions button:not([disabled]):hover, .VPLocalSearchBox .toggle-layout-button.detailed-list { color: var(--vp-c-text-1) !important;
  background: color-mix(in srgb, var(--vp-c-text-1) 5%, transparent); }
.VPLocalSearchBox .results { padding: 8px !important; gap: 2px !important; }
.VPLocalSearchBox .results:empty { display: none; }
.VPLocalSearchBox .result { border: 0 !important; border-radius: 8px !important; background: var(--vp-local-search-result-bg); }
.VPLocalSearchBox .result > div { margin: 10px 12px !important; }
.VPLocalSearchBox .title-icon { color: var(--vp-c-text-3) !important; opacity: 1 !important; }
.VPLocalSearchBox .no-results { padding: 36px 16px !important; color: var(--vp-c-text-2); font-size: 14px; text-align: center; }
.VPLocalSearchBox .search-keyboard-shortcuts { padding: 10px 16px; border-top: 1px solid var(--vp-c-divider); gap: 16px !important; font-size: 12px !important;
  opacity: 1 !important; color: var(--vp-c-text-3); }
.VPLocalSearchBox .search-keyboard-shortcuts kbd { min-width: 20px !important; padding: 1px 5px !important; border: 1px solid var(--vp-c-divider) !important;
  border-radius: 5px !important; background: transparent !important; box-shadow: none !important; }
@media (min-width: 768px) {
  .VPLocalSearchBox .shell { width: min(100vw - 48px, 640px) !important; margin: 12vh auto auto !important; max-height: min(76vh, 640px) !important;
    border: 1px solid var(--vp-c-divider); border-radius: 12px !important; box-shadow: 0 24px 64px rgba(15, 17, 21, .16), 0 2px 8px rgba(15, 17, 21, .06); }
}
@media (max-width: 959px) { .context-shortcut { display: none; } }
.VPSidebar { border-right: 1px solid var(--vp-c-divider); scrollbar-width: thin; }
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
${readerContentStyles(".vp-doc")}
.context-home { max-width: 100%; min-width: 0; overflow-x: clip; }
.context-home .VPContent, .context-home .VPHome, .context-home .VPHero { max-width: 100%; min-width: 0; }
.context-home .VPHome { padding-bottom: 0; }
.context-home .VPHero { position: relative; padding: 132px 0 62px; }
.context-home .VPHero::before { content: ''; position: absolute; top: -1px; right: 0; bottom: 0; left: 0; pointer-events: none;
  background: linear-gradient(to bottom, transparent 58%, var(--vp-c-bg) 100%),
    radial-gradient(ellipse 58% 145% at 8% 18%, rgba(37,99,235,.16), transparent 72%),
    radial-gradient(ellipse 58% 150% at 68% 24%, rgba(0,190,200,.11), transparent 72%),
    linear-gradient(90deg, rgba(37,99,235,.045), rgba(0,190,200,.025) 68%, transparent); }
.context-home .VPHero .container { position: relative; box-sizing: border-box; width: var(--context-content); max-width: none; min-width: 0; margin-left: auto; margin-right: auto; }
.context-home .VPHero .main { width: 100%; max-width: 980px; min-width: 0; }
.context-home .VPHero .heading { display: block; width: 100%; min-width: 0; max-width: 100%; }
.context-home .VPHero .name { display: block; width: 100%; max-width: 100%; overflow-wrap: anywhere; white-space: normal; color: transparent;
  background: linear-gradient(112deg, var(--vp-c-brand-1), var(--context-accent)); background-clip: text; -webkit-background-clip: text; }
.context-home .VPHero .text { display: block; width: 100%; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; white-space: normal;
  font-size: clamp(38px, 4.2vw, 60px); line-height: 1.08; letter-spacing: -.045em; }
.context-home .VPHero .tagline { max-width: 820px; font-size: 18px; line-height: 1.75; }
.context-home .VPHero .actions { width: 100%; min-width: 0; padding-top: 38px; flex-wrap: wrap; }
.context-home .VPFeatures { display: none; }
.context-home-section { width: var(--context-content); margin: 0 auto; padding: 36px 0 44px; }
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
.context-home-powered { width: var(--context-content); margin: 24px auto 0; padding: 22px 0 30px; border-top: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2); font-size: 11px; text-align: right; }
.context-home-powered a { color: inherit; }
@keyframes context-home-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@media (min-width: 960px) {
  /* The sidebar background reaches the screen edge; its first-level labels line up with the top-bar title. */
  .VPSidebar { top: var(--vp-nav-height) !important; left: 0 !important; width: calc(var(--vp-sidebar-width) + var(--context-edge) - 26px) !important;
    padding: 12px 0 48px calc(var(--context-edge) - 26px) !important; }
  .VPSidebar .curtain { display: none; }
  .VPContent.has-sidebar, .Layout:not(.context-home) .VPContent:not(.is-home) { padding-left: calc(var(--vp-sidebar-width) + var(--context-edge) - 26px) !important;
    padding-right: calc(var(--context-edge) - var(--context-gutter)) !important; }
  .context-home .VPContent { padding-left: 0 !important; padding-right: 0 !important; }
  .VPDoc { padding: 44px 36px 80px !important; }
  .VPDoc > .container > .content { padding: 0 24px 80px 0 !important; }
}
@media (min-width: 960px) and (max-width: 1279px) {
  .VPNavBar .title { width: auto !important; flex: 1; }
  .VPNavBarMenuLink { padding: 0 9px !important; }
  .context-home .VPHero .main { max-width: 100%; }
  .context-home-resource-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.context-mobile-directory { display: none; }
@media (max-width: 719px) { :root { --context-gutter: 16px; } }
@media (max-width: 959px) {
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
  .VPNavScreen { bottom: auto !important; max-height: calc(100dvh - var(--vp-nav-height)); padding: 0 var(--context-gutter) !important; border-bottom: 1px solid var(--vp-c-divider); box-shadow: 0 12px 24px rgba(0,0,0,.08); }
  .VPNavScreen > .container { max-width: none !important; padding: 8px 0 16px !important; }
  .VPNavScreenMenuLink { padding: 9px 0 !important; font-size: 13px !important; }

  .VPNavBar .title { width: auto !important; }
  .vp-doc h1 { font-size: 28px; }
  .vp-doc h2 { font-size: 22px; }
  .VPDoc { padding: 32px var(--context-gutter) 64px !important; }
  .vp-doc a.header-anchor { margin-left: -0.8em; }
  .context-home .VPHero { padding-top: 104px; padding-bottom: 66px; }
  .context-home .VPHero .text { font-size: 40px; }
  .context-home .VPHero .tagline { font-size: 16px; }
  .context-home-resource-grid { grid-template-columns: 1fr; }
}
@media (max-width: 1279px) {
  .VPNavBarMenu { display: none !important; }
  .VPNavBarHamburger { display: flex !important; }
  .VPNavScreen { display: block !important; }
  .VPNavScreen { bottom: auto !important; max-height: calc(100dvh - var(--vp-nav-height)); overflow-y: auto; }
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
