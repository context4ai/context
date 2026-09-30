import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
  return { operation: 'read', args, files: [{ path: 'knowledge/example.md', start_line: start, end_line: end, content: article.split('\n').slice(start - 1, end).join('\n'), truncated: false }] };
}
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
  assert.equal(metadata.abi_version, 1);
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
    const map = structure(); map.articles[0].sections = (item.ids ?? []).map(id => ({ id, references: [] }));
    files['knowledge/structure.yaml'] = JSON.stringify(map);
    const result = host(files).run(input(1, item.text.split('\n').length));
    if (item.error) assert.ok(result.issues); else assert.deepEqual(result.sections.map(s => s.section_id), item.ids);
  }
});
test('joins exact returned section with registered source, not knowledge revision', () => {
  const h = host(fixtures());
  const result = h.run(input());
  assert.deepEqual(result, { sections: [{ path: 'knowledge/example.md', section_id: 'first', references: [{ url: `https://example.org/team/source/blob/${'b'.repeat(40)}/module/src/example.ts#L3-L9` }] }] });
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.run(input()), result);
  assert.equal(h.calls.length, 3, 'warm instance does not reread immutable metadata');
  assert.equal(h.run(input(6, 6)).sections[0].section_id, 'second');
});
test('optional digest and monorepo root', () => {
  const files = Object.fromEntries(Object.entries(fixtures()).map(([p, v]) => [`docs/${p}`, v]));
  const request = input(2, 2, { workspace_root: 'docs', include_digest: true });
  request.files[0].path = 'docs/knowledge/example.md';
  assert.equal(host(files).run(request).sections[0].references[0].content_digest, reference().content_digest);
});
test('source URLs encode file segments and normalize credential-free Git transports', () => {
  for (const remote of ['https://github.com/team/source.git', 'git@github.com:team/source.git', 'ssh://git@github.com/team/source.git']) {
    const ref = reference(); ref.locator = { path: 'src/a #中文%.ts', start_line: 3, end_line: 3 };
    const files = fixtures([ref]); const registry = structuredClone(repo);
    registry.sources[0].modules[0].git.remote = remote;
    files['sources/repo/index.yaml'] = JSON.stringify(registry);
    assert.deepEqual(host(files).run(input()).sections[0].references, [{url:`https://github.com/team/source/blob/${'b'.repeat(40)}/module/src/a%20%23%E4%B8%AD%E6%96%87%25.ts#L3`}]);
  }
});
test('unsupported routes and nonimmutable revisions keep lossless structured evidence', () => {
  for (const [remote, revision] of [['https://bitbucket.org/team/source','b'.repeat(40)], ['ssh://git@example.org:2222/team/source','b'.repeat(40)], ['https://example.org/team/source','main'], ['https://example.org/team/source','abc1234']]) {
    const files=fixtures(); const registry=structuredClone(repo);
    registry.sources[0].modules[0].git={remote,ref:revision};files['sources/repo/index.yaml']=JSON.stringify(registry);
    const result=host(files).run(input()).sections[0].references[0];
    assert.equal(result.url,undefined);assert.equal(result.remote,remote);assert.equal(result.ref,revision);assert.equal(result.path,'module/src/example.ts');assert.equal(result.source_ref,source);
  }
});
test('batch reads do not repeat metadata or leak previous output', () => {
  const h = host(fixtures());
  const request = input();
  request.operation = 'read_many';
  request.files.push(input(6, 6).files[0]);
  assert.equal(h.run(request).sections.length, 2);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.run({ operation: 'read_many', files: [] }), { sections: [] });
});
test('partial references preserve siblings and identify missing registration', () => {
  const result = host(fixtures([reference(), reference('repo:20260901/missing')])).run(input());
  assert.equal(result.sections[0].references.length, 1);
  assert.equal(result.issues[0].code, 'SOURCE_UNRESOLVED');
  assert.equal(result.issues[0].source_ref, 'repo:20260901/missing');
  assert.equal('status' in result, false);
});
test('missing and invalid metadata are not zero matches; host errors are sanitized', () => {
  for (const bad of [undefined, 'articles: [', JSON.stringify({ schema_version: 'unknown', articles: [] })]) {
    const files = fixtures();
    if (bad === undefined) delete files['knowledge/structure.yaml']; else files['knowledge/structure.yaml'] = bad;
    const result = host(files).run(input());
    assert.equal(result.issues[0].code, 'EVIDENCE_UNAVAILABLE');
    assert.equal(JSON.stringify(result).includes('private host'), false);
  }
});
test('ambiguous sources and unsafe paths do not create evidence', () => {
  for (const change of [r => r.sources[0].modules.push(r.sources[0].modules[0]), r => r.sources[0].modules[0].subpath = '../escape', r => r.sources[0].modules[0].git.remote = 'https://user:secret@example.org/repo']) {
    const files = fixtures();
    const changed = structuredClone(repo); change(changed);
    files['sources/repo/index.yaml'] = JSON.stringify(changed);
    const result = host(files).run(input());
    assert.equal(result.sections[0].references.length, 0);
    assert.equal(result.issues[0].code, 'SOURCE_UNRESOLVED');
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
  const h = host(fixtures());
  assert.ok(h.run(input(2, 2, { workspace_root: '../escape' })).issues);
  assert.equal(h.calls.length, 0);
});
test('CRLF, fences and entity-encoded IDs follow section semantics', () => {
  const content = '```md\r\n<!-- context:section id="fake" -->\r\n```\r\n<!-- context:section id="first" -->\r\nbody\r\n~~~\r\n<!-- /context:section -->\r\n~~~\r\n<!-- /context:section -->';
  const files = fixtures(); files['knowledge/example.md'] = content;
  assert.equal(host(files).run(input(5, 5)).sections[0].section_id, 'first');
  assert.deepEqual(host(files).run(input(2, 2)), { sections: [] });
  files['knowledge/example.md'] = '<!-- context:section id="a&amp;b" -->\nbody\n<!-- /context:section -->';
  const map = structure(); map.articles[0].sections[0].id = 'a&b';
  files['knowledge/structure.yaml'] = JSON.stringify(map);
  assert.equal(host(files).run(input()).sections[0].section_id, 'a&b');
});
test('malformed and duplicate article markers are diagnosed', () => {
  for (const content of ['<!-- context:section id="first" -->', '<!-- /context:section -->', `${article}\n${article}`, '<!-- context:section bad -->']) {
    const files = fixtures(); files['knowledge/example.md'] = content;
    assert.ok(host(files).run(input()).issues);
  }
});
test('file, document, note and session sources retain their distinct locations', () => {
  const refs = ['file:20260901/input', 'lark:20260901/doc', 'note:20260901/note.md', 'sessions:20260901/session.md'].map(reference);
  const files = fixtures(refs);
  files['sources/file/index.yaml'] = JSON.stringify({ sources: [{ name: '20260901', modules: [{ name: 'input' }] }] });
  files['sources/lark/index.yaml'] = JSON.stringify({ sources: [{ name: '20260901', modules: [{ name: 'doc', url: 'https://example.org/doc/1' }] }] });
  files['sources/note/20260901/note.md'] = 'saved note';
  files['sources/sessions/20260901/session.md'] = 'saved session';
  const result = host(files).run(input());
  assert.equal(result.issues, undefined);
  assert.equal(result.sections[0].references[0].manifest, 'sources/file/20260901/manifest.json');
  assert.equal(result.sections[0].references[1].url, 'https://example.org/doc/1');
  assert.equal(result.sections[0].references[2].materialized_at, 'sources/note/20260901/note.md');
});
test('legacy unmarked articles and non-knowledge files do not invent sections', () => {
  const files = fixtures(); files['knowledge/example.md'] = '# Legacy\nPlain text';
  assert.deepEqual(host(files).run(input()), { sections: [] });
  const request = input(); request.files[0].path = 'src/file.ts';
  const h = host(files); assert.deepEqual(h.run(request), { sections: [] }); assert.equal(h.calls.length, 0);
});
test('invalid args and unsupported operations are contained', () => {
  const defaultArgs = input(); defaultArgs.args = null;
  assert.equal(host(fixtures()).run(defaultArgs).sections[0].section_id, 'first');
  assert.ok(host(fixtures()).run(input(2, 2, { extra: true })).issues);
  const request = input(); request.operation = 'execute';
  assert.ok(host(fixtures()).run(request).issues);
});

test('duplicate keys, recursive aliases and excessive YAML depth fail without false evidence', () => {
  for (const yaml of [
    'schema_version: context.approved-structure.v1\narticles: []\narticles: []',
    'schema_version: context.approved-structure.v1\narticles: &loop [*loop]',
    `schema_version: context.approved-structure.v1\narticles: ${'['.repeat(200)}0${']'.repeat(200)}`,
  ]) {
    const files = fixtures(); files['knowledge/structure.yaml'] = yaml;
    const result = host(files).run(input());
    assert.ok(result.issues);
    assert.deepEqual(result.sections, []);
  }
});
test('oversized metadata and output preserve valid diagnostic JSON', () => {
  const files = fixtures(); files['knowledge/structure.yaml'] = ' '.repeat(8 * 1024 * 1024 + 1);
  assert.ok(host(files).run(input()).issues);
  const refs = Array.from({ length: 1300 }, (_, i) => ({ ...reference(), locator: { path: `src/file-${i}.ts`, start_line: 1, end_line: 1 } }));
  assert.equal(host(fixtures(refs)).run(input()).issues[0].code, 'OUTPUT_LIMIT');
});
test('representative metadata volume is cached without returning the catalog', () => {
  const files = fixtures(); const map = structure();
  for (let i = 0; i < 220; i++) {
    map.articles.push({ article_id: `other-${i}`, path: `other-${i}.md`, collection: 'architecture', visibility: 'public',
      sections: Array.from({ length: 7 }, (_, j) => ({ id: `s-${j}`, references: [reference(), reference(), reference()] })) });
  }
  files['knowledge/structure.yaml'] = JSON.stringify(map);
  const h = host(files); const result = h.run(input());
  assert.equal(result.sections.length, 1);
  assert.ok(JSON.stringify(result).length < 1000);
  const reads = h.calls.length;
  for (let i = 0; i < 25; i++) assert.deepEqual(h.run(input()), result);
  assert.equal(h.calls.length, reads);
});
