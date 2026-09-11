import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthzError } from "@/lib/authz";

// Shared response shapes so every route answers the same way. The 422 body
// matches what `/api/register` and `/api/prompts` already returned before the
// backend was wired up, so existing callers keep working.

export function invalid(error: z.ZodError) {
  return NextResponse.json(
    { error: "Invalid input", issues: z.treeifyError(error) },
    { status: 422 },
  );
}

export function failure(error: unknown) {
  if (error instanceof AuthzError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  // Anything else is a bug or a database that isn't there. Log it server-side
  // and keep the internals out of the response.
  console.error(error);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

/** Parse a JSON body without throwing on malformed input. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
