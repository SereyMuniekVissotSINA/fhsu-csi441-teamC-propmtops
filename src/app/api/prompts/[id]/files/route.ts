import { revalidatePath } from "next/cache";
import { failure } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { prepareUploads } from "@/lib/file-codecs";
import { FileInputError } from "@/lib/file-policy";
import { listPromptFiles, readUploadForm, requirePromptAccess, requireSameOrigin } from "@/lib/prompt-files";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requirePromptAccess(id);
    return Response.json({ files: await listPromptFiles(id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    const { session } = await requirePromptAccess(id, true);
    const files = await prepareUploads(await readUploadForm(request), session.user.id);
    if (!files.length) throw new FileInputError("Choose at least one file.");
    await prisma.prompt.update({ where: { id }, data: { files: { create: files } } });
    revalidatePath(`/dashboard/prompts/${id}`);
    return Response.json({ files: await listPromptFiles(id) }, { status: 201 });
  } catch (error) {
    if (error instanceof FileInputError) return Response.json({ error: error.message }, { status: 422 });
    return failure(error);
  }
}
