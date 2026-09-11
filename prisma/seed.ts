import bcrypt from "bcryptjs";

import { demoSamples } from "../src/lib/demo-prompts";
import { prisma } from "../src/lib/prisma";

// The seed mirrors the browser demo on purpose: `/demo` and `/dashboard` show
// the same three prompts, so the offline fallback and the real backend are
// recognisably the same product.

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@promptops.local" },
    update: {},
    create: {
      email: "admin@promptops.local",
      name: "Prompt Ops Admin",
      role: "ADMIN",
      passwordHash,
    },
  });

  // A second member so the roles UI has something to show that isn't yourself.
  const editor = await prisma.user.upsert({
    where: { email: "editor@promptops.local" },
    update: {},
    create: {
      email: "editor@promptops.local",
      name: "Sam Rivera",
      passwordHash,
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "personal" },
    update: {},
    create: { name: "Personal workspace", slug: "personal" },
  });

  // Upserted separately rather than nested under the workspace: on a re-seed the
  // workspace already exists, so a nested `create` would never run and the
  // members would silently go missing.
  for (const [user, role] of [
    [admin, "OWNER"],
    [editor, "EDITOR"],
  ] as const) {
    await prisma.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
      update: { role },
      create: { userId: user.id, workspaceId: workspace.id, role },
    });
  }

  // Re-seeding should not stack duplicate prompts.
  await prisma.prompt.deleteMany({ where: { workspaceId: workspace.id } });

  for (const sample of demoSamples) {
    const versions = [...sample.versions].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    const newest = versions.at(-1)!;

    await prisma.prompt.create({
      data: {
        workspaceId: workspace.id,
        authorId: admin.id,
        title: newest.title,
        createdAt: new Date(versions[0].createdAt),
        updatedAt: new Date(newest.createdAt),
        versions: {
          create: versions.map((version) => ({
            title: version.title,
            body: version.body,
            tags: version.tags,
            note: version.note,
            authorId: admin.id,
            createdAt: new Date(version.createdAt),
          })),
        },
      },
    });
  }

  const versionCount = await prisma.promptVersion.count();
  console.log(
    `Seeded ${admin.email} / password123 — workspace "${workspace.name}" ` +
      `with ${demoSamples.length} prompts and ${versionCount} versions.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
