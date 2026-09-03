import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/prisma";

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

  await prisma.prompt.create({
    data: {
      title: "Hello, Prompt Ops",
      body: "Seeded prompt so the dashboard has something to render.",
      tags: "demo,seed",
      authorId: admin.id,
    },
  });

  console.log(`Seeded admin user: ${admin.email} / password123`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
