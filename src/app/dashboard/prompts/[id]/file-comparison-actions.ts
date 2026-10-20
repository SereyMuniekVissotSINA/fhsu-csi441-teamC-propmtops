"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthzError } from "@/lib/authz";
import { isAITestingEnabled, requirePromptAccess } from "@/lib/prompt-files";
import { analyzeFileChanges } from "@/lib/file-analysis";
import { ComparisonInputError } from "@/lib/prompt-analysis";
import type { FileComparisonPair } from "@/lib/file-comparison";

const inputSchema = z.object({
  promptId: z.string().min(1).max(100),
  fileId: z.string().min(1).max(100),
  firstId: z.string().min(1).max(100),
  secondId: z.string().min(1).max(100),
}).refine(input => input.firstId !== input.secondId);

export async function analyzeFileVersionsAction(input: FileComparisonPair & { promptId: string }) {
  try {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return { error: "Choose two different versions of the same file." };
    const { promptId, fileId, firstId, secondId } = parsed.data;
    await requirePromptAccess(promptId, true);
    if (!isAITestingEnabled()) return { error: "AI testing is not enabled on this server." };
    // Both immutable snapshots must belong to this file AND authorized prompt.
    // Never trust file text or ownership supplied by a client.
    const versions = await prisma.promptFileVersion.findMany({
      where: { fileId, file: { promptId }, id: { in: [firstId, secondId] } },
      select: { version: true, text: true, file: { select: { name: true, kind: true } } },
      orderBy: { version: "asc" },
    });
    if (versions.length !== 2) return { error: "These versions are not available in the same file." };
    const baseUrl = process.env.LLM_BASE_URL?.trim();
    const key = (baseUrl ? process.env.LLM_API_KEY : process.env.OPENAI_API_KEY)?.trim() ?? "";
    const model = (baseUrl ? process.env.LLM_MODEL : process.env.OPENAI_MODEL)?.trim();
    if (!model || (!baseUrl && !key)) return { error: "Configure the AI provider and model on the server first." };
    let analysis;
    try {
      analysis = await analyzeFileChanges(versions[0].file, versions[0], versions[1], { key, model, baseUrl });
    } catch (error) {
      if (error instanceof ComparisonInputError) return { error: error.message };
      return { error: error instanceof Error && error.name === "TimeoutError" ? "AI analysis timed out after 60 seconds. Try again."
        : error instanceof Error && /^(OpenAI|LLM)/.test(error.message) ? error.message : "Could not get an AI analysis. Try again." };
    }
    await requirePromptAccess(promptId, true);
    return { analysis };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error("File comparison failed", error);
    return { error: "Could not compare these file versions. Please try again." };
  }
}
