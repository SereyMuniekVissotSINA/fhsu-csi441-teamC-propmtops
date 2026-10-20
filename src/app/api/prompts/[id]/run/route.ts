import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, invalid, readJson } from "@/lib/api";
import { authorIdFor, requireCallerPrompt, usesBearerKey } from "@/lib/api-auth";
import { AuthzError } from "@/lib/authz";
import { FileInputError, fileKind } from "@/lib/file-policy";
import { generateFileRevision } from "@/lib/file-revisions";
import { PROVIDER_SETUP_MESSAGE, resolveProvider, runOpenAI } from "@/lib/openai-run";
import { prisma } from "@/lib/prisma";
import { isAITestingEnabled, listPromptFiles } from "@/lib/prompt-files";

const inputSchema = z.object({ input: z.string().trim().min(1).max(16000), fileVersionId: z.string().min(1).max(100).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAITestingEnabled()) {
    return NextResponse.json({ error: "AI testing is not enabled on this server." }, { status: 404 });
  }
  // Cookie callers are checked for origin; bearer keys have none to send and
  // nothing to forge.
  if (!usesBearerKey(request) && request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  try {
    const { id } = await params;
    const { caller } = await requireCallerPrompt(request, id, "EDITOR");
    const parsed = inputSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);
    const source = parsed.data.fileVersionId ? await prisma.promptFileVersion.findFirst({
      where: { id: parsed.data.fileVersionId, file: { promptId: id } },
      select: { id: true, fileId: true, text: true, file: { select: { name: true } } },
    }) : null;
    if (parsed.data.fileVersionId && !source) throw new AuthzError(404, "File version not found.");
    const provider = resolveProvider();
    if (!provider) {
      return NextResponse.json({ error: PROVIDER_SETUP_MESSAGE }, { status: 503 });
    }
    try {
      if (source) {
        const revision = await generateFileRevision(parsed.data.input, {
          name: source.file.name, kind: fileKind(source.file.name), text: source.text,
        }, provider);
        // Recheck access after the network call; an editor may have been revoked.
        await requireCallerPrompt(request, id, "EDITOR");
        const saved = await prisma.$transaction(async tx => {
          // The row update serializes concurrent runs and allocates a unique
          // version number. Every run records its actual source, even if old.
          const file = await tx.promptFile.update({ where: { id: source.fileId }, data: { versionCount: { increment: 1 } } });
          return tx.promptFileVersion.create({ data: {
            fileId: file.id, version: file.versionCount, sourceVersionId: source.id,
            content: new Uint8Array(revision.content), text: revision.text, size: revision.size,
            mimeType: revision.mimeType, instruction: parsed.data.input,
            summary: revision.summary, model: revision.model, authorId: authorIdFor(caller),
          }, select: { id: true, version: true } });
        });
        revalidatePath(`/dashboard/prompts/${id}`);
        return NextResponse.json({ output: revision.output, model: revision.model,
          elapsedMs: revision.elapsedMs, usage: revision.usage, incomplete: false,
          fileVersion: saved, files: await listPromptFiles(id),
        });
      }
      return NextResponse.json(await runOpenAI(parsed.data.input, provider.key, provider.model, provider.baseUrl));
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
