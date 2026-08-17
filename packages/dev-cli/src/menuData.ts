import type { MenuItem } from "@c4a/tui";

export const menuTree: MenuItem[] = [
  { id: "build", label: "build", description: "Build all packages" },
  {
    id: "package",
    label: "package",
    description: "Package management",
    children: [
      { id: "cli:link", label: "link", description: "Link context CLI and SDK for local dogfood" },
      { id: "cli:unlink", label: "unlink", description: "Unlink context CLI and SDK" },
      { id: "bump-version", label: "bump", description: "Batch bump version" },
      { id: "publish", label: "publish", description: "One-click publish" },
    ],
  },
  {
    id: "test",
    label: "test",
    description: "Test & verification",
    children: [
      { id: "verify:fast", label: "verify:fast", description: "typecheck + lint + test" },
      { id: "verify", label: "verify", description: "verify:fast + E2E" },
      { id: "verify:full", label: "verify:full", description: "Full verification" },
    ],
  },
  { id: "__quit__", label: "exit", description: "Exit CLI" },
];

export const helpDescriptions: Record<string, string> = {
  build: "Build all workspace packages: bun run build.",
  package: "Press -> to expand submenu. CLI 链接管理、版本管理和发布。",
  "cli:link": "Build and link @c4a/context-cli (context) to global PATH, and register @c4a/context for context init --dev.",
  "cli:unlink": "Unlink global context command and unregister @c4a/context from Bun link. It only removes links and does not reinstall any published version.",
  "bump-version": "Batch update version in root and all workspace package.json files. Usage: bump <version>.",
  publish: "One-click publish: bump version -> build -> npm publish for context SDK, core, extract packages, and context CLI.",
  test: "Press -> to expand submenu. 测试与验收。",
  "verify:fast": "快速验证: typecheck + lint + unit test",
  verify: "标准验证: verify:fast",
  "verify:full": "全量验证: verify:fast",
  __quit__: "Exit the developer CLI.",
};
