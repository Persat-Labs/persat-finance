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
    // Always same-origin proxy so browser never hits cross-origin CORS on api.*
    // Prefer explicit proxy target, then public API, then local Node.
    const upstream =
      process.env.API_PROXY_TARGET ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      "https://api.persat.finance";
    const base = upstream.replace(/\/$/, "") || "https://api.persat.finance";
    return [
      { source: "/v1/:path*", destination: `${base}/v1/:path*` },
      { source: "/health", destination: `${base}/health` },
    ];
  },
};

export default nextConfig;
