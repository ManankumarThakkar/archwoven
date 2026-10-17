#!/usr/bin/env node
// CI-only real Compose smoke: no fake assembly, API key or 13 GB model download.
// An uninstalled model must fail through Ollama, not through the egress guard.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { get as httpGet } from 'node:http';

assert.equal(process.env.CI, 'true', 'Run this disposable Compose smoke in CI, not against your local data.');
const temp = mkdtempSync(join(tmpdir(), 'archwoven-compose-'));
const repo = join(temp, 'repo'), data = join(temp, 'data');
mkdirSync(join(repo, 'src'), { recursive: true }); mkdirSync(data);
writeFileSync(join(repo, 'src/main.ts'), "import { store } from './store';\nexport const app = () => store();\n");
writeFileSync(join(repo, 'src/store.ts'), 'export const store = () => [];\n');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
git('init'); git('add', '.');
git('-c', 'user.name=Smoke test', '-c', 'user.email=smoke@example.invalid', 'commit', '-m', 'Initial smoke fixture');
const sha = git('rev-parse', 'HEAD');
const override = join(temp, 'override.yml');
writeFileSync(override, `services:
  web:
    environment:
      ARCHWOVEN_FAKE: "0"
      OLLAMA_MODEL: archwoven-smoke-model-not-installed
    volumes:
      - ${JSON.stringify(`${data}:/app/data`)}
      - ${JSON.stringify(`${repo}:/repos/smoke:ro`)}
`);
const compose = (...args) => execFileSync('docker', ['compose', '-p', 'archwoven-ci-smoke', '-f', resolve('docker-compose.yml'), '-f', override, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000 });
const base = 'http://127.0.0.1:3000';
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
async function untilReady(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(2_000) }); if (response.ok) return; } catch { /* startup */ }
    await delay(1_000);
  }
  throw new Error(`Service never became ready: ${url}`);
}
try {
  compose('up', '-d', '--no-build');
  await untilReady(`${base}/api/config`);
  await untilReady('http://127.0.0.1:11434/api/tags');
  const config = await (await request('/api/config')).json();
  assert.equal(config.mode, 'local'); assert.equal(config.fake, false);
  // Node's fetch silently replaces a custom Host. Use raw HTTP for this check.
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = httpGet(`${base}/api/config`, { headers: { host: 'evil.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    req.setTimeout(10_000, () => req.destroy(new Error('Host-boundary request timed out')));
    req.on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await request('/api/generate', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal(compose('exec', '-T', 'web', 'git', '-C', '/repos/smoke', 'rev-parse', 'HEAD').trim(), sha);
  const inspected = JSON.parse(execFileSync('docker', ['inspect', compose('ps', '-q', 'web').trim()], { encoding: 'utf8' }))[0];
  assert.equal(inspected.Mounts.find(m => m.Destination === '/repos/smoke')?.RW, false);
  for (const binding of Object.values(inspected.HostConfig.PortBindings).flat()) assert.equal(binding.HostIp, '127.0.0.1');
  const response = await request('/api/repo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ localPath: '/repos/smoke', idempotencyKey: 'compose-smoke' }) });
  assert.equal(response.status, 202, await response.clone().text());
  const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const { jobId } = await response.json(); assert.ok(jobId);
  let job;
  for (let attempt = 0; attempt < 90; attempt++) {
    const polled = await request(`/api/jobs/${jobId}`, { headers: { cookie } });
    assert.equal(polled.status, 200); job = await polled.json();
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) break;
    await delay(1_000);
  }
  assert.equal(job?.status, 'failed', JSON.stringify(job));
  assert.match(job.error, /ollama http 404/i);
  assert.doesNotMatch(job.error, /egress blocked/i);
  assert.equal(job.remaining, null);
  assert.equal((await request(`/api/jobs/${jobId}`)).status, 404, 'Other sessions cannot read the job');
  const retry = await request('/api/repo', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ localPath: '/repos/smoke', idempotencyKey: 'compose-smoke' }) });
  assert.equal(retry.status, 202); assert.notEqual((await retry.json()).jobId, jobId);
  console.log('Compose smoke passed: real startup/SQLite, loopback/Origin protection, read-only Git mount, extraction→Ollama missing-model failure, session ownership and retry. Full model inference remains a separate acceptance check.');
} catch (error) {
  try { console.error(compose('logs', '--no-color', '--tail', '100')); } catch { /* retain original failure */ }
  throw error;
} finally {
  try { compose('down', '--volumes', '--remove-orphans'); } finally { rmSync(temp, { recursive: true, force: true }); }
}
