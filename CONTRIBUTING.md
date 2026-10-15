# Contributing to Prompt Ops

Thanks for helping improve Prompt Ops. Keep contributions focused so they are
easy to review, test, and revert if necessary.

## Before you start

- Check existing issues and pull requests to avoid duplicate work.
- Open an issue before making a large product, schema, or architecture change.
- Never commit `.env` files, database credentials, API keys, or auth secrets.

## Local setup

Prompt Ops uses Bun, Next.js, PostgreSQL, and Prisma ORM.

```bash
bun install
cp .env.example .env
bunx auth secret
bunx --bun prisma migrate deploy
bun run db:seed
bun run dev
```

The seed step is optional. See the README for the demo account and environment
variable details.

## Making a change

1. Create a short-lived branch from `main`:

   ```bash
   git switch main
   git pull --ff-only
   git switch -c type/short-description
   ```

   Use a descriptive prefix such as `feat/`, `fix/`, `docs/`, or `test/`.
2. Make one focused change and add or update tests when behavior changes.
3. Run the relevant checks:

   ```bash
   bun run test
   bun run lint
   bun run typecheck
   ```

4. Commit with a concise, imperative message, such as
   `docs: explain local database setup`.
5. Push the branch and open a pull request against `main`.

## Pull requests

In the pull request description, explain what changed, why it changed, and how
you verified it. Add screenshots for visible UI changes and call out database
migrations or new environment variables explicitly.

Keep unrelated cleanup in a separate pull request. A maintainer may ask for
changes when tests are missing, checks fail, or the scope is unclear.

