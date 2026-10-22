import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root: this project sits under a parent directory that
    // also holds a lockfile, which Turbopack would otherwise infer as the root.
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
