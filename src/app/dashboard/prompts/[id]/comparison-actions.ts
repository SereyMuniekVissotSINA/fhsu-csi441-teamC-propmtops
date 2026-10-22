"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthzError } from "@/lib/authz";
import { isAITestingEnabled, requirePromptAccess } from "@/lib/prompt-files";
import { analyzePromptChanges, ComparisonInputError } from "@/lib/prompt-analysis";

const inputSchema = z.object({
  promptId: z.string().min(1).max(100),
  firstId: z.string().min(1).max(100),
  secondId: z.string().min(1).max(100),
}).refine(input => input.firstId !== input.secondId, "Choose two different versions.");

export async function analyzeVersionsAction(input: { promptId: string; firstId: string; secondId: string }) {
  try {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return { error: "Choose two different saved versions." };
    const { promptId, firstId, secondId } = parsed.data;
    await requirePromptAccess(promptId, true);
    if (!isAITestingEnabled()) return { error: "AI testing is not enabled on this server." };
    // Read trusted snapshots, never caller-supplied content, and scope both IDs
    // to the authorized prompt. No mutations are performed by this action.
    const versions = await prisma.promptVersion.findMany({
      where: { promptId, id: { in: [firstId, secondId] } },
      select: { title: true, body: true, tags: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (versions.length !== 2) return { error: "One of these versions is not available in this prompt." };
    const baseUrl = process.env.LLM_BASE_URL?.trim();
    const key = (baseUrl ? process.env.LLM_API_KEY : process.env.OPENAI_API_KEY)?.trim() ?? "";
    const model = (baseUrl ? process.env.LLM_MODEL : process.env.OPENAI_MODEL)?.trim();
    if (!model || (!baseUrl && !key)) return { error: "Configure the AI provider and model on the server first." };
    let analysis;
    try {
      analysis = await analyzePromptChanges(versions[0], versions[1], { key, model, baseUrl });
    } catch (error) {
      if (error instanceof ComparisonInputError) return { error: error.message };
      const message = error instanceof Error && error.name === "TimeoutError" ? "AI analysis timed out after 60 seconds. Try again."
        : error instanceof Error && /^(OpenAI|LLM)/.test(error.message) ? error.message : "Could not get an AI analysis. Try again.";
      return { error: message };
    }
    await requirePromptAccess(promptId, true);
    return { analysis };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error("Prompt comparison failed", error);
    return { error: "Could not compare these versions. Please try again." };
  }
}
