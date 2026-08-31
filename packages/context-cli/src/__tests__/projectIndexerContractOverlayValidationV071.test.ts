import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  indexerContractOverlayDigest,
  type IndexerContractOverlay,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import {
  buildIndexerContractOverlayValidationInput,
  validateProjectIndexerContractOverlay,
} from "../project/indexerContractOverlayValidation.js";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const OPERATORS = bundledIndexerOperatorContract();
const PROFILES = bundledIndexerProfileContract(OPERATORS);
const BASE_PROFILE = PROFILES.profiles[0]!;

function overlay(): IndexerContractOverlay {
  const payload: Omit<IndexerContractOverlay, "overlay_digest"> = {
    protocol: "context.indexer.contract-overlay/v1",
    id: "sample-overlay",
    version: "1.0.0",
    extends: {
      profile: BASE_PROFILE.id,
      version: PROFILES.version,
      contract_digest: PROFILES.contract_digest,
    },
    operator_contract_version: OPERATORS.version,
    operator_contract_digest: OPERATORS.contract_digest,
    additions: {},
  };
  return { ...payload, overlay_digest: indexerContractOverlayDigest(payload) };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-overlay-validation-"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "contract-overlay-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  })}\n`, "utf8");
  return root;
}

describe("Indexer contract overlay validation", () => {
  test("returns one project- and Provider-bound validation receipt without a Gate", async () => {
    const root = await workspace();
    const input = buildIndexerContractOverlayValidationInput({
      project_ref: "project:sample",
      overlay: overlay(),
      base_contract: PROFILES,
      operator_contract: OPERATORS,
      provider_integrity: digest("8"),
    });
    const result = validateProjectIndexerContractOverlay(input);
    expect(result).toMatchObject({
      outcome: "valid",
      graph_outcome: "completed",
      validation_input_digest: input.input_digest,
      validation_receipt: {
        protocol: "context.indexer.overlay-validation-receipt/v1",
        project_ref: "project:sample",
        provider_integrity: digest("8"),
        overlay_digest: input.overlay.overlay_digest,
      },
    });

    const inputPath = join(root, "overlay-validation.json");
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
    expect(JSON.parse(await runCliInDir(root, [
      "indexer",
      "validate-indexer-contract-overlays",
      "--input",
      inputPath,
      "--format",
      "json",
    ]))).toEqual(result);
  });

  test("rejects unknown fields and stale overlay digests", () => {
    const input = buildIndexerContractOverlayValidationInput({
      project_ref: "project:sample",
      overlay: overlay(),
      base_contract: PROFILES,
      operator_contract: OPERATORS,
      provider_integrity: digest("8"),
    });
    expect(() => validateProjectIndexerContractOverlay({
      ...input,
      legacy_signature: null,
    })).toThrow(/unknown field/);
    expect(() => validateProjectIndexerContractOverlay(
      buildIndexerContractOverlayValidationInput({
        ...input,
        overlay: { ...input.overlay, overlay_digest: digest("6") },
      }),
    )).toThrow(/overlay digest/);
  });
});
