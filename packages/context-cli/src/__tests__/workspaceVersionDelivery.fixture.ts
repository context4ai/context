import { collectProjectStatus } from "../project/status.js";
import { inspectWorkspaceVersion, recordWorkspaceVersion } from "../project/workspaceChangelog.js";
import { placeApprovedReadingFixture } from "./knowledgeMapReview.fixture.js";
import { buildProjectPackages } from "../project/packageBuilder.js";

/** Scenario-specific author choices followed by the unmodified package builder. */
export async function buildFixturePackages(...args: Parameters<typeof buildProjectPackages>) {
  await placeApprovedReadingFixture(args[0]);
  await recordFixtureVersionIfRequired(args[0]);
  return buildProjectPackages(...args);
}

/** Exercise the real final-scope route; intermediate deliveries keep their version. */
export async function recordFixtureVersionIfRequired(root: string) {
  const status = await collectProjectStatus(root, { managed: true });
  if (status.workflow.current?.node !== "record-workspace-version") return;
  const diff = await inspectWorkspaceVersion(root);
  const [major, minor, patch] = diff.version.split(".").map(Number);
  await recordWorkspaceVersion(root, {
    expected_digest: diff.expected_digest,
    version: `${major}.${minor}.${patch! + 1}`,
    title: "Deliver reviewed fixture knowledge",
    changes: ["Publish the reviewed knowledge and reader navigation."],
    triggers: [{ kind: "other", description: "Integration fixture delivery." }],
    actor: { kind: "user", name: "Fixture author" },
  });
}
