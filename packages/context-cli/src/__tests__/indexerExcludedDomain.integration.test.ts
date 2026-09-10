import { expect, test } from "bun:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { currentLedger, currentSpec } from "../project/indexerMainRunStoreRecords.js";

test("explicit excluded domains need no owner and produce no planning tasks", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    const path = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(path, "utf8"));
    registry.requirements[0].coverage_domains["excluded-domain"] = "out-of-scope";
    registry.requirements[0].coverage_domains["optional-domain"] = "optional";
    await writeFile(path, YAML.stringify(registry));
    await advanceCurrentIndexerLifecycle(root);
    const ledger = await currentLedger(root);
    expect(ledger!.entries.length).toBeGreaterThan(0);
    for (const entry of ledger!.entries) {
      const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
      expect(spec.request.workset.owner_cell_refs.some(ref => ref.includes("excluded-domain"))).toBe(false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
