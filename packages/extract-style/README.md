# @c4a/extract-style

Lightweight CSS and SCSS evidence adapter for Context. It uses PostCSS and the `postcss-scss` syntax to parse caller-registered text without compiling Sass or fetching imports.

The catalog covers CSS `@import`, Sass `@use`/`@forward`, custom properties, static Sass variables, token references, selectors, syntactic variant/state evidence, and component-link candidates. Declaration values and external import URLs are represented by digest rather than raw text. Dynamic selectors or import sources make a file unsupported; unresolved relative imports remain explicit warnings.

All emitted facts use `lightweight-evidence` and denominator `none`. The package does not create selector knowledge pages, infer visual behavior, or increase eligible-file, LOC, symbol, or protocol coverage.
