/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Native addons (resvg) and heavy pure-JS (satori) must not be bundled by
  // webpack — keep them external so the server loads them from node_modules.
  serverExternalPackages: ["@resvg/resvg-js", "satori"],
  experimental: {
    // Allow long-running work via after() in route handlers (ingestion worker).
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
