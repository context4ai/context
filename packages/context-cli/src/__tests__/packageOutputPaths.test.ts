import { expect, test } from "bun:test";
import { kbPackage, llmsPackage } from "@c4a/context";
import { packageSiteOutputDir, assertDistinctPackageOutputs } from "../project/packageOutputPaths.js";

test("site output is a sibling and strips only one trailing kb suffix", () => {
  for (const [name, expected] of [["guide-kb", "guide-site"], ["guide", "guide-site"], ["kb-guide-kb", "kb-guide-site"]]) {
    expect(packageSiteOutputDir({ name: name!, outDir: `dist/${name}` })).toBe(`dist/${expected}`);
    expect(packageSiteOutputDir({ name: name!, outDir: `.tmp/stage/${name}` })).toBe(`.tmp/stage/${expected}`);
  }
});

test("website paths cannot overwrite another package or another website", () => {
  const kb = (name: string) => kbPackage({ name, site: {}, template: "templates/kb" });
  expect(() => assertDistinctPackageOutputs([kb("guide-kb"), kb("guide")])).toThrow("collision");
  expect(() => assertDistinctPackageOutputs([kb("guide-kb"), llmsPackage({ name: "guide-site", template: "templates/llms" })])).toThrow("collision");
  expect(() => assertDistinctPackageOutputs([kb("guide-kb"), kb("other-kb")])).not.toThrow();
});
