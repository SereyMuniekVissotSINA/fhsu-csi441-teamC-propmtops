// Single source of truth for which OAuth providers are actually usable.
//
// `src/auth.ts` uses this to decide what to register, and the login page uses
// it to decide what to render. Sharing one function means a provider can never
// show up as a button without working credentials behind it.

export const oauthProviders = [
  { id: "github", label: "GitHub", env: ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"] },
  { id: "google", label: "Google", env: ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] },
] as const;

export type OAuthProviderId = (typeof oauthProviders)[number]["id"];

export function isConfigured(provider: (typeof oauthProviders)[number]): boolean {
  // Both halves of the pair must be present — a client id with no secret is a
  // broken button, not a working provider.
  return provider.env.every((key) => (process.env[key] ?? "").length > 0);
}

export function configuredOAuthProviders() {
  return oauthProviders.filter(isConfigured);
}
