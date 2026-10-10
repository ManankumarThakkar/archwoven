import { describe, expect, it } from 'vitest';
import { validateRepoUrlInput } from './repo-form';

describe('repo URL field validation (client mirror of parseRepoUrl)', () => {
  it.each([
    'https://github.com/foo/bar',
    'https://github.com/foo/bar.git',
    'https://www.github.com/foo/bar',
    'https://github.com/foo/bar/tree/main',
    'https://github.com/foo/bar/tree/0123456789abcdef/services/api',
  ])('accepts %s', (url) => {
    expect(validateRepoUrlInput(url)).toBeNull();
  });

  it.each([
    '',
    'http://github.com/foo/bar',
    'https://evil.com/foo/bar',
    'https://github.com.evil.com/foo/bar',
    'https://169.254.169.254/latest/meta-data',
    'https://github.com/foo',
    'https://github.com/foo/bar/tree/main/../etc',
    'https://github.com//bar',
  ])('rejects %s with a message', (url) => {
    expect(validateRepoUrlInput(url)).toBeTruthy();
  });
});
