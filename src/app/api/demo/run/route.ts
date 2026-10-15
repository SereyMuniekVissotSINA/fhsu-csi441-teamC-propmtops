import { NextResponse } from "next/server";
import { z } from "zod";

import { invalid, readJson } from "@/lib/api";
import { runOpenAI } from "@/lib/openai-run";

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

  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const key = (baseUrl ? process.env.LLM_API_KEY : process.env.OPENAI_API_KEY)?.trim() ?? "";
  const model = (baseUrl ? process.env.LLM_MODEL : process.env.OPENAI_MODEL)?.trim();
  if ((!baseUrl && !key) || !model) {
    return NextResponse.json(
      { error: "Configure LLM_MODEL for 9Router, or OPENAI_API_KEY and OPENAI_MODEL for direct OpenAI, then restart the development server." },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(await runOpenAI(parsed.data.input, key, model, baseUrl));
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
