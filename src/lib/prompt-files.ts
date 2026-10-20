import { prisma } from "./prisma";
import { AuthzError, requireMember, requireSession } from "./authz";
import { FileInputError, MAX_FILE_BYTES, type PromptFileInfo } from "./file-policy";

export async function requirePromptAccess(id: string, edit = false) {
  await requireSession();
  const prompt = await prisma.prompt.findUnique({ where: { id }, select: { workspaceId: true } });
  if (!prompt) throw new AuthzError(404, "Prompt not found.");
  const access = await requireMember(prompt.workspaceId, edit ? "EDITOR" : "VIEWER");
  return { ...access, workspaceId: prompt.workspaceId };
}

export async function listPromptFiles(promptId: string): Promise<PromptFileInfo[]> {
  const files = await prisma.promptFile.findMany({
    where: { promptId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, kind: true, versions: {
      orderBy: { version: "desc" },
      select: { id: true, version: true, sourceVersionId: true, size: true, summary: true, model: true, createdAt: true },
    } },
  });
  return files.map(file => ({ ...file, versions: file.versions.map(version => ({ ...version, createdAt: version.createdAt.toISOString() })) }));
}

export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new AuthzError(403, "Request origin is not allowed.");
}

export async function readUploadForm(request: Request): Promise<FormData> {
  const max = MAX_FILE_BYTES + 100_000;
  if (Number(request.headers.get("content-length")) > max) throw new FileInputError("Upload exceeds 2 MB plus form metadata.");
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new FileInputError("Use a multipart file upload.");
  const reader = request.body?.getReader();
  if (!reader) throw new FileInputError("Upload is empty.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        throw new FileInputError("Upload exceeds 2 MB plus form metadata.");
      }
      chunks.push(value);
    }
    return await new Response(new Blob(chunks), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
  } catch (error) {
    if (error instanceof FileInputError) throw error;
    throw new FileInputError("Could not read the file upload.");
  } finally {
    reader.releaseLock();
  }
}

export function isAITestingEnabled() {
  return process.env.NODE_ENV === "development" || process.env.AI_TESTING_ENABLED === "true";
}
