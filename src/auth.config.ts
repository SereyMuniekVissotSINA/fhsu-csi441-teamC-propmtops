import type { NextAuthConfig } from "next-auth";

// Edge-safe half of the config: no Prisma, no bcryptjs. `src/middleware.ts`
// boots NextAuth from this alone so it can run on the edge runtime.
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // `user` is only present on the sign-in pass; later calls just carry the
      // token through. Auth.js types `user.id` as optional, hence the guard.
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      if (token.role) session.user.role = token.role;
      return session;
    },
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const isOnProtected = request.nextUrl.pathname.startsWith("/dashboard");

      if (isOnProtected) return isLoggedIn;
      return true;
    },
  },
} satisfies NextAuthConfig;
