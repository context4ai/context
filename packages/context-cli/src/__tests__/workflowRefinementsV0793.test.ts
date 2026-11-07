import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextError } from "../lib/errors.js";
import { readYamlOrJsonInput } from "../project/payloadInput.js";
import { openLocalFile } from "../project/localHtmlReport.js";
import { reviewNavigationChanges } from "../project/reviewSiteModel.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";
import { createContextWorkflowFacts } from "../project/workflow/workflowFacts.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function tempRoot() { const root = await mkdtemp(join(tmpdir(), "context-0793-")); roots.push(root); return root; }

test("unquoted colon text gets a quoting hint; other YAML errors keep the generic next step", async () => {
  const root = await tempRoot();
  const read = (path: string) => readYamlOrJsonInput({ path, label: "version record", missingNext: "m", readFailureNext: "r", parseFailureNext: "Use valid YAML or JSON" });
  await writeFile(join(root, "colon.yaml"), "summary: Upgrade: Context 1.0\n");
  const colon = await read(join(root, "colon.yaml")).catch(error => error);
  expect(colon).toBeInstanceOf(ContextError);
  expect((colon as ContextError).detail?.next).toContain('Quote text that contains ": "');
  await writeFile(join(root, "tab.yaml"), "summary: [unclosed\n");
  const other = await read(join(root, "tab.yaml")).catch(error => error);
  expect((other as ContextError).detail?.next).toBe("Use valid YAML or JSON");
  await writeFile(join(root, "quoted.yaml"), 'summary: "Upgrade: Context 1.0"\n');
  expect(await read(join(root, "quoted.yaml"))).toEqual({ summary: "Upgrade: Context 1.0" });
});

test("without a graphical session the report is not handed to xdg-open", async () => {
  if (process.platform !== "linux") return;
  const saved = { NODE_ENV: process.env.NODE_ENV, BUN_TEST: process.env.BUN_TEST, DISPLAY: process.env.DISPLAY,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, CONTEXT_DISABLE_AUTO_OPEN: process.env.CONTEXT_DISABLE_AUTO_OPEN };
  for (const key of Object.keys(saved)) delete process.env[key];
  try { expect(await openLocalFile("/nonexistent/report.html")).toEqual({ opened: false, error: "no-graphical-session" }); }
  finally { for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value; }
});

test("navigation changes list every changed entry, including pages outside the batch", () => {
  const pages = [{ id: "a", title: "Old guide", path: "guides/old.md" }, { id: "b", title: "New guide", path: "guides/new.md" }];
  const before = [{ key: "guides", title: "Guides" }, { key: "old", title: "Old guide", parent: "guides", target: { artifact_ref: "a" } },
    { key: "gone", title: "Gone", parent: "guides" }];
  const after = [{ key: "guides", title: "Guides and how-tos" }, { key: "old", title: "Old guide", parent: "guides", target: { artifact_ref: "b" } },
    { key: "fresh", title: "Fresh", parent: null, target: { artifact_ref: "b" } }];
  expect(reviewNavigationChanges(before, after, pages)).toEqual([
    { key: "guides", title: "Guides and how-tos", changes: ["renamed"], old_title: "Guides" },
    { key: "old", title: "Old guide", changes: ["retargeted"], old_target: { id: "a", title: "Old guide", path: "guides/old.md" },
      new_target: { id: "b", title: "New guide", path: "guides/new.md" } },
    { key: "fresh", title: "Fresh", changes: ["added"], new_target: { id: "b", title: "New guide", path: "guides/new.md" } },
    { key: "gone", title: "Gone", changes: ["removed"], old_target: null },
  ]);
});

test("queued maintenance defers translation and version recording until the queue is empty", () => {
  const pending = { ...emptyObservation(), approvedPages: 2, translationRouteSatisfied: false, versionCurrent: false };
  type Deferral = { translation: { route_satisfied: boolean }; version: { recording_satisfied: boolean } };
  const now = createContextWorkflowFacts(pending, []) as unknown as Deferral;
  expect(now.translation.route_satisfied).toBe(false);
  expect(now.version.recording_satisfied).toBe(false);
  const deferred = createContextWorkflowFacts({ ...pending, maintenanceQueued: true }, []) as unknown as Deferral;
  expect(deferred.translation.route_satisfied).toBe(true);
  expect(deferred.version.recording_satisfied).toBe(true);
});
