import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { completeApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { collectProjectStatus } from "../project/status.js";
import { readProductionStage } from "../project/productionStageStore.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("approved prose can be revised repeatedly after temporary cleanup, without rediscovery or planning", async () => {
  const root = await initialRevisionKnowledge(roots);
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  const path = structure.articles[0].path as string;
  const peers = await Promise.all((structure.articles as Array<{ path: string }>).slice(1).map(async article => ({
    path: article.path, text: await readFile(join(root, "knowledge", article.path), "utf8"),
  })));
  const entry = join(root, "src/index.ts");
  for (const wording of ["First revision.", "Second revision."]) {
    await rm(join(root, ".tmp"), { recursive: true, force: true });
    await rm(join(root, "dist"), { recursive: true, force: true });
    await beginDocumentRevision({ projectRoot: root, selector: path, instruction: `Clarify the public entry point: ${wording}` });
    const revision = (await readApprovedRevision(root))!;
    expect(await readProductionStage(root)).toBeUndefined();
    expect((await collectProjectStatus(root)).workflow.current?.node).toBe("author-approved-revision");
    const markdown = revision.target.markdown.replace(/public entry point|First revision\./u, wording);
    await completeApprovedRevision({ projectRoot: root, revision: revision.revision, markdown });
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    expect(await readApprovedRevision(root)).toBeDefined();
    if (wording === "First revision.") {
      const configured = await readFile(entry, "utf8");
      await writeFile(entry, configured.replace("src/package-templates/kb", "src/missing-template"));
      await expect(buildFixturePackages(root)).rejects.toThrow();
      expect(await readApprovedRevision(root)).toBeDefined();
      await writeFile(entry, configured);
    }
    await buildFixturePackages(root);
    expect(await readApprovedRevision(root)).toBeUndefined();
    expect(await readFile(join(root, "knowledge", path), "utf8")).toContain(wording);
    for (const peer of peers) expect(await readFile(join(root, "knowledge", peer.path), "utf8")).toBe(peer.text);
  }
  await beginDocumentRevision({ projectRoot: root, selector: path, instruction: "Check whether wording needs changing." });
  const unchanged = (await readApprovedRevision(root))!;
  await completeApprovedRevision({ projectRoot: root, revision: unchanged.revision, markdown: unchanged.target.markdown });
  expect(await readApprovedRevision(root)).toBeUndefined();
  expect(await readCandidateRecords(root)).toEqual([]);
  await beginDocumentRevision({ projectRoot: root, selector: path, instruction: "Clarify the introduction." });
  const concurrent = (await readApprovedRevision(root))!;
  const approved = join(root, "knowledge", path);
  await writeFile(approved, `${await readFile(approved, "utf8")}\nConcurrent user edit.\n`);
  await expect(completeApprovedRevision({ projectRoot: root, revision: concurrent.revision,
    markdown: concurrent.target.markdown })).rejects.toThrow("stale");
  expect(await readFile(approved, "utf8")).toContain("Concurrent user edit.");
  expect(await readCandidateRecords(root)).toEqual([]);
}, 60_000);
