import { NextResponse } from "next/server";

import { failure, invalid, readJson } from "@/lib/api";
import { authorIdFor, requireCallerPrompt, usesBearerKey } from "@/lib/api-auth";
import { AuthzError } from "@/lib/authz";
import {
  CODE_OUTPUT_CONTRACT,
  classifyFiles,
  commitStats,
  describeCommit,
  parseGeneratedFiles,
} from "@/lib/code-commits";
import { PROVIDER_SETUP_MESSAGE, resolveProvider, runOpenAI } from "@/lib/openai-run";
import { prisma } from "@/lib/prisma";
import { generateCodeSchema } from "@/lib/validations";

// Generate code from a prompt and commit the result.
//
// The run itself is the same provider call as `../run`, which is why this is
// development-only too. The difference is what happens afterwards: the response
// is parsed into files, diffed against the prompt's previous commit, and stored
// append-only. Reading that history (`../commits`) has no such restriction —
// the commits outlive the environment that produced them.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Code generation is available in development only." },
      { status: 404 },
    );
  }
  // Origin is checked for cookie-authenticated browsers only: a bearer key is
  // never attached automatically, so there is nothing to forge — and a CLI has
  // no origin to send.
  if (!usesBearerKey(request) && request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const { caller } = await requireCallerPrompt(request, id, "EDITOR");

    const parsed = generateCodeSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    const provider = resolveProvider();
    if (!provider) {
      return NextResponse.json({ error: PROVIDER_SETUP_MESSAGE }, { status: 503 });
    }

    // The version this run is attributed to: the caller's, if it still belongs
    // to this prompt, otherwise whatever is current.
    const version = await prisma.promptVersion.findFirst({
      where: parsed.data.promptVersionId
        ? { id: parsed.data.promptVersionId, promptId: id }
        : { promptId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const input = `${parsed.data.input}${CODE_OUTPUT_CONTRACT}`;
    let result: Awaited<ReturnType<typeof runOpenAI>>;
    try {
      result = await runOpenAI(input, provider.key, provider.model, provider.baseUrl);
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      return NextResponse.json(
        {
          error: timeout
            ? "LLM request timed out after 60 seconds."
            : error instanceof Error && /^(OpenAI|LLM)/.test(error.message)
              ? error.message
              : "Could not read a response from the LLM provider. Try again.",
        },
        { status: timeout ? 504 : 502 },
      );
    }

    const commit = await commitGeneration({
      promptId: id,
      promptVersionId: version?.id ?? null,
      authorId: authorIdFor(caller),
      message: parsed.data.message,
      input,
      result,
    });

    return NextResponse.json(commit, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

type RunResult = Awaited<ReturnType<typeof runOpenAI>>;

/**
 * Write one commit: parse the files out of the response, diff them against the
 * parent commit, and append. A run that produced no files is still committed —
 * the log is a record of what the prompt did, including the times it did
 * nothing useful.
 */
async function commitGeneration({
  promptId,
  promptVersionId,
  authorId,
  message,
  input,
  result,
}: {
  promptId: string;
  promptVersionId: string | null;
  authorId: string | null;
  message: string;
  input: string;
  result: RunResult;
}) {
  const generated = parseGeneratedFiles(result.output);

  // Two runs finishing together would collide on (promptId, sequence). Both
  // are valid commits, so the loser re-reads the tip and appends behind the
  // winner rather than failing the request.
  for (let attempt = 0; ; attempt++) {
    const parent = await prisma.codeCommit.findFirst({
      where: { promptId },
      orderBy: { sequence: "desc" },
      select: {
        id: true,
        sequence: true,
        files: {
          where: { change: { not: "REMOVED" } },
          select: { path: true, content: true },
        },
      },
    });

    const files = classifyFiles(parent?.files ?? [], generated);

    try {
      const commit = await prisma.codeCommit.create({
        data: {
          promptId,
          promptVersionId,
          parentId: parent?.id ?? null,
          authorId,
          sequence: (parent?.sequence ?? 0) + 1,
          message: message || describeCommit(files),
          input,
          output: result.output,
          model: result.model,
          elapsedMs: result.elapsedMs,
          inputTokens: result.usage?.input_tokens ?? null,
          outputTokens: result.usage?.output_tokens ?? null,
          incomplete: result.incomplete,
          files: {
            create: files.map((file) => ({
              path: file.path,
              content: file.content,
              hash: file.hash,
              language: file.language,
              change: file.change,
              added: file.added,
              removed: file.removed,
            })),
          },
        },
        include: { files: { orderBy: { path: "asc" } }, author: { select: { name: true } } },
      });

      return {
        id: commit.id,
        sequence: commit.sequence,
        message: commit.message,
        parentId: commit.parentId,
        promptVersionId: commit.promptVersionId,
        input: commit.input,
        output: commit.output,
        model: commit.model,
        elapsedMs: commit.elapsedMs,
        inputTokens: commit.inputTokens,
        outputTokens: commit.outputTokens,
        incomplete: commit.incomplete,
        createdAt: commit.createdAt.toISOString(),
        authorName: commit.author?.name ?? null,
        stats: commitStats(files),
        files: commit.files,
      };
    } catch (error) {
      const collided =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002";
      if (!collided || attempt >= 2) {
        if (collided) throw new AuthzError(409, "Another run committed first. Try again.");
        throw error;
      }
    }
  }
}
