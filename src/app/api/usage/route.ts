import { prisma } from "@/lib/prisma";
import { recordUsage, usageCredential } from "@/lib/usage-store";
import { readUsageJson, UsageError } from "@/lib/usage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const hashedKey = usageCredential(request.headers.get("authorization"));
    const receipt = await recordUsage(prisma, hashedKey, await readUsageJson(request));
    return Response.json(receipt, { status: receipt.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UsageError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Usage recording failed", error);
    return Response.json({ error: "Could not record usage. Check the database migration, then retry with the same request ID." }, { status: 500 });
  }
}
