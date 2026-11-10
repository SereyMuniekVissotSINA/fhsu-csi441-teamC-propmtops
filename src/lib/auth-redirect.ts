/** Only dashboard paths are valid post-authentication destinations. */
export function authRedirect(value: unknown): string {
  if (typeof value !== "string" || /[\\\x00-\x20]/.test(value)) return "/dashboard";
  try {
    const base = "https://promptops.invalid";
    const url = new URL(value, base);
    if (url.origin !== base || !value.startsWith("/")) return "/dashboard";
    if (url.pathname !== "/dashboard" && !url.pathname.startsWith("/dashboard/")) return "/dashboard";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/dashboard";
  }
}
