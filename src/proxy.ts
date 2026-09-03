import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

// Next 16 renamed the `middleware` convention to `proxy`.
// Only the edge-safe config is booted here — see `src/auth.config.ts`.
export const { auth: proxy } = NextAuth(authConfig);

export default proxy;

export const config = {
  // Skip Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
