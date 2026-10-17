/** Shared pre-scan exclusions for scope validation, local traversal and archives. */
const VENDOR_SEGMENTS = new Set(['node_modules', 'target', 'build', '.git', '.gradle', '__pycache__', 'venv', '.venv', 'vendor', 'vendors', 'third_party', 'third-party', 'dist', 'out', 'coverage', 'htmlcov', 'generated', '__generated__', '.cache', '.turbo', '.output', '.svelte-kit', '.vite', '.parcel-cache', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox']);
const VENDOR_FILES = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|Gemfile\.lock)$/;
const VENDOR_EXT = /\.(min\.(js|css)|class|jar|war|ear|woff2?|ttf|eot|so|dylib|dll|exe|lock)$/i;

export const isVendor = (rel: string): boolean => {
  const parts = rel.split('/');
  return parts.some((p) => VENDOR_SEGMENTS.has(p.toLowerCase()) || /^\.(?:next|nuxt)(?:[.-]|$)/i.test(p)) || /\.(?:generated(?:\.[^./]+)+|tsbuildinfo|(?:js|css)\.map)$/i.test(rel) || VENDOR_FILES.test(parts[parts.length - 1]!) || VENDOR_EXT.test(rel);
};
