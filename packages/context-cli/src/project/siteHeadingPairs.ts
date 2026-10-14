/** Included in the generated markdown-it configuration. */
export const siteHeadingPairingRule = String.raw`
    // Pair headings by stable section and structural ordinal, never by a
    // translated slug. Tokens are the renderer's actual parsed headings.
    md.core.ruler.push('context_heading_pairs', state => {
      const groups = new Map();
      let locale = null;
      let section = null;
      for (const token of state.tokens) {
        if (token.type === 'context_locale') {
          if (token.meta.tags) { locale = token.meta.tags.join(' '); section = null; }
          else if (!token.meta.original) { locale = null; section = null; }
        }
        if (locale && token.type === 'context_anchor') {
          section = token.content;
          if (!groups.has(section)) groups.set(section, new Map());
          groups.get(section).set(locale, []);
        }
        if (locale && section && token.type === 'heading_open') groups.get(section).get(locale).push(token);
      }
      for (const [key, languages] of groups) {
        const headings = [...languages.values()];
        if (headings.length < 2) continue;
        const shape = headings[0].map(token => token.tag).join(',');
        if (headings.some(list => list.map(token => token.tag).join(',') !== shape)) continue;
        headings.forEach(list => list.forEach((token, index) => token.attrSet('data-context-heading', key + '/' + (index + 1))));
      }
    });
`;
