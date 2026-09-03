import type { DefaultSession } from "next-auth";

import type { Role } from "@/generated/prisma/enums";

// Teach Auth.js about the extra fields the callbacks in `auth.config.ts` put
// on the token and session.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
  }
}

// `next-auth/jwt` only re-exports from `@auth/core/jwt`, so the augmentation
// has to target the module that actually declares the interface.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
