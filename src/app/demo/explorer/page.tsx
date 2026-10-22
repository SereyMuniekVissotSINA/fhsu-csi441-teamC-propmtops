import type { Metadata } from "next";
import { DemoAccountProvider } from "@/components/demo/account-provider";
import { PromptExplorer } from "@/components/demo/prompt-explorer";

export const metadata: Metadata = {
  title: "Prompt explorer | PromptOps",
  description: "Search your demo library and retrieve any saved prompt version.",
};

export default function ExplorerPage() {
  return <DemoAccountProvider><PromptExplorer /></DemoAccountProvider>;
}
