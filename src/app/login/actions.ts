"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { loginSchema } from "@/lib/validations";

export type LoginState = { error?: string };

// Server Action rather than a client-side fetch, per the Next 16 authentication
// guide: credentials never leave the server boundary.
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter a valid email and a password of at least 8 characters." };
  }

  const next = String(formData.get("next") || "/dashboard");

  try {
    // `redirectTo` makes NextAuth throw a redirect on success, which Next
    // handles — so anything past this line only runs when sign-in failed.
    await signIn("credentials", { ...parsed.data, redirectTo: next });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      // Deliberately vague: saying "no such user" would confirm which addresses
      // are registered.
      return { error: "Email or password is incorrect." };
    }
    // A redirect is signalled by a thrown control-flow error; let it through.
    throw error;
  }
}

export async function oauthSignInAction(formData: FormData) {
  const provider = String(formData.get("provider"));
  const next = String(formData.get("next") || "/dashboard");
  await signIn(provider, { redirectTo: next });
}
