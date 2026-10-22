import { prisma } from "@/lib/prisma";
import { failure } from "@/lib/api";
import { requirePromptAccess } from "@/lib/prompt-files";
import { queryUsage } from "@/lib/usage-store";
import { analyticsFilterSchema, UsageError } from "@/lib/usage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { session } = await requirePromptAccess(id);
    const parsed = analyticsFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new UsageError(400, "Provide a valid start/end UTC interval (start before end), and valid optional filters.");
    const rows = await queryUsage(prisma, id, session.user.id, parsed.data);
    return Response.json({ rows, filters: parsed.data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UsageError) return Response.json({ error: error.message }, { status: error.status });
    return failure(error);
  }
}
