import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const bytes = readFileSync(new URL('../dist/evidence/context-evidence.sourcegraph.wasm', import.meta.url));
const module = new WebAssembly.Module(bytes);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const article = '<!-- context:section id="first" -->\nFirst condition.\n<!-- /context:section -->\n\n<!-- context:section id="second" -->\nSecond condition.\n<!-- /context:section -->';
const source = 'repo:20260901/example';
const reference = (sourceRef = source) => ({ source_ref: sourceRef, locator: { path: 'src/example.ts', start_line: 3, end_line: 9 }, content_digest: `sha256:${'a'.repeat(64)}` });
const structure = (refs = [reference()]) => ({ schema_version: 'context.approved-structure.v1', articles: [{ article_id: 'example', path: 'example.md', collection: 'architecture', visibility: 'public', sections: [{ id: 'first', references: refs }, { id: 'second', references: [] }] }] });
const repo = { sources: [{ name: '20260901', modules: [{ name: 'example', subpath: 'module', git: { remote: 'https://example.org/team/source.git', ref: 'b'.repeat(40) } }] }] };
function fixtures(refs) {
  return { 'knowledge/example.md': article, 'knowledge/structure.yaml': JSON.stringify(structure(refs)), 'sources/repo/index.yaml': JSON.stringify(repo) };
}
function input(start = 2, end = 2, args = {}) {
  return { abi_version: 2, operation: 'read', args, files: [{ item_id: 'read-0', path: 'knowledge/example.md', start_line: start, end_line: end, content: article.split('\n').slice(start - 1, end).join('\n'), truncated: false }] };
}
const body = result => result.attachments.map(a => parse(a.text));
const refs = result => body(result).flatMap(b => b.references ?? []);
const issues = result => body(result).flatMap(b => b.diagnostics ?? []);
function host(files) {
  let instance;
  let error = '';
  const calls = [];
  const put = (data) => {
    const buffer = typeof data === 'string' ? encoder.encode(data) : data;
    const pointer = instance.exports.alloc(buffer.length) >>> 0;
    new Uint8Array(instance.exports.memory.buffer, pointer, buffer.length).set(buffer);
    return (BigInt(pointer) << 32n) | BigInt(buffer.length);
  };
  instance = new WebAssembly.Instance(module, { sourcegraph: {
    read_file(pointer, length) {
      const path = decoder.decode(new Uint8Array(instance.exports.memory.buffer, pointer >>> 0, length >>> 0));
      calls.push(path);
      if (!(path in files)) { error = 'not found (private host detail)'; return 0n; }
      return put(files[path]);
    },
    last_error() { return put(error); },
  } });
  return {
    calls,
    run(value) {
      const encoded = JSON.stringify(value);
      const request = put(encoded);
      const pointer = Number(request >> 32n), length = Number(request & 0xffffffffn);
      const packed = BigInt.asUintN(64, instance.exports.enrich(pointer, length));
      const resultPointer = Number(packed >> 32n), resultLength = Number(packed & 0xffffffffn);
      const result = JSON.parse(decoder.decode(new Uint8Array(instance.exports.memory.buffer, resultPointer, resultLength)));
      instance.exports.dealloc(resultPointer, resultLength);
      instance.exports.dealloc(pointer, length);
      return result;
    },
  };
}

test('real artifact metadata and imports', () => {
  const sections = WebAssembly.Module.customSections(module, 'sourcegraph.plugin.v1');
  assert.equal(sections.length, 1);
  const metadata = JSON.parse(decoder.decode(sections[0]));
  assert.equal(metadata.abi_version, 2);
  assert.equal(metadata.name, 'context-evidence');
  assert.equal(metadata.default_enabled, true);
  assert.deepEqual(metadata.operations, ['read', 'read_many']);
  assert.ok(decoder.decode(WebAssembly.Module.customSections(module, 'context.licenses')[0]).includes('serde'));
  assert.deepEqual(WebAssembly.Module.imports(module).map(i => `${i.module}.${i.name}`).sort(), ['sourcegraph.last_error', 'sourcegraph.read_file']);
});
test('shared section fixtures agree with the Context marker contract', () => {
  const cases = JSON.parse(readFileSync(new URL('../../context-evidence-wasm/fixtures/sections.json', import.meta.url), 'utf8'));
  for (const item of cases) {
    const files = fixtures(); files['knowledge/example.md'] = item.text;
    const map = structure(); map.articles[0].sections = (item.ids ?? []).map(id => ({ id, references: [{...reference(), locator:{path:`src/${id}.ts`,start_line:1,end_line:1}}] }));
    files['knowledge/structure.yaml'] = JSON.stringify(map);
    const result = host(files).run(input(1, item.text.split('\n').length));
    if (item.error) assert.ok(issues(result).length); else assert.equal(refs(result).length, item.ids.length);
  }
});
test('joins exact returned section with registered source, not knowledge revision', () => {
  const h = host(fixtures());
  const result = h.run(input());
  assert.deepEqual(Object.keys(result), ['attachments']);
  assert.equal(result.attachments[0].item_id, 'read-0');
  assert.deepEqual(body(result), [{references:[`https://example.org/team/source/blob/${'b'.repeat(40)}/module/src/example.ts#L3-L9`]}]);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.run(input()), result);
  assert.equal(h.calls.length, 3, 'warm instance does not reread immutable metadata');
  assert.deepEqual(h.run(input(6, 6)), {attachments:[]});
});
test('optional digest and monorepo root', () => {
  const files = Object.fromEntries(Object.entries(fixtures()).map(([p, v]) => [`docs/${p}`, v]));
  const request = input(2, 2, { workspace_root: 'docs', include_digest: true });
  request.files[0].path = 'docs/knowledge/example.md';
  assert.equal(refs(host(files).run(request))[0].content_digest, reference().content_digest);
});
test('source URLs encode file segments and normalize credential-free Git transports', () => {
  for (const remote of ['https://github.com/team/source.git', 'git@github.com:team/source.git', 'ssh://git@github.com/team/source.git']) {
    const ref = reference(); ref.locator = { path: 'src/a #中文%.ts', start_line: 3, end_line: 3 };
    const files = fixtures([ref]); const registry = structuredClone(repo);
    registry.sources[0].modules[0].git.remote = remote;
    files['sources/repo/index.yaml'] = JSON.stringify(registry);
    assert.deepEqual(refs(host(files).run(input())), [`https://github.com/team/source/blob/${'b'.repeat(40)}/module/src/a%20%23%E4%B8%AD%E6%96%87%25.ts#L3`]);
  }
});
test('unsupported routes and nonimmutable revisions keep lossless structured evidence', () => {
  for (const [remote, revision] of [['https://bitbucket.org/team/source','b'.repeat(40)], ['ssh://git@example.org:2222/team/source','b'.repeat(40)], ['https://example.org/team/source','main'], ['https://example.org/team/source','abc1234']]) {
    const files=fixtures(); const registry=structuredClone(repo);
    registry.sources[0].modules[0].git={remote,ref:revision};files['sources/repo/index.yaml']=JSON.stringify(registry);
    const result=refs(host(files).run(input()))[0];
    assert.equal(result.url,undefined);assert.equal(result.remote,remote);assert.equal(result.ref,revision);assert.equal(result.path,'module/src/example.ts');assert.equal(result.source_ref,source);
  }
});
test('batch reads do not repeat metadata or leak previous output', () => {
  const h = host(fixtures());
  const request = input();
  request.operation = 'read_many';
  request.files.push({...input(6, 6).files[0],item_id:'read-1'});
  assert.deepEqual(h.run(request).attachments.map(a=>a.item_id), ['read-0']);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.run({ abi_version:2, operation: 'read_many', files: [] }), { attachments: [] });
});
test('ABI and item identity violations fail before any host read', () => {
  const changes = [r => delete r.abi_version, r => r.abi_version = 1,
    r => delete r.files[0].item_id, r => r.files[0].item_id = '',
    r => r.files[0].item_id = 'bad\nvalue', r => r.files[0].item_id = 'x'.repeat(257),
    r => r.files.push({...r.files[0]})];
  for (const change of changes) {
    const h = host(fixtures()); const request = input(); change(request);
    const result = h.run(request);
    assert.ok(issues(result).length);
    assert.equal(result.attachments[0].item_id, undefined);
    assert.equal(h.calls.length, 0);
  }
});
test('same path ranges and duplicate reads retain independent attachment identities', () => {
  const files = fixtures(); const map = structure([reference(), reference()]);
  map.articles[0].sections[1].references = [{...reference(), locator:{path:'src/second.ts',start_line:20,end_line:30}}];
  files['knowledge/structure.yaml'] = JSON.stringify(map);
  const request = input(); request.operation = 'read_many';
  request.files.push({...input(6,6).files[0],item_id:'read-1'}, {...request.files[0],item_id:'read-2'});
  const result = host(files).run(request);
  assert.deepEqual(result.attachments.map(a=>a.item_id), ['read-0','read-1','read-2']);
  assert.equal(body(result)[0].references.length, 1);
  assert.ok(body(result)[1].references[0].endsWith('/src/second.ts#L20-L30'));
  assert.equal(result.attachments[0].text, result.attachments[2].text);
});
test('a failed file keeps diagnostics local and preserves successful siblings', () => {
  const request = input(); request.operation = 'read_many';
  request.files.push({...request.files[0], item_id:'read-1',path:'knowledge/missing.md'});
  const result = host(fixtures()).run(request);
  assert.equal(refs(result).length, 1);
  assert.equal(result.attachments[1].item_id, 'read-1');
  assert.ok(parse(result.attachments[1].text).diagnostics.length);
});
test('partial references preserve siblings and identify missing registration', () => {
  const result = host(fixtures([reference(), reference('repo:20260901/missing')])).run(input());
  assert.equal(refs(result).length, 1);
  assert.equal(issues(result)[0].code, 'SOURCE_UNRESOLVED');
  assert.equal(issues(result)[0].source_ref, 'repo:20260901/missing');
  assert.equal('status' in result, false);
});
test('missing and invalid metadata are not zero matches; host errors are sanitized', () => {
  for (const bad of [undefined, 'articles: [', JSON.stringify({ schema_version: 'unknown', articles: [] })]) {
    const files = fixtures();
    if (bad === undefined) delete files['knowledge/structure.yaml']; else files['knowledge/structure.yaml'] = bad;
    const result = host(files).run(input());
    assert.equal(issues(result)[0].code, 'EVIDENCE_UNAVAILABLE');
    assert.equal(JSON.stringify(result).includes('private host'), false);
  }
});
test('ambiguous sources and unsafe paths do not create evidence', () => {
  for (const change of [r => r.sources[0].modules.push(r.sources[0].modules[0]), r => r.sources[0].modules[0].subpath = '../escape', r => r.sources[0].modules[0].git.remote = 'https://user:secret@example.org/repo']) {
    const files = fixtures();
    const changed = structuredClone(repo); change(changed);
    files['sources/repo/index.yaml'] = JSON.stringify(changed);
    const result = host(files).run(input());
    assert.equal(refs(result).length, 0);
    assert.equal(issues(result)[0].code, 'SOURCE_UNRESOLVED');
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
  const h = host(fixtures());
  assert.ok(issues(h.run(input(2, 2, { workspace_root: '../escape' }))).length);
  assert.equal(h.calls.length, 0);
});
test('CRLF, fences and entity-encoded IDs follow section semantics', () => {
  const content = '```md\r\n<!-- context:section id="fake" -->\r\n```\r\n<!-- context:section id="first" -->\r\nbody\r\n~~~\r\n<!-- /context:section -->\r\n~~~\r\n<!-- /context:section -->';
  const files = fixtures(); files['knowledge/example.md'] = content;
  assert.equal(refs(host(files).run(input(5, 5))).length, 1);
  assert.deepEqual(host(files).run(input(2, 2)), { attachments: [] });
  files['knowledge/example.md'] = '<!-- context:section id="a&amp;b" -->\nbody\n<!-- /context:section -->';
  const map = structure(); map.articles[0].sections[0].id = 'a&b';
  files['knowledge/structure.yaml'] = JSON.stringify(map);
  assert.equal(refs(host(files).run(input())).length, 1);
});
test('malformed and duplicate article markers are diagnosed', () => {
  for (const content of ['<!-- context:section id="first" -->', '<!-- /context:section -->', `${article}\n${article}`, '<!-- context:section bad -->']) {
    const files = fixtures(); files['knowledge/example.md'] = content;
    assert.ok(issues(host(files).run(input())).length);
  }
});
test('file, document, note and session sources retain their distinct locations', () => {
  const references = ['file:20260901/input', 'lark:20260901/doc', 'note:20260901/note.md', 'sessions:20260901/session.md'].map(reference);
  const files = fixtures(references);
  files['sources/file/index.yaml'] = JSON.stringify({ sources: [{ name: '20260901', modules: [{ name: 'input' }] }] });
  files['sources/lark/index.yaml'] = JSON.stringify({ sources: [{ name: '20260901', modules: [{ name: 'doc', url: 'https://example.org/doc/1' }] }] });
  files['sources/note/20260901/note.md'] = 'saved note';
  files['sources/sessions/20260901/session.md'] = 'saved session';
  const result = host(files).run(input());
  assert.deepEqual(issues(result), []);
  assert.equal(refs(result)[0].manifest, 'sources/file/20260901/manifest.json');
  assert.equal(refs(result)[1].url, 'https://example.org/doc/1');
  assert.equal(refs(result)[2].materialized_at, 'sources/note/20260901/note.md');
});
test('legacy unmarked articles and non-knowledge files do not invent sections', () => {
  const files = fixtures(); files['knowledge/example.md'] = '# Legacy\nPlain text';
  assert.deepEqual(host(files).run(input()), { attachments: [] });
  const request = input(); request.files[0].path = 'src/file.ts';
  const h = host(files); assert.deepEqual(h.run(request), { attachments: [] }); assert.equal(h.calls.length, 0);
});
test('invalid args and unsupported operations are contained', () => {
  const defaultArgs = input(); defaultArgs.args = null;
  assert.equal(refs(host(fixtures()).run(defaultArgs)).length, 1);
  assert.ok(issues(host(fixtures()).run(input(2, 2, { extra: true }))).length);
  const request = input(); request.operation = 'execute';
  assert.ok(issues(host(fixtures()).run(request)).length);
});

test('duplicate keys, recursive aliases and excessive YAML depth fail without false evidence', () => {
  for (const yaml of [
    'schema_version: context.approved-structure.v1\narticles: []\narticles: []',
    'schema_version: context.approved-structure.v1\narticles: &loop [*loop]',
    `schema_version: context.approved-structure.v1\narticles: ${'['.repeat(200)}0${']'.repeat(200)}`,
  ]) {
    const files = fixtures(); files['knowledge/structure.yaml'] = yaml;
    const result = host(files).run(input());
    assert.ok(issues(result).length);
    assert.deepEqual(refs(result), []);
  }
});
test('oversized metadata and output preserve valid diagnostic JSON', () => {
  const files = fixtures(); files['knowledge/structure.yaml'] = ' '.repeat(8 * 1024 * 1024 + 1);
  assert.ok(issues(host(files).run(input())).length);
  const refs = Array.from({ length: 1300 }, (_, i) => ({ ...reference(), locator: { path: `src/file-${i}.ts`, start_line: 1, end_line: 1 } }));
  assert.equal(issues(host(fixtures(refs)).run(input()))[0].code, 'OUTPUT_LIMIT');
});
test('representative metadata volume is cached without returning the catalog', () => {
  const files = fixtures(); const map = structure();
  for (let i = 0; i < 220; i++) {
    map.articles.push({ article_id: `other-${i}`, path: `other-${i}.md`, collection: 'architecture', visibility: 'public',
      sections: Array.from({ length: 7 }, (_, j) => ({ id: `s-${j}`, references: [reference(), reference(), reference()] })) });
  }
  files['knowledge/structure.yaml'] = JSON.stringify(map);
  const h = host(files); const result = h.run(input());
  assert.equal(result.attachments.length, 1);
  assert.ok(JSON.stringify(result).length < 1000);
  const reads = h.calls.length;
  for (let i = 0; i < 25; i++) assert.deepEqual(h.run(input()), result);
  assert.equal(h.calls.length, reads);
});
