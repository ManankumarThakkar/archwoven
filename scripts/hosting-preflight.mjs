import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Copy only a function's trace, then execute it away from the checkout's node_modules. */
function checkBundle() {
  const route = resolve(root, 'apps/web', process.env.ARCHWOVEN_NEXT_DIST_DIR || '.next', 'server/app/api/hosting-probe/route.js');
  const trace = `${route}.nft.json`;
  const { files } = JSON.parse(readFileSync(trace, 'utf8'));
  const sources = [...new Set([route, ...files.map(file => resolve(dirname(trace), file))])];
  const insideRoot = path => {
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Function trace escaped the repository root');
    if (rel.split('/').some(part => part === '.env' || part.startsWith('.env.'))) throw new Error('Environment file found in function trace');
    return rel;
  };
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
    if (bytes > 250 * 1024 * 1024) throw new Error('Traced function exceeds the standard 250 MB bundle limit');
    const token = randomBytes(32).toString('hex');
    const worker = `
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
    `;
    const result = spawnSync(process.execPath, ['-e', worker, join(staging, insideRoot(route))], {
      cwd: staging,
      // Do not inherit provider credentials, NODE_PATH or NODE_OPTIONS.
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'preview',
        ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_HOSTING_PROBE: '1',
        ARCHWOVEN_HOSTING_PROBE_TOKEN: token,
      },
      encoding: 'utf8', timeout: 35_000,
    });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Isolated function check failed');
    console.log(`Traced function: ${sources.length} entries, ${(bytes / 1024 / 1024).toFixed(2)} MiB (before platform wrappers).`);
    console.log(result.stdout.trim());
  } finally { rmSync(staging, { recursive: true, force: true }); }
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
