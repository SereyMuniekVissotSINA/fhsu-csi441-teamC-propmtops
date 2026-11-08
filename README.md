# Prompt Ops

Prompt Ops helps teams create, organize, and version prompts, compare changes,
test prompts with AI, and track the code they generate.

FHSU CSI 441 — Team C.

## How to run

You need Bun and a PostgreSQL database connection string.

1. Install dependencies and copy the environment file:

   ```bash
   bun install
   cp .env.example .env
   ```

2. Set `DATABASE_URL` in `.env` to your database connection string. If your
   provider supplies a separate direct connection, set `DIRECT_URL` too.
   Generate an authentication secret:

   ```bash
   bunx auth secret
   ```

3. Apply migrations and optionally load sample data:

   ```bash
   bunx --bun prisma migrate deploy
   bun run db:seed # optional
   ```

4. Start the app:

   ```bash
   bun run dev
   ```

   Open [localhost:3000](http://localhost:3000) and sign in or register.
   Keep `.env` private.

If you loaded sample data, use any account below with password `password123`:

| Role | Email |
| --- | --- |
| Owner | `admin@promptops.local` |
| Editor | `editor@promptops.local` |
| Viewer | `viewer@promptops.local` |

### Optional AI setup

To test prompts or generate code locally, configure these values in `.env`
using your running 9Router or another OpenAI-compatible service:

```env
LLM_BASE_URL="http://localhost:20128/v1"
LLM_MODEL="your-model-id"
LLM_API_KEY="your-service-api-key"
```

Use a model ID offered by that service, then restart `bun run dev`.
For 9Router, use its issued key and keep the upstream provider key in 9Router.

## App workflow

1. **Choose a workspace.** Sign in and open your team's workspace. Owners
   manage members and API keys; editors manage prompts; viewers browse and compare.
2. **Browse the library.** Open **Library & graph** to search prompts, view
   their connections, select versions, or copy prompt text.
3. **Create or edit a prompt.** Add a title, prompt text, tags, and variables
   such as `{{name}}`. Save changes as a new version and compare versions to
   review what changed.
4. **Test a prompt.** With AI configured, fill in its variables and select
   **Run test**. Review the response, timing, and token usage. Tests use the
   current draft; text-only results are not saved. Testing an attached file
   saves a separate revised file version.
5. **Generate and review code.** In local development, select **Generate code**
   to save a generated-code commit. Browse its files and compare changes with
   earlier commits. Generated files stay in the app until you copy them out.
6. **Review usage.** Open **Token usage & savings** to compare recorded usage
   across saved prompt versions. Measurements come from external applications;
   editor tests are not automatically included.

Owners and editors can delete a prompt from the editor's **Danger zone**.
Deletion permanently removes its saved versions and generated-code history.

### Terminal workflow (optional)

With the app running, sign in as an owner and create a workspace API key:

```bash
bun run pops auth login --email admin@promptops.local
bun run pops keys create --name "my laptop" --save
bun run pops
```

Use your own owner email if you did not load the sample data. The interactive
shell lets you browse prompts, save versions, compare changes, run tests, and
review generated-code history. Use `bun run pops help` for commands.
