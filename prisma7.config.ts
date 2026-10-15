import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "bunx tsx prisma/seed.ts",
  },
  datasource: {
    // Some cloud providers expose a pooled URL for the app and a direct URL
    // for migrations. A single DATABASE_URL still works for providers that do
    // not make that distinction.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});


