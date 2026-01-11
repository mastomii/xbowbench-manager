import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Reduce bundle size
  experimental: {
    optimizePackageImports: ['lucide-react', 'react-markdown'],
  },
};

export default nextConfig;
