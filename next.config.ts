import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES_EXPORT === 'true';
const githubBasePath = process.env.GITHUB_PAGES_BASE_PATH ?? '/corrige-facil';

const nextConfig: NextConfig = isGitHubPages
  ? {
      output: 'export',
      assetPrefix: githubBasePath,
      trailingSlash: true,
    }
  : {};

export default nextConfig;
