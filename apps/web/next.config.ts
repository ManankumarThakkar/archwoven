import type { NextConfig } from 'next';
import { join } from 'node:path';

const nextConfig: NextConfig = {
  // Pin the monorepo root, even when a parent folder has another lockfile.
  outputFileTracingRoot: join(__dirname, '../..'),
  // A production build replaces its output directory. Keep development output
  // beside it, so verification cannot remove chunks from an active dev server.
  distDir: process.env.ARCHWOVEN_NEXT_DIST_DIR || (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  transpilePackages: ['@archwoven/model'],
  // tree-sitter needs real Node module resolution (createRequire + WASM on disk) — keep out of webpack bundling
  serverExternalPackages: ['@archwoven/extract', 'web-tree-sitter'],
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime !== 'edge') {
      config.externals = [...(config.externals ?? []), '@archwoven/extract', 'web-tree-sitter'];
    }
    return config;
  },
};

export default nextConfig;
