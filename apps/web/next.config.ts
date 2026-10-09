import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@archwoven/model', '@archwoven/ingest'],
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
