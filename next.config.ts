import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  // These parsers load workers/fonts from their installed Node.js packages.
  serverExternalPackages: ["pdf-parse", "pdfmake", "mammoth", "exceljs"],
  turbopack: {
    // Pin the workspace root: this project sits under a parent directory that
    // also holds a lockfile, which Turbopack would otherwise infer as the root.
    root: process.cwd(),
  },
};

export default nextConfig;
