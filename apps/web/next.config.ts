import type { NextConfig } from 'next';
import { join } from 'node:path';

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/api/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      // Versioned film assets can be reused across repeat visits. Bump the version when replacing them.
      { source: '/media/archwoven-overview-v1.:ext(mp4|jpg)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
  // Pin the monorepo root, even when a parent folder has another lockfile.
  outputFileTracingRoot: join(__dirname, '../..'),
  // The extractor is an external esbuild bundle, so NFT cannot follow its
  // createRequire() grammar lookup or the parser's own WASM, which its CommonJS
  // build (what Vercel's loader requires) finds beside itself. Include only these runtime assets.
  outputFileTracingIncludes: {
    '/api/**/*': [
      '../../node_modules/.pnpm/web-tree-sitter@*/node_modules/web-tree-sitter/web-tree-sitter.wasm',
      '../../packages/extract/node_modules/tree-sitter-java/package.json',
      '../../packages/extract/node_modules/tree-sitter-java/tree-sitter-java.wasm',
      '../../packages/extract/node_modules/tree-sitter-python/package.json',
      '../../packages/extract/node_modules/tree-sitter-python/tree-sitter-python.wasm',
    ],
  },
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
