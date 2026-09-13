import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { readArticleContracts } from "./articleContractReading.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import type { ProductionSubmissionResult } from "../project/productionSubmission.js";
import { readCandidateRecords } from "../project/candidateLedger.js";

const execute = promisify(execFile);
// Artifact checks execute the selected CLI with Node, not an installed SDK proxy.
const cliPath = process.env.CONTEXT_TEST_CLI && resolve(process.env.CONTEXT_TEST_CLI);
async function submitWithCli(input: { projectRoot: string; stage: string; path: string }): Promise<ProductionSubmissionResult> {
  const args = ["action", "complete-current", "--revision", input.stage, "--input",
    join(input.projectRoot, productionAgentDirectory(input.stage), input.path), "--format", "json"];
  const output = cliPath
    ? (await execute("node", [cliPath, ...args], { cwd: input.projectRoot, timeout: 60_000,
        env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, maxBuffer: 16 * 1024 * 1024 })).stdout
    : await runCliInDir(input.projectRoot, args);
  return JSON.parse(output);
}

const source = `export interface PanelProps {
  showHeading?: boolean;
  locale?: string;
  /** @default false */
  enabled?: boolean;
  selected?: string[];
}
export const Panel = ({ showHeading = true, locale = 'en-US', enabled = true, selected = [] }: PanelProps) => null;
`;

for (const includeComponent of [false, true]) {
  test(`CLI file submission preserves source-rendered defaults with ${includeComponent ? "component and props" : "props only"} selected`, async () => {
    const root = await createDocumentRevisionWorkspace({ sourceCount: 1,
      sourceFiles: { "src/panel.tsx": source }, packageJson: { exports: { ".": "./src/panel.tsx" } } });
    try {
      const render = await readArticleContracts(root, "src/panel.tsx");
      const api = render(includeComponent ? ["PanelProps", "Panel"] : ["PanelProps"]);
      await produceFixtureArticles(root, [{ path: "codeindex/panel.md", question: "Which public props and runtime defaults does Panel use?",
        sources: [DOCUMENT_REVISION_SOURCE_REF],
        markdown: `---\ntitle: Public component\ndescription: Use Panel and its public parameters.\n---\n\n<!-- context:section id="api" -->\n## API\n\n${api}\n<!-- /context:section -->\n`,
        references: { sections: [{ id: "api", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
          locator: { path: "src/panel.tsx", start_line: 1, end_line: 8 } }] }] },
      }], { submit: submitWithCli });
      const candidates = await readCandidateRecords(root);
      expect(candidates).toHaveLength(1);
      const markdown = candidates[0]!.body;
      expect(markdown).toContain(api);
      for (const [name, type, value] of [
        ["showHeading", "boolean", "true"], ["locale", "string", "'en-US'"],
        ["enabled", "boolean", "true"], ["selected", "string[]", "[]"],
      ]) {
        expect(markdown.split(`| PanelProps | ${name} |`).length - 1).toBe(1);
        expect(markdown).toContain(`| PanelProps | ${name} | ${type} | optional | ${value} |`);
        expect(markdown).not.toContain(`| Panel | ${name} |`);
      }
      expect(candidates[0]!.source_refs).toEqual([DOCUMENT_REVISION_SOURCE_REF]);
      expect(candidates[0]!.indexer_candidate.sections[0]!.references[0]!.locator)
        .toEqual({ path: "src/panel.tsx", start_line: 1, end_line: 8 });
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120_000);
}
