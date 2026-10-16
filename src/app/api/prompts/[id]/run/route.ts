import { NextResponse } from "next/server";
import { z } from "zod";
import { failure, invalid, readJson } from "@/lib/api";
import { requireCallerPrompt, usesBearerKey } from "@/lib/api-auth";
import { PROVIDER_SETUP_MESSAGE, resolveProvider, runOpenAI } from "@/lib/openai-run";

const inputSchema = z.object({ input: z.string().trim().min(1).max(16000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "LLM testing is available in development only." }, { status: 404 });
  }
  // Cookie callers are checked for origin; bearer keys have none to send and
  // nothing to forge.
  if (!usesBearerKey(request) && request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  try {
    const { id } = await params;
    await requireCallerPrompt(request, id, "EDITOR");
    const parsed = inputSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);
    const provider = resolveProvider();
    if (!provider) {
      return NextResponse.json({ error: PROVIDER_SETUP_MESSAGE }, { status: 503 });
    }
    try {
      return NextResponse.json(await runOpenAI(parsed.data.input, provider.key, provider.model, provider.baseUrl));
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      return NextResponse.json({ error: timeout ? "LLM request timed out after 60 seconds." : error instanceof Error && /^(OpenAI|LLM)/.test(error.message) ? error.message : "Could not read a response from the LLM provider. Try again." }, { status: timeout ? 504 : 502 });
    }
  } catch (error) {
    return failure(error);
  }
}
