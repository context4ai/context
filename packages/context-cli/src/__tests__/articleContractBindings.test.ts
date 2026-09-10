import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { indexerTemplateContractSchema, renderIndexerDeterministicFacts, type IndexerArtifactFact, type IndexerArtifactResult } from '@c4a/context';
import { applySelectedPageTemplate } from '../project/indexerPageTemplate.js';
import { splitFrontmatter, parseSectionBodies } from '../project/indexerTemplateRendering.js';
import { readerKnowledgeDescription } from '../project/packageKnowledgeProjection.js';

for (const name of ['web-application-f03', 'api-service-s02', 'api-service-s03', 'sdk-library-l01', 'component-library-l02']) {
  test(`${name} renders authorized contract facts without inventing unavailable contracts`, async () => {
    const raw = splitFrontmatter(await readFile(join(import.meta.dir, '../../../../plugins/context/skills/context-code-indexer/templates/article-programs', `${name}-page.md`), 'utf8'));
    const template = { contract: indexerTemplateContractSchema.parse(raw.metadata), section_bodies: parseSectionBodies(raw.body) };
    const make = (): Extract<IndexerArtifactResult['artifacts'][number], {representation: 'sections'}> => ({
      artifact_id: 'entry', artifact_kind: 'content', artifact_policy_variant: 'standard', representation: 'sections',
      sections: [{ section_key: 'entry--intro', owner_indexer_id: 'sample', document_kind: 'reference', reader_goal: template.contract.reader_goal,
        artifact_kind: 'content', blocks: [{ block_id: 'intro', layer: 'semantic-prose', markdown: 'Read the declared input before tracing its consumer.', evidence_refs: ['evidence:input'] }] }],
    });
    const fact: IndexerArtifactFact = { fact_ref: 'fact:input', fact_kind: 'symbol', subject_key: { protocol: 'context.subject-key/v1', namespace: 'sample', kind: 'component', local_key: 'input' },
      evidence_refs: ['evidence:input'], value: { name: 'Request', members: [{ name: 'id', typeAnnotation: 'string', optional: false }] } };
    const artifact = make();
    const used = applySelectedPageTemplate({ artifact, template, facts: [fact], articleKey: 'entry' });
    const blocks = artifact.sections.flatMap(section => section.blocks).filter(block => block.layer === 'deterministic-block');
    expect(blocks.length).toBeGreaterThan(0);
    const rendered = blocks.map(block => renderIndexerDeterministicFacts({ renderer: block.renderer, facts: used.filter(item => block.fact_refs.includes(item.fact_ref)) })).join('\n');
    expect(rendered).toContain('| Request | id | string | required |');
    expect(used).toEqual([fact]);
    const empty = make();
    applySelectedPageTemplate({ artifact: empty, template, facts: [], articleKey: 'entry' });
    expect(empty.sections.flatMap(section => section.blocks).some(block => block.layer === 'deterministic-block')).toBe(false);
  });
}

test('reader descriptions omit table bodies and preserve a meaningful paragraph or title', () => {
  const table = '| File | Next |\n| --- | --- |\n| src/main.ts | Inspect caller |';
  expect(readerKnowledgeDescription({ description: table, markdown: table, title: 'Source entry' })).toBe('Source entry');
  expect(readerKnowledgeDescription({ description: '# Entry\n\nLocate the request consumer.\n\n' + table, markdown: '', title: 'Entry' })).toBe('Locate the request consumer.');
  expect(readerKnowledgeDescription({ description: 'Read A | B for alternatives.', markdown: '', title: 'Entry' })).toBe('Read A | B for alternatives.');
});
