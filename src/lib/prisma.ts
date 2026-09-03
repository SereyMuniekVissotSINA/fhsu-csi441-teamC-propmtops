import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 talks to the database through a driver adapter. For SQLite that is
// better-sqlite3; swap this out (and the datasource in prisma/schema.prisma)
// if the project ever moves to Postgres.
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL ?? "file:./dev.db",
    }),
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });

// Next.js clears the module cache on every hot reload in dev, which would open
// a new connection each time. Cache the client on globalThis to avoid that.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
