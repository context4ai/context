import YAML from "yaml";
import { expandArticleBlueprint } from "../project/indexerArticleBlueprint.js";
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { type IndexerArtifactResult } from '@c4a/context';
import { applySelectedPageTemplate } from '../project/indexerPageTemplate.js';
import { splitFrontmatter } from '../project/indexerTemplateRendering.js';
import { readerKnowledgeDescription } from '../project/packageKnowledgeProjection.js';

for (const name of ['web-application-f03', 'api-service-s02', 'api-service-s03', 'sdk-library-l01', 'component-library-l02']) {
  test(`${name} preserves authored content when no writing slots were supplied`, async () => {
    const root = join(import.meta.dir, '../../../../plugins/context/skills/context-code-indexer');
    const manifest = YAML.parse(await readFile(join(root, 'context-indexer.yaml'), 'utf8'));
    const binding = manifest.provider.templates.find((item: { id: string }) => item.id === `${name}-page`);
    const raw = splitFrontmatter(await readFile(join(root, binding.path), 'utf8'));
    const template = expandArticleBlueprint(raw.metadata, binding)!;
    const make = (): Extract<IndexerArtifactResult['artifacts'][number], {representation: 'sections'}> => ({
      artifact_id: 'entry', artifact_kind: 'content', artifact_policy_variant: 'standard', representation: 'sections',
      sections: [{ section_key: 'entry--intro', owner_indexer_id: 'sample', document_kind: 'reference', reader_goal: template.contract.reader_goal,
        artifact_kind: 'content', blocks: [{ block_id: 'intro', layer: 'semantic-prose', markdown: 'Read the declared input before tracing its consumer.', references: [] }] }],
    });
    const artifact = make();
    const original = structuredClone(artifact.sections);
    applySelectedPageTemplate({ artifact, template, articleKey: 'entry' });
    expect(artifact.sections).toEqual(original);
    expect(artifact.template_id).toBe(template.contract.template_id);
    expect(JSON.stringify(artifact)).not.toContain('fact_refs');
  });
}

test('reader descriptions omit table bodies and preserve a meaningful paragraph or title', () => {
  const table = '| File | Next |\n| --- | --- |\n| src/main.ts | Inspect caller |';
  expect(readerKnowledgeDescription({ description: table, markdown: table, title: 'Source entry' })).toBe('Source entry');
  expect(readerKnowledgeDescription({ description: '# Entry\n\nLocate the request consumer.\n\n' + table, markdown: '', title: 'Entry' })).toBe('Locate the request consumer.');
  expect(readerKnowledgeDescription({ description: 'Read A | B for alternatives.', markdown: '', title: 'Entry' })).toBe('Read A | B for alternatives.');
});
