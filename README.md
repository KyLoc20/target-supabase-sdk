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
pnpm build
pnpm dev
```

## License

MIT
