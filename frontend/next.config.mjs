/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  swcMinify: true,
  experimental: {
    optimizePackageImports: ["@solana/web3.js", "@solana/spl-token"],
  },
  // Allow Arena E2B preview origins for virtual environment
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"],
  /**
   * Same-origin API proxy — browser calls /v1/* and /health on the dApp host.
   * Avoids CORS and works when NEXT_PUBLIC_BACKEND_URL is empty (Mode W local).
   * Production: set NEXT_PUBLIC_BACKEND_URL to https://api.persat.finance OR keep
   * rewrites pointed at the API upstream.
   */
  async rewrites() {
    const upstream = process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:4000";
    // If frontend already talks to an absolute public API, skip local proxy
    if (upstream.startsWith("https://api.persat.finance")) {
      return [];
    }
    const base = upstream.replace(/\/$/, "");
    return [
      { source: "/v1/:path*", destination: `${base}/v1/:path*` },
      { source: "/health", destination: `${base}/health` },
    ];
  },
};

export default nextConfig;
