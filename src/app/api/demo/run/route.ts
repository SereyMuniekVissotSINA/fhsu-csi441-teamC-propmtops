import { NextResponse } from "next/server";
import { z } from "zod";

import { invalid, readJson } from "@/lib/api";
import { PROVIDER_SETUP_MESSAGE, resolveProvider, runOpenAI } from "@/lib/openai-run";

const inputSchema = z.object({ input: z.string().trim().min(1).max(16000) });
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== "development" || !loopbackHosts.has(url.hostname)) {
    return NextResponse.json({ error: "Demo AI testing is available locally in development only." }, { status: 404 });
  }
  if (request.headers.get("origin") !== url.origin) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  const parsed = inputSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalid(parsed.error);

  const provider = resolveProvider();
  if (!provider) {
    return NextResponse.json({ error: PROVIDER_SETUP_MESSAGE }, { status: 503 });
  }

  try {
    return NextResponse.json(
      await runOpenAI(parsed.data.input, provider.key, provider.model, provider.baseUrl),
    );
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    const safeMessage =
      error instanceof Error && /^(OpenAI|LLM)/.test(error.message)
        ? error.message
        : "Could not read a response from the LLM provider. Try again.";
    return NextResponse.json(
      { error: timeout ? "LLM request timed out after 60 seconds." : safeMessage },
      { status: timeout ? 504 : 502 },
    );
  }
}
