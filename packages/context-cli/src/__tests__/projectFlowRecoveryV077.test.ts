import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { test, expect, afterEach } from 'bun:test';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from './projectDocumentRevisionV074.fixture.js';
import { approveCandidates } from './projectDocumentRevisionStages.fixture.js';
import { readProductionRequirements } from '../project/productionRequirements.js';
import { prepareProductionPlanningMaterials } from '../project/productionPlanningMaterials.js';
import { produceFixtureArticles } from './productionArticleWorkflow.fixture.js';
import { readProductionStage } from '../project/productionStageStore.js';
import { prepareCurrentProductionStage } from '../project/productionStagePreparation.js';
import { completeCurrentIndexerAction } from './knowledgeMapReview.fixture.js';
import { readCandidateRecords } from '../project/candidateLedger.js';
import { closeProjectWorkspace } from '../project/close.js';
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { beginDocumentRevision } from '../project/documentRevision.js';
import { readApprovedRevision, completeApprovedRevision } from '../project/approvedRevision.js';
import { collectProjectStatus } from '../project/status.js';
import { maintenanceRevision, advanceKnowledgeMaintenance } from '../project/knowledgeMaintenance.js';
import { readMaintenance } from '../project/maintenanceStorage.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });
async function setup() {
 const root = await initialRevisionKnowledge(roots);
 const articles = YAML.parse(await readFile(join(root, 'knowledge/structure.yaml'), 'utf8')).articles;
 return {root, path: articles[0].path};
}
test('concurrent approved edit provides a merge Route and rejects an outdated merge',async()=>{
 const {root,path}=await setup();
 await beginDocumentRevision({projectRoot:root,selector:path,instruction:'Clarify the explanation.'});
 const original=(await readApprovedRevision(root))!;
 const file=join(root,'knowledge',path);
 await writeFile(file,(await readFile(file,'utf8')).replace('public entry point','user-corrected public entry point'));
 const status=await collectProjectStatus(root,{managed:true});
 const route=status.workflow.current!;
 expect(route.node).toBe('merge-approved-revision');
 expect(route.revision).not.toBe(original.revision);
 expect((await readApprovedRevision(root))!.revision).toBe(original.revision);
 expect(await beginDocumentRevision({projectRoot:root,selector:path,instruction:'Keep the concurrent edit.'})).toMatchObject({status:'merge-required'});
 const {approvedRevisionRecovery}=await import('../project/approvedRevisionRecovery.js');
 const recovery=(await approvedRevisionRecovery(root,original))!;
 expect(recovery.request.target.markdown).toContain('user-corrected');
 await writeFile(file,(await readFile(file,'utf8')).replace('user-corrected','latest-user-corrected'));
 await expect(completeApprovedRevision({projectRoot:root,revision:route.revision,markdown:recovery.request.target.markdown})).rejects.toThrow('stale');
 const next=(await collectProjectStatus(root,{managed:true})).workflow.current!;
 const fresh=(await approvedRevisionRecovery(root,original))!;
 await completeCurrentIndexerAction({cwd:root,revision:next.revision,managed:true,value:{stage:'approved-revision',markdown:fresh.request.target.markdown.replace('latest-user-corrected','clarified latest-user-corrected')}});
 expect((await readFile(file,'utf8'))).not.toContain('clarified');
 // A conflict discovered during Review must reopen the same merge path too.
 await writeFile(file,(await readFile(file,'utf8')).replace('latest-user-corrected','review-user-corrected'));
 const reviewRecovery=(await approvedRevisionRecovery(root,await readApprovedRevision(root)))!;
 expect(reviewRecovery.request.merge_context!.draft_markdown).toContain('clarified latest-user-corrected');
 const reviewRoute=(await collectProjectStatus(root,{managed:true})).workflow.current!;
 expect(reviewRoute.node).toBe('merge-approved-revision');
 await completeCurrentIndexerAction({cwd:root,revision:reviewRoute.revision,managed:true,value:{stage:'approved-revision',markdown:reviewRecovery.request.target.markdown.replace('review-user-corrected','clarified review-user-corrected')}});

 await approveCandidates(root,await readCandidateRecords(root));
 await closeProjectWorkspace(root); await buildProjectPackages(root);
 expect(await readFile(file,'utf8')).toContain('clarified review-user-corrected');
},60000);
test('repeated CLI regeneration starts a new cycle after completion, preserving pending idempotency',async()=>{
 const {root,path}=await setup();
 const request={projectRoot:root,selector:path,instruction:'Regenerate the current API table.',regenerate:true};
 await beginDocumentRevision(request);
 await advanceKnowledgeMaintenance(root,(await maintenanceRevision(root)).revision);
 const revision=(await readApprovedRevision(root))!;
 expect(revision.program_blocks!.length).toBeGreaterThan(0);
 const block=revision.program_blocks![0]!;
 await completeApprovedRevision({projectRoot:root,revision:revision.revision,markdown:revision.target.markdown+`\n<!-- context:section id="api-audit" -->\n${block.token}\n<!-- /context:section -->\n`});
 await approveCandidates(root,await readCandidateRecords(root)); await closeProjectWorkspace(root); await buildProjectPackages(root);
 const source=join(root,'fixture-source');
 await writeFile(join(source,'src/index.ts'),'export const answer = 43;\n');
 execFileSync('git',['add','src/index.ts'],{cwd:source}); execFileSync('git',['commit','-qm','audit fixture source update'],{cwd:source});
 const version=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 const registryFile=join(root,'sources/repo/index.yaml');const registry=YAML.parse(await readFile(registryFile,'utf8'));registry.sources[0].modules[0].git.ref=version;await writeFile(registryFile,YAML.stringify(registry));
 const second=await beginDocumentRevision(request);const state=await readMaintenance(root);
 expect(second).toMatchObject({outcome:'registered'});expect(state.pending).toHaveLength(1);
 expect((await beginDocumentRevision(request))).toMatchObject({outcome:'already-registered',id: "id" in second ? second.id : undefined});
},60000);
test('multiple module labels guide same-source production without path mappings or Provider records',async()=>{
 const root=await createDocumentRevisionWorkspace();roots.push(root);
 const file=join(root,'src/indexers.yaml');const registry=YAML.parse(await readFile(file,'utf8'));
 registry.requirements.push({...registry.requirements[0],id:'peer-purpose',purpose:'Explain a separately selected module.',target_scope:{targets:[{source_ref:DOCUMENT_REVISION_SOURCE_REF,module_refs:['module:peer']}]},evidence_source_scope:{targets:[{source_ref:DOCUMENT_REVISION_SOURCE_REF,module_refs:['module:peer']}]}});
 await writeFile(file,YAML.stringify(registry));
 const requirements=await readProductionRequirements(root);
 const materials=await prepareProductionPlanningMaterials({projectRoot:root,requirements});
 expect(materials.gaps).toEqual([]);
 const skeleton=materials.materials.sources.get(DOCUMENT_REVISION_SOURCE_REF)!;
 expect(skeleton).toContain('module:app');expect(skeleton).toContain('module:peer');
 expect(skeleton).toContain('src/index.ts');expect(skeleton).toContain('src/secondary.ts');
 const configuration=await readFile(file,'utf8');
 await produceFixtureArticles(root,['index','secondary'].map(name=>({
   path:`architecture/${name}-entry.md`,question:`Explain ${name}`,sources:[DOCUMENT_REVISION_SOURCE_REF],
   markdown:`---\ntitle: ${name}\ndescription: Explain the exported value\n---\n\n<!-- context:section id="value" -->\nThe ${name} entry exports its value.\n<!-- /context:section -->\n`,
   references:{sections:[{id:'value',references:[{source_ref:DOCUMENT_REVISION_SOURCE_REF,locator:{path:`src/${name}.ts`,start_line:1,end_line:1}}]}]},
 })));
 const before=await readCandidateRecords(root);
 const stage=(await readProductionStage(root))!;
 await prepareCurrentProductionStage({projectRoot:root,revision:stage.id});
 expect(await readCandidateRecords(root)).toEqual(before);
 expect(await readFile(file,'utf8')).toBe(configuration);
 expect(stage.tasks.every(task=>task.status==='accepted')).toBe(true);
 expect(stage.tasks.every(task=>!('module_paths' in task))).toBe(true);
},60000);
test('revisiting an earlier page preserves interrupted sibling regeneration and program blocks',async()=>{
 const {root}=await setup();
 const {registerKnowledgeMaintenance}=await import('../project/knowledgeMaintenance.js');
 const views=YAML.parse(await readFile(join(root,'knowledge/structure.yaml'),'utf8')).articles;
 await registerKnowledgeMaintenance(root,{id:'two-api-pages',operation:'regenerate',targets:views.map((view: { path: string })=>({path:view.path,instruction:'Regenerate this page API table.'}))});
 await advanceKnowledgeMaintenance(root,(await maintenanceRevision(root)).revision);
 const first=(await readApprovedRevision(root))!;
 await completeApprovedRevision({projectRoot:root,revision:first.revision,markdown:first.target.markdown.replace('public entry point','documented public entry point')});
 const second=(await readApprovedRevision(root))!;expect(second.regenerate).toBe(true);expect(second.program_blocks!.length).toBeGreaterThan(0);
 await beginDocumentRevision({projectRoot:root,selector:first.target.path,instruction:'Correct one more phrase in the first draft.'});
 const reopened=(await readApprovedRevision(root))!;
 await completeApprovedRevision({projectRoot:root,revision:reopened.revision,markdown:reopened.target.markdown.replace('documented public entry point','clearly documented public entry point')});
 const resumed=(await readApprovedRevision(root))!;
 expect(resumed.target.path).toBe(second.target.path);expect(resumed.regenerate).toBe(true);expect(resumed.program_blocks).toEqual(second.program_blocks);
 const block=resumed.program_blocks![0]!;
 await completeApprovedRevision({projectRoot:root,revision:resumed.revision,markdown:resumed.target.markdown+`\n<!-- context:section id="regenerated" -->\n${block.token}\n<!-- /context:section -->\n`});
 expect((await readCandidateRecords(root)).find(item=>item.path===second.target.path)!.body).toContain(block.markdown);
 await approveCandidates(root,await readCandidateRecords(root)); await closeProjectWorkspace(root); await buildProjectPackages(root);
 expect((await readMaintenance(root)).active).toBeUndefined();
},60000);
