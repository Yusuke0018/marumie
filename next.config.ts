import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    /**
     * ルートディレクトリに存在する他のlockfileとの干渉を避けるため
     * Turbopackが参照するルートを明示的に指定。
     */
    root: __dirname,
  },
};

export default nextConfig;
