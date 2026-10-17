/** Test-only real repositories; no repository hooks or signing commands run. */
import { execFileSync } from 'node:child_process';

export function fixtureGit(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
}

export function commitFixture(dir: string): string {
  fixtureGit(dir, 'init', '-q');
  fixtureGit(dir, 'add', '--all');
  fixtureGit(dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture', '--allow-empty');
  return fixtureGit(dir, 'rev-parse', 'HEAD');
}
