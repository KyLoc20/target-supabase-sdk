# target-supabase-sdk

Supabase client initializer and data access APIs for Target-based backends.

## Install

```bash
pnpm add target-supabase-sdk
```

This package declares `@supabase/supabase-js`, `@supabase/postgrest-js`, and `lodash-es` as **peer dependencies** — your app must have them available at runtime, but they are not bundled into the SDK itself. This avoids duplicate Supabase client instances and lets you control dependency versions.

**pnpm 8+** and **npm 7+** usually auto-install missing peer dependencies, so the command above is often enough.

If you see peer dependency warnings or `Cannot find module` errors at runtime, install them explicitly:

```bash
pnpm add target-supabase-sdk @supabase/supabase-js @supabase/postgrest-js lodash-es
```

> `@supabase/postgrest-js` is also pulled in transitively by `@supabase/supabase-js`; it is listed here because the SDK uses its types directly (e.g. `PostgrestFilterBuilder`).

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your Supabase project values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Main Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Main project anon (public) key |
| `VITE_SUPABASE_NEED_AUTH_URL` | No | Separate auth project URL |
| `VITE_SUPABASE_NEED_AUTH_ANON_KEY` | No | Separate auth project anon key |

### Security

- `VITE_*` variables are embedded in the client bundle at build time. Only use the **anon (public) key** — it is designed to be public when protected by Row Level Security (RLS).
- **Never** put the `service_role` key in a `VITE_*` variable or any frontend code. Use it only in trusted server-side environments.
- Do not commit `.env` or `.env.local`. They are gitignored; only `.env.example` (placeholders) should be tracked.
- Auth APIs return session tokens. Store them securely and never log them.

## Usage

```typescript
import { supabase, getTarget, loginUser } from "target-supabase-sdk";

await supabase.initialize({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  supabaseNeedAuthUrl: import.meta.env.VITE_SUPABASE_NEED_AUTH_URL,
  supabaseNeedAuthAnonKey: import.meta.env.VITE_SUPABASE_NEED_AUTH_ANON_KEY,
});

const target = await getTarget({ id: "..." });
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm dev
```

Verify the publishable tarball locally:

```bash
pnpm pack:check
```

## Release

Publishing is automated via GitHub Actions when a version tag is pushed.

### One-time setup

1. Create an npm [Granular Access Token](https://www.npmjs.com/settings/~your-username/tokens) with **Read and Write** permission and **Bypass 2FA for automation** enabled.
2. Add it to the GitHub repository as a secret named `NPM_TOKEN`:
   - Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### Publish a new version

```bash
npm version patch
git push
git push --tags
```

- `npm version patch` — bump version (`0.1.0` → `0.1.1`), commit, and create git tag `v0.1.1`. Use `minor` or `major` when needed.
- `git push` — push the version commit to GitHub
- `git push --tags` — push the tag; triggers `.github/workflows/release.yml` to publish to npm

First push on a new machine (set upstream once):

```bash
git push -u origin main
git push --tags
```

PowerShell 5.x does not support `&&`. Run each command on its own line, or use `git push; git push --tags`.

The release workflow will:

1. Verify the git tag matches `package.json` version (e.g. tag `v0.1.1` ↔ version `0.1.1`)
2. Build the package
3. Publish to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements)

### Manual publish (fallback)

```bash
pnpm pack:check
npm publish --otp=YOUR_2FA_CODE
```

## License

MIT
