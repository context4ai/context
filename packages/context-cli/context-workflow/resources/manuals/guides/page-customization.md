---
id: context.sdk.page-customization
kind: procedure
mediaType: text/markdown
---

# Page content customization

Keep trusted website code in `src/site/`. It is presentation code, not captured
material or approved knowledge. Configure it in the existing `kbPackage.site`:

```ts
site: {
  title: "Engineering handbook",
  extensions: {
    root: "src/site",
    slots: {
      banner: "components/Banner.vue",
      floating: "components/Chat.vue",
    },
    pages: { support: "pages/support.md" },
  },
}
```

Paths are relative to `root`. The directory can contain Vue components, CSS,
Markdown and imported assets. Use relative imports within this directory;
declare external dependencies in the workspace package manifest. Do not put
credentials or private configuration in frontend files. Hidden files,
`node_modules` and `dist` are not copied; symlinks are rejected.

## Homepage and floating slots

| Slot | Default | Customization |
| --- | --- | --- |
| `banner` | Existing homepage hero and actions | Replace with a component |
| `knowledge` | Knowledge-map card group | Replace with a component |
| `resources` | Resource card group | Replace with a component |
| `footer` | Existing homepage footer | Replace with a component |
| `floating` | Empty | Client-only component fixed at the bottom right on all pages |

Omit a slot to retain its default; set it to `false` to hide it. A component
replaces only its slot, not the global navigation, language switch or article
provenance. Components can use VitePress `useData()` and `useRoute()` for theme,
page and route information. Import scoped CSS from components for local styling.

The floating component owns its button, chat/bot panel and open/close behavior.
Keep its panel within the viewport and preserve keyboard focus and close controls.
Load expensive chat SDKs when opened. Its component import is client-only, but
other components must support static rendering: use `onMounted` for browser APIs.
The static website supplies no chat backend or secret storage; use an authorized
business service for authentication and requests. A service failure must not
prevent reading the handbook.

## Custom pages and navigation

Each `pages` key becomes `/custom/<key>.html` under the configured site base.
A page is trusted Markdown and may import Vue components, for example:

```md
# Support

<script setup>
import SupportPanel from '../components/SupportPanel.vue'
</script>

<SupportPanel />
```

Place it using the existing knowledge-map entry structure, with
`target: { artifact_ref: "site:support" }`. Set `parent`, `title` and `order`
as for other directory entries; do not create a second menu configuration.
The `site:` namespace is reserved for website pages; do not use `section_key`
on these targets. Undeclared targets fail website building with a diagnostic.
Pages without directory entries remain directly accessible. Multiple entries
can reference one page without duplicating content.

These pages are website-only: they are not approved articles and do not enter
the knowledge package or LLM Docs. Update formal articles through the existing
knowledge revision workflow, not through a custom page that shadows their URLs.

## Build and delivery

Use the existing package build after editing configuration or presentation files;
site customization does not require capture, Indexer planning or a new review
gate. Existing authorization for building and deployment still applies.
Extension files and workspace dependency manifests participate in build
fingerprints. Build errors preserve previous outputs. Never edit the generated
`.tmp` website or `dist` as the source of customization.

Preview the homepage, custom pages and floating panel on desktop and mobile,
including a non-root `site.base`, dark mode and keyboard navigation. Publish only
the resulting website directory, not the source tree or workspace credentials.
