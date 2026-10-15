import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 talks to PostgreSQL through a driver adapter. Constructing the
// adapter does not open a connection; pages that need the backend probe it in
// backend-status.ts and show the setup panel if DATABASE_URL is absent/bad.
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL ?? ""),
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });

// Next.js clears the module cache on every hot reload in dev, which would open
// a new connection each time. Cache the client on globalThis to avoid that.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
