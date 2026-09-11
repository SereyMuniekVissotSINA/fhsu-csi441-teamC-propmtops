import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { authConfig } from "@/auth.config";
import { configuredOAuthProviders } from "@/lib/auth-providers";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations";

// Importing this here is what makes the env validation in `src/lib/env.ts`
// actually run. It stays out of `auth.config.ts` and `proxy.ts`, which boot on
// the edge where it must not be pulled in.
import "@/lib/env";

// `allowDangerousEmailAccountLinking` lets someone who registered with a
// password later sign in with GitHub/Google on the same address, instead of
// hitting an `OAuthAccountNotLinked` dead end. It is only safe because both of
// these providers verify email ownership; do NOT copy the flag to a provider
// that does not, or an unverified address becomes an account takeover.
const linkByVerifiedEmail = true;

// Only register the OAuth providers whose credentials are present, so a missing
// secret means "not offered" rather than a provider that throws at sign-in.
const oauth: NextAuthConfig["providers"] = configuredOAuthProviders().map(
  (provider) =>
    provider.id === "github"
      ? GitHub({
          clientId: process.env.AUTH_GITHUB_ID,
          clientSecret: process.env.AUTH_GITHUB_SECRET,
          allowDangerousEmailAccountLinking: linkByVerifiedEmail,
        })
      : Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          allowDangerousEmailAccountLinking: linkByVerifiedEmail,
        }),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  // The Prisma adapter cannot run on the edge, so sessions stay as JWTs and the
  // adapter is only used for account/user persistence.
  session: { strategy: "jwt" },
  providers: [
    ...oauth,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
});
