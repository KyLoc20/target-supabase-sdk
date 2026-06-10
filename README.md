# @react-starter/supabase-sdk

Supabase client initializer and data access APIs for Target-based backends.

## Install

```bash
pnpm add @react-starter/supabase-sdk @supabase/supabase-js @supabase/postgrest-js lodash-es
```

## Usage

```typescript
import { supabase, getTarget, loginUser } from "@react-starter/supabase-sdk";

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
