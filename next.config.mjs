const isGitHubPages = process.env.GITHUB_PAGES === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  output: "export",
  basePath: isGitHubPages ? "/marumie" : undefined,
  assetPrefix: isGitHubPages ? "/marumie/" : undefined,
};

export default nextConfig;
