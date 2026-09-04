import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  type IndexerProviderSelectionProposal,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import type { IndexerResolvedSelectionInput } from "./indexerSelectionValidation.js";

const STATE_PATH = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "current-provider-setup.json",
);

export interface CurrentIndexerProviderSetupState {
  format: "context-runtime-indexer-provider-setup";
  proposal: IndexerProviderSelectionProposal;
  resolved: IndexerResolvedSelectionInput[];
  state_digest: string;
}

function payload(value: Omit<CurrentIndexerProviderSetupState, "state_digest">) {
  return {
    format: value.format,
    proposal: value.proposal,
    resolved: value.resolved,
  };
}

export async function persistCurrentIndexerProviderSetup(input: {
  projectRoot: string;
  proposal: IndexerProviderSelectionProposal;
  resolved: readonly IndexerResolvedSelectionInput[];
}): Promise<CurrentIndexerProviderSetupState> {
  const base = payload({
    format: "context-runtime-indexer-provider-setup",
    proposal: input.proposal,
    resolved: [...input.resolved],
  });
  const state: CurrentIndexerProviderSetupState = {
    ...base,
    state_digest: indexerProtocolDigest(base),
  };
  await atomicWriteFile(
    join(input.projectRoot, STATE_PATH),
    `${JSON.stringify(JSON.parse(canonicalIndexerJson(state)), null, 2)}\n`,
  );
  return state;
}

export async function readCurrentIndexerProviderSetup(
  projectRoot: string,
): Promise<CurrentIndexerProviderSetupState | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(projectRoot, STATE_PATH), "utf8");
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
  const value = JSON.parse(raw) as Partial<CurrentIndexerProviderSetupState>;
  if (
    value.format !== "context-runtime-indexer-provider-setup" ||
    value.proposal === undefined ||
    !Array.isArray(value.resolved) ||
    typeof value.state_digest !== "string"
  ) {
    throw new TypeError("current Indexer Provider setup state is incomplete");
  }
  const state = value as CurrentIndexerProviderSetupState;
  if (indexerProtocolDigest(payload(state)) !== state.state_digest) {
    throw new TypeError("current Indexer Provider setup state digest is invalid");
  }
  return state;
}

export async function clearCurrentIndexerProviderSetup(projectRoot: string): Promise<void> {
  await rm(join(projectRoot, STATE_PATH), { force: true });
}
