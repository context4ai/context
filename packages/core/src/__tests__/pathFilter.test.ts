import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PATH_FILTER,
  PathFilterConfigSchema,
  resolvePathFilter,
} from "../types/pathFilter.js";
import {
  globToRegex,
  createPathMatcher,
  matchesPathFilter,
} from "../utils/glob.js";

describe("globToRegex (picomatch)", () => {
  test("matches simple wildcard", () => {
    const re = globToRegex("*.ts");
    expect(re.test("foo.ts")).toBe(true);
    expect(re.test("foo.js")).toBe(false);
    expect(re.test("dir/foo.ts")).toBe(false); // no globstar
  });

  test("matches globstar", () => {
    const re = globToRegex("**/*.ts");
    expect(re.test("foo.ts")).toBe(true);
    expect(re.test("src/foo.ts")).toBe(true);
    expect(re.test("src/deep/foo.ts")).toBe(true);
    expect(re.test("src/foo.js")).toBe(false);
  });

  test("supports brace expansion", () => {
    const re = globToRegex("**/*.{ts,tsx}");
    expect(re.test("foo.ts")).toBe(true);
    expect(re.test("foo.tsx")).toBe(true);
    expect(re.test("foo.js")).toBe(false);
  });

  test("supports ? single char", () => {
    const re = globToRegex("?.ts");
    expect(re.test("a.ts")).toBe(true);
    expect(re.test("ab.ts")).toBe(false);
  });

  test("supports [abc] character class", () => {
    const re = globToRegex("file.[abc]");
    expect(re.test("file.a")).toBe(true);
    expect(re.test("file.d")).toBe(false);
  });
});

describe("createPathMatcher", () => {
  test("empty include matches nothing", () => {
    const match = createPathMatcher({ include: [], exclude: [] });
    expect(match("anything.ts")).toBe(false);
  });

  test("include without exclude", () => {
    const match = createPathMatcher({
      include: ["**/*.ts"],
      exclude: [],
    });
    expect(match("src/index.ts")).toBe(true);
    expect(match("src/index.js")).toBe(false);
  });

  test("exclude takes precedence over include", () => {
    const match = createPathMatcher({
      include: ["**/*.ts"],
      exclude: ["**/*.test.ts"],
    });
    expect(match("src/index.ts")).toBe(true);
    expect(match("src/index.test.ts")).toBe(false);
  });

  test("brace expansion in include+exclude", () => {
    const match = createPathMatcher({
      include: ["**/*.{ts,tsx}"],
      exclude: ["**/__{tests,mocks}__/**"],
    });
    expect(match("src/App.tsx")).toBe(true);
    expect(match("src/__tests__/App.test.tsx")).toBe(false);
    expect(match("src/__mocks__/api.ts")).toBe(false);
  });
});

describe("matchesPathFilter", () => {
  test("matches code category with default config", () => {
    expect(matchesPathFilter("src/index.ts", "code", DEFAULT_PATH_FILTER)).toBe(true);
    expect(matchesPathFilter("src/index.js", "code", DEFAULT_PATH_FILTER)).toBe(false);
    expect(matchesPathFilter("src/__tests__/foo.ts", "code", DEFAULT_PATH_FILTER)).toBe(false);
    expect(matchesPathFilter("src/foo.test.ts", "code", DEFAULT_PATH_FILTER)).toBe(false);
    expect(matchesPathFilter("src/foo.d.ts", "code", DEFAULT_PATH_FILTER)).toBe(false);
  });

  test("matches doc category with default config", () => {
    expect(matchesPathFilter("README.md", "doc", DEFAULT_PATH_FILTER)).toBe(true);
    expect(matchesPathFilter("docs/guide.md", "doc", DEFAULT_PATH_FILTER)).toBe(true);
    expect(matchesPathFilter("docs/deep/intro.md", "doc", DEFAULT_PATH_FILTER)).toBe(true);
    expect(matchesPathFilter("CHANGELOG.md", "doc", DEFAULT_PATH_FILTER)).toBe(false);
    expect(matchesPathFilter("docs/CHANGELOG.md", "doc", DEFAULT_PATH_FILTER)).toBe(false);
    expect(matchesPathFilter("docs/guide.txt", "doc", DEFAULT_PATH_FILTER)).toBe(false);
    expect(matchesPathFilter("src/utils/notes.md", "doc", DEFAULT_PATH_FILTER)).toBe(false);
    expect(matchesPathFilter("src/index.ts", "doc", DEFAULT_PATH_FILTER)).toBe(false);
  });

  test("matches package category with default config", () => {
    expect(matchesPathFilter("package.json", "package", DEFAULT_PATH_FILTER)).toBe(true);
    expect(matchesPathFilter("packages/api/package.json", "package", DEFAULT_PATH_FILTER)).toBe(true);
    expect(matchesPathFilter("go.mod", "package", DEFAULT_PATH_FILTER)).toBe(true);
    expect(matchesPathFilter("Cargo.toml", "package", DEFAULT_PATH_FILTER)).toBe(true);
    expect(matchesPathFilter("src/index.ts", "package", DEFAULT_PATH_FILTER)).toBe(false);
  });
});

describe("resolvePathFilter", () => {
  test("returns default when metadata is null", () => {
    const { config, isDefault } = resolvePathFilter(null);
    expect(isDefault).toBe(true);
    expect(config).toEqual(DEFAULT_PATH_FILTER);
  });

  test("returns default when metadata has no path_filter", () => {
    const { config, isDefault } = resolvePathFilter({ some_key: "value" });
    expect(isDefault).toBe(true);
    expect(config).toEqual(DEFAULT_PATH_FILTER);
  });

  test("returns custom when metadata has valid path_filter", () => {
    const custom = {
      package: { include: ["**/go.mod"] },
      code: { include: ["**/*.go"], exclude: [] },
      doc: { include: [], exclude: [] },
    };
    const { config, isDefault } = resolvePathFilter({ path_filter: custom });
    expect(isDefault).toBe(false);
    expect(config).toEqual(custom);
  });

  test("returns default when path_filter is invalid", () => {
    const { config, isDefault } = resolvePathFilter({
      path_filter: { code: { include: "not-array" } },
    });
    expect(isDefault).toBe(true);
    expect(config).toEqual(DEFAULT_PATH_FILTER);
  });

  test("fills missing sections with defaults via Zod .default()", () => {
    // Only package section provided, code and doc should get defaults
    const { config, isDefault } = resolvePathFilter({
      path_filter: { package: { include: ["**/pom.xml"] } },
    });
    expect(isDefault).toBe(false);
    expect(config.package.include).toEqual(["**/pom.xml"]);
    expect(config.code.include).toEqual([]); // Zod default for missing code section
    expect(config.doc.include).toEqual([]);
  });
});

describe("PathFilterConfigSchema", () => {
  test("parses valid config", () => {
    const result = PathFilterConfigSchema.safeParse({
      package: { include: ["**/package.json"] },
      code: { include: ["**/*.ts"], exclude: ["**/*.d.ts"] },
      doc: { include: ["**/*.md"], exclude: [] },
    });
    expect(result.success).toBe(true);
  });

  test("applies defaults for missing sections", () => {
    const result = PathFilterConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.package.include).toEqual([]);
      expect(result.data.code.include).toEqual([]);
      expect(result.data.code.exclude).toEqual([]);
      expect(result.data.doc.include).toEqual([]);
      expect(result.data.doc.exclude).toEqual([]);
    }
  });

  test("rejects invalid include type", () => {
    const result = PathFilterConfigSchema.safeParse({
      code: { include: "not-an-array" },
    });
    expect(result.success).toBe(false);
  });
});
