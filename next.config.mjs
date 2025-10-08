/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
};

const isGitHubPages = process.env.GITHUB_PAGES === "true";

if (isGitHubPages) {
  nextConfig.output = "export";
  nextConfig.basePath = "/marumie";
  nextConfig.assetPrefix = "/marumie/";
}

export default nextConfig;
