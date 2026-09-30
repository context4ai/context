import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Verifies the actual package projection with Node, not a source-mode installer.
const archive = process.argv[2];
if (!archive) throw new Error('Pass the CLI tarball path');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)), '.tmp/evidence-artifact');
mkdirSync(root, { recursive: true });
const work = mkdtempSync(join(root, 'case-'));
execFileSync('tar', ['-xzf', resolve(archive), '-C', work]);
const packageRoot = join(work, 'package');
const runtimeRoot = existsSync(join(packageRoot, 'cli.js')) ? packageRoot : join(packageRoot, 'dist');
const cli = join(runtimeRoot, 'cli.js');
const artifact = join(runtimeRoot, 'evidence/context-evidence.sourcegraph.wasm');
const bytes = readFileSync(artifact);
const project = join(work, 'knowledge-repo');
mkdirSync(join(project, '.git'), { recursive: true });
const env = { ...process.env, PATH: join(work, 'no-executables'), CONTEXT_RUNTIME_EVENTS_DISABLED: '1' };
const run = () => JSON.parse(execFileSync(process.execPath, [cli, 'evidence', 'install', project, '--format', 'json'], { encoding: 'utf8', env }));
assert.equal(run().status, 'installed');
assert.deepEqual(readFileSync(join(project, 'context-evidence.sourcegraph.wasm')), bytes);
assert.equal(run().status, 'unchanged');
assert.ok(readFileSync(join(runtimeRoot, 'evidence/THIRD-PARTY-NOTICES.txt'), 'utf8').includes('serde'));
console.log(JSON.stringify({ runtime: process.version, wasmBytes: bytes.length, artifactInstall: 'passed', rustAndGitOnPath: false }));
