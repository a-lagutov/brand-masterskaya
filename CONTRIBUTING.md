# Contributing

Keep changes focused and discuss changes to payments, customer data, or deployment with the owner. This repository is proprietary; see [LICENSE](LICENSE).

## Setup

Use Node.js 22 and npm. PHP 8.1 or newer with `curl` and `openssl` is required for the payment endpoints.

```bash
npm ci
npm --prefix admin ci
```

Read [README.md](README.md) for the landing page and payment configuration. Read [admin/README.md](admin/README.md) for Payload, Telegram, environment variables, and deployment. Keep local credentials in ignored configuration files; use the supplied examples as templates.

Build and preview the landing page:

```bash
npm run build
python3 -m http.server 4173 -d dist
```

## Checks

Run before opening a pull request:

```bash
npm run check
npm run build
for file in src/api/*.php config.example.php; do php -l "$file"; done
```

`npm run check` runs JavaScript type checking, ESLint, Stylelint, the BEM checker, and Prettier. The landing page CI also builds the site and checks PHP syntax.

For admin panel or bot changes, also run:

```bash
npm --prefix admin run typecheck
DATABASE_URL=file:/tmp/brand-admin-build.db PAYLOAD_SECRET=build-only npm --prefix admin run build
```

If `admin/package.json` defines a `test` script, also run `npm --prefix admin test`.

Use a disposable database path that does not contain customer data. Disable the bot for local checks: leave `RUN_BOT` unset and do not supply live Telegram credentials. The Admin workflow runs type checking and a build with a temporary database; run admin tests as well when they are defined.

For Payload schema changes, run the relevant generators from `admin/` and review their output:

```bash
npm run migrate:create
npm run generate:types
npm run generate:importmap
```

Add tests for failure paths, payment validation, duplicate order processing, recipient selection, and data preservation when those behaviors change. Use fake orders, recipients, credentials, and temporary storage. Do not run checks against production services or send real messages as a test.

The pre-commit hook checks staged files through lint-staged. Fix failures rather than bypassing hooks. List any check you could not run and its reason in the pull request.

## Style

- Give every function a comment. Use JSDoc for public JavaScript and TypeScript functions, hooks, and utilities; use docstrings for Python modules, classes, and public functions. Explain non-obvious logic with inline comments.
- Use descriptive names. JavaScript and TypeScript use `camelCase` for functions and variables, `PascalCase` for components, and `UPPER_SNAKE_CASE` for constants.
- Follow PEP 8 for Python: `snake_case` for functions and variables, `PascalCase` for classes, and `UPPER_SNAKE_CASE` for constants.
- Follow the existing Prettier, ESLint, and Stylelint configuration. Keep one folder per BEM block and preserve the stylesheet cascade order.
- Edit source files rather than generated `dist/` files. Commit reviewed Payload migrations, generated types, and import maps with their schema or component changes.

## Branches

- Start each change from current `main` in a separate branch: `git fetch --prune` then `git switch -c fix/short-name origin/main`.
- Name branches `<type>/<kebab-case>`. Use `feat`, `fix`, `refactor`, `docs`, `test`, `ci`, or `chore` as the type.
- Keep one task per branch. If a change depends on an unmerged branch, base the new branch on it and merge in order.
- Do not push directly to `main`, rewrite another contributor's branch, or create merge commits in a pull request branch.
- Do not rewrite published history without the owner's explicit instruction. Preserve existing worktrees and unrelated local changes.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `ci:`, `chore:`, or `build:`. Add a scope when it helps, for example `fix(pay): reject invalid discounts`.
- Write an English imperative subject without a trailing period. Keep it at 50 characters or fewer; use the body to explain non-obvious reasons.
- Do not replace Git author or committer identity. Credit AI-assisted commits with a `Co-Authored-By` trailer when applicable.
- Keep one change per pull request. Explain why it is needed, list key changes and checks, and document migrations or deployment requirements.
- Never commit `.env`, `config.php`, private keys, Telegram sessions, customer data, database files, order files, or generated build output. Templates such as `.env.example` and `config.example.php` must contain placeholders only.
- Wait for CI checks and address review comments before merging. The owner decides when to merge.
- Push, open a pull request, merge, delete remote branches, or change repository settings only when the owner explicitly requests the action.

## Deployment

Pushes that change deployment paths can deploy automatically. The main branch targets production; other branches share the test site and test admin panel. A Worker change can replace the relay used by both bots. See [README.md](README.md#деплой) and [admin/README.md](admin/README.md#деплой) before changing workflows.

The test site uses real payment APIs. Do not create payments, send broadcasts, or change remote orders without explicit authorization. Keep environment-specific secrets, bot identities, order directories, database files, and backups separate.
