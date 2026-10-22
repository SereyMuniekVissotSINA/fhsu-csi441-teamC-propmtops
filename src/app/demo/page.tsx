import type { Metadata } from "next";
import { DemoWorkspace } from "@/components/demo/workspace";
import { DemoAccountProvider } from "@/components/demo/account-provider";

export const metadata: Metadata = {
  title: "Demo workspace | PromptOps",
  description:
    "Create, preview, and version your prompts in a browser-based demo workspace.",
};

export default async function DemoPage({ searchParams }: PageProps<"/demo">) {
  const { view } = await searchParams;
  return (
    <DemoAccountProvider>
      <DemoWorkspace initialView={view === "history" ? "history" : "editor"} />
    </DemoAccountProvider>
  );
}
