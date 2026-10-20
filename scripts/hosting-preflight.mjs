import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const insideRoot = path => {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Function trace escaped the repository root');
  if (rel.split('/').some(part => part === '.env' || part.startsWith('.env.'))) throw new Error('Environment file found in function trace');
  return rel;
};

/**
 * Copy only one route's function trace, then run `worker` against it away from the checkout's
 * node_modules. Vercel's function loader cannot require() ES modules, so neither can this check.
 */
function runTracedRoute(routePath, worker, env) {
  const route = resolve(root, 'apps/web', process.env.ARCHWOVEN_NEXT_DIST_DIR || '.next', `server/app/${routePath}/route.js`);
  const trace = `${route}.nft.json`;
  const { files } = JSON.parse(readFileSync(trace, 'utf8'));
  const sources = [...new Set([route, ...files.map(file => resolve(dirname(trace), file))])];
  const staging = mkdtempSync(join(tmpdir(), 'archwoven-function-'));
  try {
    const links = [];
    let bytes = 0;
    for (const source of sources) {
      const destination = join(staging, insideRoot(source));
      const stat = lstatSync(source);
      if (stat.isSymbolicLink()) {
        const target = resolve(dirname(source), readlinkSync(source));
        links.push([destination, join(staging, insideRoot(target))]);
      } else if (stat.isFile()) {
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(source, destination);
        bytes += stat.size;
      } else throw new Error('Unexpected directory in function trace');
    }
    for (const [destination, target] of links) {
      mkdirSync(dirname(destination), { recursive: true });
      symlinkSync(relative(dirname(destination), target), destination);
    }
    if (bytes > 250 * 1024 * 1024) throw new Error(`Traced function ${routePath} exceeds the standard 250 MB bundle limit`);
    const result = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', worker, join(staging, insideRoot(route))], {
      cwd: staging,
      // Do not inherit provider credentials, NODE_PATH or NODE_OPTIONS.
      env: { PATH: process.env.PATH, NODE_ENV: 'production', VERCEL: '1', ...env },
      encoding: 'utf8', timeout: 35_000,
    });
    if (result.status !== 0) throw new Error(`${routePath}: ${result.stderr || result.error?.message || 'isolated function check failed'}`);
    console.log(`Traced function ${routePath}: ${sources.length} entries, ${(bytes / 1024 / 1024).toFixed(2)} MiB (before platform wrappers).`);
    return result.stdout.trim();
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

function checkBundle() {
  const token = randomBytes(32).toString('hex');
  console.log(runTracedRoute('api/hosting-probe', `
    globalThis.fetch = () => { throw new Error('Network access is forbidden'); };
    const { routeModule } = require(process.argv[1]);
    (async () => {
      const response = await routeModule.userland.GET(new Request('https://preview.example/api/hosting-probe', {
        headers: { authorization: 'Bearer ' + process.env.ARCHWOVEN_HOSTING_PROBE_TOKEN },
      }));
      const result = await response.json();
      if (response.status !== 200 || result.ok !== true ||
          !['spring', 'fastapi', 'secretScanner'].every(key => result.checks?.[key] === true)) {
        throw new Error('Isolated dependency check failed: ' + JSON.stringify(result));
      }
      console.log(JSON.stringify(result));
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `, { VERCEL_ENV: 'preview', ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_HOSTING_PROBE: '1', ARCHWOVEN_HOSTING_PROBE_TOKEN: token }));

  // An ordinary application route under the normal hosted runtime, which loads the shared server
  // modules (extractors included). Redis is unreachable here, so the visitor's last task is empty.
  console.log(runTracedRoute('api/quota', `
    globalThis.fetch = () => { throw new Error('Network access is forbidden'); };
    const { routeModule } = require(process.argv[1]);
    (async () => {
      const response = await routeModule.userland.GET(new Request('https://archwoven.example/api/quota', { headers: { 'x-vercel-forwarded-for': '203.0.113.9' } }));
      const result = await response.json();
      if (response.status !== 200 || result.pool !== null) throw new Error('Ordinary route check failed: ' + response.status + ' ' + JSON.stringify(result));
      console.log(JSON.stringify({ ok: true, route: '/api/quota', status: response.status }));
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `, {
    VERCEL_ENV: 'production', ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', ANTHROPIC_API_KEY: 'preflight-placeholder-not-a-key',
    UPSTASH_REDIS_REST_URL: 'https://preflight.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'preflight-placeholder-not-a-token',
    ARCHWOVEN_REDIS_PREFIX: 'archwoven-preflight:', ARCHWOVEN_SESSION_SECRET: randomBytes(32).toString('hex'),
  }));
}

async function checkPreview(base) {
  const url = new URL(base);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app') || url.username || url.password) {
    throw new Error('Use the HTTPS Vercel preview URL');
  }
  const token = process.env.ARCHWOVEN_HOSTING_PROBE_TOKEN ?? '';
  if (!/^[\x21-\x7e]{32,256}$/.test(token)) throw new Error('Set ARCHWOVEN_HOSTING_PROBE_TOKEN in your shell');
  const headers = { authorization: `Bearer ${token}` };
  // Optional protection bypass, scoped to this request only. Never put either secret in a URL.
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const response = await fetch(new URL('/api/hosting-probe', url), {
    headers, redirect: 'error', signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error(`Preview probe returned HTTP ${response.status}; check preview configuration and deployment protection`);
  const result = await response.json();
  if (result.ok !== true || !['spring', 'fastapi', 'secretScanner'].every(key => result.checks?.[key] === true)) {
    throw new Error('Preview dependency checks did not all pass');
  }
  console.log(JSON.stringify({ ok: true, checks: result.checks, elapsedMs: result.elapsedMs }));
}

try {
  if (process.argv.length === 2) checkBundle();
  else if (process.argv.length === 4 && process.argv[2] === '--url') await checkPreview(process.argv[3]);
  else throw new Error('Usage: node scripts/hosting-preflight.mjs [--url https://preview.vercel.app]');
} catch (error) {
  console.error(`Hosting preflight failed: ${error.message}`);
  process.exitCode = 1;
}
