import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createDeliveryLinkProjection, deliveryLinkDigest } from "../project/indexerDeliveryLinks.js";

test("deferred knowledge links restore from the original prose without rewriting code or external links", async () => {
  const temp = join(import.meta.dir, "../../../../.tmp");
  await mkdir(temp, { recursive: true });
  const root = await mkdtemp(join(temp, "delivery-links-"));
  try {
    const original = '# Guide\n\nSee [Related API](./target.md#usage), [site](https://example.org) and `code [x](./target.md)`.\n\nSee [**reference**][api].\n\n[api]: ./target.md\n';
    const input = { markdown: original, output_path: "knowledge/codeindex/sample/guide.md", artifact_ref: "guide" };
    const projection = createDeliveryLinkProjection(root, new Set([input.output_path]));
    expect(projection.project(input)).toContain("See Related API, [site](https://example.org)");
    expect(projection.project(input)).toContain("`code [x](./target.md)`");
    expect(projection.project(input)).toContain("See **reference**.");
    const targets = projection.targets.guide!;
    expect(targets).toEqual(["knowledge/codeindex/sample/target.md"]);
    const before = deliveryLinkDigest(root, "unchanged-source", targets);
    const sameBatch = createDeliveryLinkProjection(root, new Set(targets));
    expect(sameBatch.project(input)).toBe(original);
    await mkdir(join(root, "knowledge/codeindex/sample"), { recursive: true });
    await writeFile(join(root, targets[0]!), "# Target\n");
    expect(deliveryLinkDigest(root, "unchanged-source", targets)).not.toBe(before);
    expect(createDeliveryLinkProjection(root, new Set()).project(input)).toBe(original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
