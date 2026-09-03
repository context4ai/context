import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  indexerProjectContentDigest,
  type IndexerProjectFileTarget,
} from "@c4a/context";
import {
  recoverDurableMultiFileTransactions,
  runDurableMultiFileTransaction,
} from "../project/durableMultiFileTransaction.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const REGISTRY_PATH = "src/indexers.yaml";
const CUSTOM_PATH = "src/indexer/sample/instructions.md";
const BASE_REGISTRY = "protocol: context.indexer.registry/v1\nrequirements: []\nindexers: []\n";
const TARGET_REGISTRY = `${BASE_REGISTRY}# selected\n`;
const BASE_CUSTOM = "# Old guidance\n";
const TARGET_CUSTOM = "# New guidance\n";

function targets(): IndexerProjectFileTarget[] {
  return [{
    path: CUSTOM_PATH,
    operation: "write",
    base_digest: indexerProjectContentDigest(BASE_CUSTOM),
    target_digest: indexerProjectContentDigest(TARGET_CUSTOM),
    content: TARGET_CUSTOM,
  }, {
    path: REGISTRY_PATH,
    operation: "write",
    base_digest: indexerProjectContentDigest(BASE_REGISTRY),
    target_digest: indexerProjectContentDigest(TARGET_REGISTRY),
    content: TARGET_REGISTRY,
  }];
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-multi-file-transaction-"));
  await mkdir(join(root, "src", "indexer", "sample"), { recursive: true });
  await writeFile(join(root, REGISTRY_PATH), BASE_REGISTRY, "utf8");
  await writeFile(join(root, CUSTOM_PATH), BASE_CUSTOM, "utf8");
  return root;
}

async function state(root: string): Promise<[string, string]> {
  return Promise.all([
    readFile(join(root, CUSTOM_PATH), "utf8"),
    readFile(join(root, REGISTRY_PATH), "utf8"),
  ]);
}

describe("durable multi-file transaction", () => {
  test("commits all targets under one proposal identity and cleans its journal", async () => {
    const root = await workspace();
    const receipt = await runDurableMultiFileTransaction({
      projectRoot: root,
      kind: "apply-indexer-project",
      proposal_digest: digest("a"),
      targets: targets(),
    });
    expect(receipt.recovered).toBe(false);
    expect(await state(root)).toEqual([TARGET_CUSTOM, TARGET_REGISTRY]);
    expect(await readdir(join(root, ".tmp", "context-runtime", "transactions"))).toEqual([]);
  });

  test("recovers every journal/write/fsync/rename boundary to complete base or target", async () => {
    const points = [
      "after-initial-journal-write",
      "after-initial-journal-fsync",
      "after-initial-journal-rename",
      "after-initial-journal-dir-fsync",
      `after-target-write:${CUSTOM_PATH}`,
      `after-target-fsync:${CUSTOM_PATH}`,
      `after-target-rename:${CUSTOM_PATH}`,
      `after-target-dir-fsync:${CUSTOM_PATH}`,
      "after-transaction-remove",
      "after-transaction-remove-dir-fsync",
    ];
    for (const point of points) {
      const root = await workspace();
      let injected = false;
      await expect(runDurableMultiFileTransaction({
        projectRoot: root,
        kind: "apply-indexer-project",
        proposal_digest: digest("b"),
        targets: targets(),
        inject_failure: (current) => {
          if (!injected && current === point) {
            injected = true;
            throw new Error(`injected:${point}`);
          }
        },
      })).rejects.toThrow(`injected:${point}`);
      expect(injected).toBe(true);
      await recoverDurableMultiFileTransactions(root);
      const current = await state(root);
      expect(
        JSON.stringify(current) === JSON.stringify([BASE_CUSTOM, BASE_REGISTRY]) ||
        JSON.stringify(current) === JSON.stringify([TARGET_CUSTOM, TARGET_REGISTRY]),
      ).toBe(true);
    }
  });

  test("rejects CAS drift and unknown recovery state without overwriting user changes", async () => {
    const root = await workspace();
    await writeFile(join(root, CUSTOM_PATH), "user changed\n", "utf8");
    await expect(runDurableMultiFileTransaction({
      projectRoot: root,
      kind: "apply-indexer-project",
      proposal_digest: digest("c"),
      targets: targets(),
    })).rejects.toThrow(/base CAS mismatch/);
    expect(await readFile(join(root, CUSTOM_PATH), "utf8")).toBe("user changed\n");

    const recoveryRoot = await workspace();
    await expect(runDurableMultiFileTransaction({
      projectRoot: recoveryRoot,
      kind: "apply-indexer-project",
      proposal_digest: digest("d"),
      targets: targets(),
      inject_failure: (point) => {
        if (point === `after-target-rename:${CUSTOM_PATH}`) throw new Error("crash");
      },
    })).rejects.toThrow("crash");
    await writeFile(join(recoveryRoot, CUSTOM_PATH), "external drift\n", "utf8");
    await expect(recoverDurableMultiFileTransactions(recoveryRoot)).rejects.toThrow(
      /unknown state/,
    );
    expect(await readFile(join(recoveryRoot, CUSTOM_PATH), "utf8")).toBe("external drift\n");
  });

  test("supports a declared delete while retaining exact CAS semantics", async () => {
    const root = await workspace();
    const deleteTarget: IndexerProjectFileTarget = {
      path: CUSTOM_PATH,
      operation: "delete",
      base_digest: indexerProjectContentDigest(BASE_CUSTOM),
      target_digest: null,
    };
    await runDurableMultiFileTransaction({
      projectRoot: root,
      kind: "apply-indexer-project",
      proposal_digest: digest("e"),
      targets: [deleteTarget],
    });
    await expect(readFile(join(root, CUSTOM_PATH), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
