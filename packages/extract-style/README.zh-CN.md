# @c4a/extract-style

面向 Context 的 CSS/SCSS 轻量 evidence adapter。它使用 PostCSS 与 `postcss-scss` syntax，只解析调用方登记的文本，不编译 Sass，也不拉取 import。

catalog 覆盖 CSS `@import`、Sass `@use`/`@forward`、custom property、静态 Sass 变量、token reference、selector、语法层 variant/state evidence 和组件关联候选。声明值与外部 import URL 只保存 digest，不保存原文。动态 selector 或 import source 会使文件成为 `unsupported`；未登记的相对 import 作为显式 warning 保留。

全部 facts 使用 `lightweight-evidence` 且 denominator 固定为 `none`。该包不生成 selector 知识页、不推断视觉行为，也不增加 eligible-file、LOC、symbol 或 protocol 覆盖率。
