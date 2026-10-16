import { NextResponse } from "next/server";
import { z } from "zod";
import { failure, invalid, readJson } from "@/lib/api";
import { AuthzError, requireMember, requireSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { runOpenAI } from "@/lib/openai-run";
import { FileInputError, fileKind } from "@/lib/file-policy";
import { generateFileRevision } from "@/lib/file-revisions";
import { isAITestingEnabled, listPromptFiles } from "@/lib/prompt-files";
import { revalidatePath } from "next/cache";

const inputSchema = z.object({ input: z.string().trim().min(1).max(16000), fileVersionId: z.string().min(1).max(100).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAITestingEnabled()) {
    return NextResponse.json({ error: "AI testing is not enabled on this server." }, { status: 404 });
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  try {
    await requireSession();
    const { id } = await params;
    const prompt = await prisma.prompt.findUnique({ where: { id }, select: { workspaceId: true } });
    if (!prompt) throw new AuthzError(404, "Prompt not found.");
    const { session } = await requireMember(prompt.workspaceId, "EDITOR");
    const parsed = inputSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);
    const source = parsed.data.fileVersionId ? await prisma.promptFileVersion.findFirst({
      where: { id: parsed.data.fileVersionId, file: { promptId: id } },
      select: { id: true, fileId: true, text: true, file: { select: { name: true } } },
    }) : null;
    if (parsed.data.fileVersionId && !source) throw new AuthzError(404, "File version not found.");
    const baseUrl = process.env.LLM_BASE_URL?.trim();
    const key = (baseUrl ? process.env.LLM_API_KEY : process.env.OPENAI_API_KEY)?.trim() ?? "";
    const model = (baseUrl ? process.env.LLM_MODEL : process.env.OPENAI_MODEL)?.trim();
    if ((!baseUrl && !key) || !model) {
      return NextResponse.json({ error: "Configure LLM_MODEL for 9Router, or OPENAI_API_KEY and OPENAI_MODEL for direct OpenAI, then restart the development server." }, { status: 503 });
    }
    try {
      if (source) {
        const revision = await generateFileRevision(parsed.data.input, {
          name: source.file.name, kind: fileKind(source.file.name), text: source.text,
        }, { key, model, baseUrl });
        // Recheck access after the network call; an editor may have been revoked.
        await requireMember(prompt.workspaceId, "EDITOR");
        const saved = await prisma.$transaction(async tx => {
          // The row update serializes concurrent runs and allocates a unique
          // version number. Every run records its actual source, even if old.
          const file = await tx.promptFile.update({ where: { id: source.fileId }, data: { versionCount: { increment: 1 } } });
          return tx.promptFileVersion.create({ data: {
            fileId: file.id, version: file.versionCount, sourceVersionId: source.id,
            content: new Uint8Array(revision.content), text: revision.text, size: revision.size,
            mimeType: revision.mimeType, instruction: parsed.data.input,
            summary: revision.summary, model: revision.model, authorId: session.user.id,
          }, select: { id: true, version: true } });
        });
        revalidatePath(`/dashboard/prompts/${id}`);
        return NextResponse.json({ output: revision.output, model: revision.model,
          elapsedMs: revision.elapsedMs, usage: revision.usage, incomplete: false,
          fileVersion: saved, files: await listPromptFiles(id),
        });
      }
      return NextResponse.json(await runOpenAI(parsed.data.input, key, model, baseUrl));
    } catch (error) {
      if (error instanceof AuthzError) return failure(error);
      if (error instanceof FileInputError) return NextResponse.json({ error: error.message }, { status: 422 });
      const timeout = error instanceof Error && error.name === "TimeoutError";
      return NextResponse.json({ error: timeout ? "LLM request timed out after 60 seconds." : error instanceof Error && /^(OpenAI|LLM)/.test(error.message) ? error.message : "Could not read a response from the LLM provider. Try again." }, { status: timeout ? 504 : 502 });
    }
  } catch (error) {
    return failure(error);
  }
}
