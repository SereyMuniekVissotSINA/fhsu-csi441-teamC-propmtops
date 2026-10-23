
const beforePrompt =
  "Write a welcome message for {{customer_name}}.";

const afterPrompt =
  "Write a friendly, concise welcome message for {{customer_name}}.";

export default function PromptPreview() {
  return (
    <section
      aria-labelledby="prompt-preview-heading"
      className="mx-auto max-w-6xl px-6 pb-20"
    >
      <div className="mb-8 max-w-2xl">
        <p className="text-sm font-medium text-emerald-400">
          SEE IT IN ACTION
        </p>

        <h2
          id="prompt-preview-heading"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Every prompt change, under control.
        </h2>

        <p className="mt-4 text-base leading-7 text-zinc-400">
          Compare prompt versions, see exactly what changed, and keep your
          templates organized as your application evolves.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/20">
        {/* Window header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/70 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <span className="text-sm font-medium text-zinc-200">
              welcome-message.prompt
            </span>
          </div>

          <span className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400">
            Sample comparison
          </span>
        </div>

        {/* Version comparison */}
        <div className="grid md:grid-cols-2">
          <div className="border-b border-zinc-800 p-5 md:border-b-0 md:border-r sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-200">
                Version 1
              </span>
              <span className="text-xs text-zinc-500">Previous</span>
            </div>

            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-7 text-zinc-400">
              {beforePrompt}
            </pre>
          </div>

          <div className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-200">
                Version 2
              </span>
              <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">
                Updated
              </span>
            </div>

            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-7 text-zinc-300">
              Write a{" "}
              <span className="rounded bg-emerald-500/15 px-1 text-emerald-300 ring-1 ring-emerald-500/20">
                friendly, concise
              </span>{" "}
              welcome message for {"{{customer_name}}"}.
            </pre>
          </div>
        </div>

        {/* Version summary */}
        <div className="flex flex-col gap-2 border-t border-zinc-800 bg-zinc-900/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-sm text-zinc-400">
            <span className="font-medium text-emerald-400">+2 words</span>
            {" "}added to clarify the desired tone.
          </p>

          <span className="text-xs text-zinc-500">
            Illustrative example · Not connected to live data
          </span>
        </div>
      </div>
    </section>
  );
}
