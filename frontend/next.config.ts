import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentUpgrade: "security",
  },
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: [
    "10.*.*.*",
    "192.168.*.*",
    ...Array.from({ length: 16 }, (_, index) => `172.${index + 16}.*.*`),
  ],
};

export default nextConfig;
