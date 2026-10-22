import { failure } from "@/lib/api";
import { AuthzError } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { requirePromptAccess } from "@/lib/prompt-files";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const { id, versionId } = await params;
    await requirePromptAccess(id);
    const version = await prisma.promptFileVersion.findFirst({
      where: { id: versionId, file: { promptId: id } },
      include: { file: { select: { name: true } } },
    });
    if (!version) throw new AuthzError(404, "File version not found.");
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    if (new URL(request.url).searchParams.get("preview") === "1") {
      return Response.json({ text: version.text, instruction: version.instruction, summary: version.summary }, { headers });
    }
    const dot = version.file.name.lastIndexOf(".");
    const name = `${version.file.name.slice(0, dot)}.v${version.version}${version.file.name.slice(dot)}`;
    const encoded = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(new Uint8Array(version.content), { headers: {
      ...headers, "Content-Type": version.mimeType,
      "Content-Disposition": `attachment; filename="file-v${version.version}${version.file.name.slice(dot).toLowerCase()}"; filename*=UTF-8''${encoded}`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
    } });
  } catch (error) {
    return failure(error);
  }
}
