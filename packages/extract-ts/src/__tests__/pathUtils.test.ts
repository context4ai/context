import { describe, expect, test } from "bun:test";
import { resolveEntrySourcePath, resolveImportSourcePath } from "../pathUtils.js";
import type { FileSystem } from "@c4a/extract";

/** Create a mock FileSystem where only the specified paths exist (as files). */
function mockFs(existingFiles: string[]): FileSystem {
  const fileSet = new Set(existingFiles);
  return {
    async exists(path) { return fileSet.has(path); },
    async readFile() { return ""; },
    async readJson() { return {} as never; },
    async readdir() { return []; },
  };
}

describe("resolveEntrySourcePath", () => {
  describe("dist/<format>/path → src/path mapping", () => {
    test("dist/es/index.jsx → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "./dist/es/index.jsx", fs)).toBe("src/index.ts");
    });

    test("dist/esm/index.js → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "dist/esm/index.js", fs)).toBe("src/index.ts");
    });

    test("dist/types/index.d.ts → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "dist/types/index.d.ts", fs)).toBe("src/index.ts");
    });

    test("dist/cjs/index.js → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "dist/cjs/index.js", fs)).toBe("src/index.ts");
    });

    test("dist/umd/index.js → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "dist/umd/index.js", fs)).toBe("src/index.ts");
    });

    test("dist/web/index.cjs → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "./dist/web/index.cjs", fs)).toBe("src/index.ts");
    });

    test("dist/node/utils.js → src/utils.ts", async () => {
      const fs = mockFs(["src/utils.ts"]);
      expect(await resolveEntrySourcePath("", "dist/node/utils.js", fs)).toBe("src/utils.ts");
    });
  });

  describe("dist/path (no format dir) → src/path", () => {
    test("dist/index.js → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "dist/index.js", fs)).toBe("src/index.ts");
    });

    test("dist/index.ts → src/index.ts (source in dist)", async () => {
      const fs = mockFs(["dist/index.ts"]);
      expect(await resolveEntrySourcePath("", "dist/index.ts", fs)).toBe("dist/index.ts");
    });
  });

  describe("lib/ as build output root", () => {
    test("lib/index.js → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "lib/index.js", fs)).toBe("src/index.ts");
    });
  });

  describe("build/ as build output root", () => {
    test("build/esm/index.mjs → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "build/esm/index.mjs", fs)).toBe("src/index.ts");
    });
  });

  describe("nested path under format dir", () => {
    test("dist/es/components/Button.jsx → src/components/Button.tsx", async () => {
      const fs = mockFs(["src/components/Button.tsx"]);
      expect(await resolveEntrySourcePath("", "dist/es/components/Button.jsx", fs)).toBe("src/components/Button.tsx");
    });

    test("dist/deprecated/index.esm.js → src/deprecated/index.ts", async () => {
      const fs = mockFs(["src/deprecated/index.ts"]);
      expect(await resolveEntrySourcePath("", "dist/deprecated/index.esm.js", fs)).toBe("src/deprecated/index.ts");
    });
  });

  describe("src/index fallback", () => {
    test("falls back to src/index.ts when nothing else matches", async () => {
      const fs = mockFs(["src/index.ts"]);
      // A completely unknown output path — only the fallback should work
      expect(await resolveEntrySourcePath("", "release/bundle/main.min.js", fs)).toBe("src/index.ts");
    });

    test("falls back to src/index.tsx", async () => {
      const fs = mockFs(["src/index.tsx"]);
      expect(await resolveEntrySourcePath("", "release/bundle/main.min.js", fs)).toBe("src/index.tsx");
    });

    test("returns null when no source file exists at all", async () => {
      const fs = mockFs([]);
      expect(await resolveEntrySourcePath("", "dist/es/index.jsx", fs)).toBeNull();
    });

    test("does not fall back to src/index for non-code assets", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "dist/esm/styles.css", fs)).toBeNull();
      expect(await resolveEntrySourcePath("", "dist/esm/styles.css?type=global", fs)).toBeNull();
    });

    test("can disable src/index fallback for non-root export targets", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "dist/tools/generated.js", fs, { allowIndexFallback: false })).toBeNull();
    });
  });

  describe("with packageDir prefix", () => {
    test("resolves relative to packageDir", async () => {
      const fs = mockFs(["packages/core/src/index.ts"]);
      expect(await resolveEntrySourcePath("packages/core", "dist/es/index.js", fs)).toBe("packages/core/src/index.ts");
    });
  });

  describe("direct src reference", () => {
    test("src/index.js → src/index.ts", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "src/index.js", fs)).toBe("src/index.ts");
    });

    test("src/index.ts resolves directly", async () => {
      const fs = mockFs(["src/index.ts"]);
      expect(await resolveEntrySourcePath("", "src/index.ts", fs)).toBe("src/index.ts");
    });
  });
});

describe("resolveImportSourcePath", () => {
  test("resolves relative import with extension swap", async () => {
    const fs = mockFs(["src/utils.ts"]);
    expect(await resolveImportSourcePath("src/index.ts", "./utils", fs)).toBe("src/utils.ts");
  });

  test("resolves relative import to index file", async () => {
    const fs = mockFs(["src/components/index.ts"]);
    expect(await resolveImportSourcePath("src/index.ts", "./components", fs)).toBe("src/components/index.ts");
  });

  test("resolves .tsx extension", async () => {
    const fs = mockFs(["src/components/Button.tsx"]);
    expect(await resolveImportSourcePath("src/index.ts", "./components/Button", fs)).toBe("src/components/Button.tsx");
  });

  test("ignores non-relative specifiers", async () => {
    const fs = mockFs(["node_modules/react/index.ts"]);
    expect(await resolveImportSourcePath("src/index.ts", "react", fs)).toBeNull();
  });

  test("does not match directories (EISDIR prevention)", async () => {
    // "src/components" exists as a directory (not in file set),
    // but "src/components/index.ts" exists as a file
    const fs = mockFs(["src/components/index.ts"]);
    const result = await resolveImportSourcePath("src/index.ts", "./components", fs);
    expect(result).toBe("src/components/index.ts");
  });
});
