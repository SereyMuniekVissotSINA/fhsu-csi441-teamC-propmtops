import { z } from "zod";

// Environment validation.
//
// In production a misconfigured deploy must fail loudly and immediately. In
// development it must NOT: the app is expected to run before any secrets exist,
// so `/` and `/demo` keep working and the pages that need configuration render
// a "not configured" panel instead of a stack trace. Throwing here at module
// evaluation would take down every route that transitively imports `@/auth`.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.url().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // OAuth is opt-in. Each pair is validated together in `auth-providers.ts`;
  // absent credentials simply mean that provider is not offered.
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
});

const result = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  AUTH_URL: process.env.AUTH_URL,
  NODE_ENV: process.env.NODE_ENV,
  AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
  AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
  AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
  AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
});

if (!result.success) {
  const missing = result.error.issues.map((issue) => issue.path.join(".")).join(", ");

  if (process.env.NODE_ENV === "production") {
    throw new Error(`Missing or invalid environment variables: ${missing}`);
  }

  console.warn(
    `\n⚠️  Environment not configured: ${missing}\n` +
      `   Copy .env.example to .env and fill it in. The demo at /demo still works.\n`,
  );
}

export const env = result.success ? result.data : null;

/** True when everything required to sign users in is present. */
export function isAuthConfigured(): boolean {
  return result.success;
}
