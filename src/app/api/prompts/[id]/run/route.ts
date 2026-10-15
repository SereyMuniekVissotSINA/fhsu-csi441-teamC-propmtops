import { NextResponse } from "next/server";
import { z } from "zod";
import { failure, invalid, readJson } from "@/lib/api";
import { AuthzError, requireMember, requireSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { runOpenAI } from "@/lib/openai-run";

const inputSchema = z.object({ input: z.string().trim().min(1).max(16000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "LLM testing is available in development only." }, { status: 404 });
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  try {
    await requireSession();
    const { id } = await params;
    const prompt = await prisma.prompt.findUnique({ where: { id }, select: { workspaceId: true } });
    if (!prompt) throw new AuthzError(404, "Prompt not found.");
    await requireMember(prompt.workspaceId, "EDITOR");
    const parsed = inputSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);
    const baseUrl = process.env.LLM_BASE_URL?.trim();
    const key = (baseUrl ? process.env.LLM_API_KEY : process.env.OPENAI_API_KEY)?.trim() ?? "";
    const model = (baseUrl ? process.env.LLM_MODEL : process.env.OPENAI_MODEL)?.trim();
    if ((!baseUrl && !key) || !model) {
      return NextResponse.json({ error: "Configure LLM_MODEL for 9Router, or OPENAI_API_KEY and OPENAI_MODEL for direct OpenAI, then restart the development server." }, { status: 503 });
    }
    try {
      return NextResponse.json(await runOpenAI(parsed.data.input, key, model, baseUrl));
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      return NextResponse.json({ error: timeout ? "LLM request timed out after 60 seconds." : error instanceof Error && /^(OpenAI|LLM)/.test(error.message) ? error.message : "Could not read a response from the LLM provider. Try again." }, { status: timeout ? 504 : 502 });
    }
  } catch (error) {
    return failure(error);
  }
}
