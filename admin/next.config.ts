import { withPayload } from '@payloadcms/next/withPayload';
import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // A self-contained server with only the files it needs: the hosting allows 150 000 files.
  output: 'standalone',
  // Keep cabinet assets under the PHP gateway while preserving /admin and /api on the admin host.
  assetPrefix: '/cabinet',
  skipTrailingSlashRedirect: true,
  rewrites: async () => ({
    beforeFiles: [{ source: '/cabinet/_next/:path*', destination: '/_next/:path*' }],
  }),
  serverExternalPackages: ['teleproto', 'big-integer'],
  // The panel is the only page; the site itself lives elsewhere.
  redirects: async () => [{ source: '/', destination: '/admin', permanent: false }],
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return webpackConfig;
  },
  turbopack: { root: path.resolve(dirname) },
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
