import { expect, test } from "bun:test";
import { resolvePrimaryArtifactIntent, supportsPrimaryArtifact, selectAuthorPolicy } from "../project/indexerPrimaryArtifactPolicy.js";
const content = { source_role: "authoritative-source", document_kind: "public-api-reference", reader_goal: "look-up-public-contract", artifact_kind: "content" };
const contract = { ...content, artifact_kind: "contract" };
const policy = { id: "standard", required_artifact_kinds: ["content"], discretionary_artifact_kinds: ["contract"] };
test("single primary artifact must close required kinds without duplicating prose", () => {
  expect(supportsPrimaryArtifact("contract", policy)).toBe(false);
  expect(resolvePrimaryArtifactIntent(contract, [content, contract], policy)).toEqual(content);
  expect(resolvePrimaryArtifactIntent(content, [content, contract], policy)).toEqual(content);
  expect(resolvePrimaryArtifactIntent(contract, [content, contract], { ...policy, required_artifact_kinds: ["contract"] })).toEqual(contract);
});
test("normalization cannot change purpose or manufacture an unsupported bundle", () => {
  expect(() => resolvePrimaryArtifactIntent(contract, [{ ...content, reader_goal: "other-goal" }], policy)).toThrow("primary-artifact-policy-mismatch");
  expect(() => resolvePrimaryArtifactIntent(contract, [content, contract], { ...policy, required_artifact_kinds: ["content", "contract"] })).toThrow("primary-artifact-policy-mismatch");
});

test("non-publishing results need no otherwise ambiguous artifact policy choice", () => {
  const policies = [policy, { ...policy, id: "extended" }];
  expect(selectAuthorPolicy(policies, undefined, false)).toEqual(policy);
  expect(() => selectAuthorPolicy(policies, undefined, true)).toThrow("choose one eligible policy");
  expect(selectAuthorPolicy(policies, "extended", true).id).toBe("extended");
  expect(() => selectAuthorPolicy(policies, "unregistered", true)).toThrow();
});
