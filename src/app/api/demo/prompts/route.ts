import { demoSamples } from "@/lib/demo-prompts";

// Public sample data only. Personal demo prompts stay in the browser.
export function GET() {
  return Response.json({ schemaVersion: 1, prompts: demoSamples });
}
