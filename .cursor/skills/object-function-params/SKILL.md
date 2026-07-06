---
name: object-function-params
description: >-
  Function parameter style for target-supabase-sdk: use a single options object when
  a function has more than two parameters or multiple parameters of the same type
  (especially string). Use when authoring or reviewing helpers, APIs, scope factories,
  or refactoring positional argument lists.
---

# Object function parameters (target-supabase-sdk)

## One-line rule

**More than two parameters, or two+ parameters of the same type (e.g. multiple `string`) → use one options object; call sites use named fields.**

---

## When to use an options object

Apply if **either** condition holds:

| Trigger | Example smell |
|---------|----------------|
| **> 2 positional parameters** | `(module, parent, traceId)` — easy to reorder wrong |
| **≥ 2 params of the same type** | `(traceId, nodeId, traceParentId)` — all `string` |
| **Optional tail grows** | `(a, b, c?, d?)` — prefer flat object with optional keys |

### Keep positional (≤ 2 args, distinct types)

```typescript
// OK — two params, different types, order obvious
function withModule(scope: LogScope, module: string): LogScope;

// Prefer object param for scope updates
patchScope({ scope, patch: { labels: { nodeId } } });
```

### Convert to object

```typescript
// ❌ Positional — three strings / four params
function createScope(
  module: string,
  traceId: string,
  nodeId: string,
  traceParentId: string | null = null
): LogScope;

// ✅ Options object + named type
export type CreateScopeInput = {
  module: string;
  traceId: string;
  labels?: Record<string, string>;
  traceParentId?: string | null;
  parent?: LogScope;
};

export function createScope(input: CreateScopeInput): LogScope {
  const { module, parent, traceId, traceParentId, labels } = input;
  return normalizeScope(
    {
      module,
      traceId,
      traceParentId: traceParentId ?? (parent != null ? parent.traceId : null),
      labels: parent != null ? mergeLabels(parent.labels, labels) : mergeLabels(undefined, labels),
    },
    { generateTraceId: true }
  );
}
```

---

## Naming conventions

| Piece | Pattern | Example |
|-------|---------|---------|
| Input type | `{Verb}{Noun}Input` or `{Feature}Input` | `CreateScopeInput`, `PatchScopeInput` |
| Parameter name | `input` or `options` | `createScope(input)` |
| Export | Export input type when public / cross-module | `export type CreateScopeInput` |

Required fields in the type; optional fields use `?` with defaults inside the function body.

---

## Reference implementations (this repo)

| Function | File | Notes |
|----------|------|-------|
| `createScope` | `src/shared/log/log-scope.ts` | `CreateScopeInput` — optional `parent` links trace + merges labels |
| `createLogger` | `src/shared/log/create-logger.ts` | `{ module, … }` or `{ scope, minLevel? }` |
| `patchScope` | `src/shared/log/log-scope.ts` | `PatchScopeInput` — `{ scope, patch }`; trace fields ignored unless `allowTraceMutation: true` |
| `normalizeScope` | `src/shared/log/log-scope.ts` | Already object + second `options` bag |

---

## Call-site style

```typescript
// Named fields at call site — order free, self-documenting
createScope({
  module: `${runtimeModule}-loop-iteration`,
  traceId: loopTraceId,
  labels: { nodeId },
});

createScope({
  module: "prepareTask",
  traceId: loopTraceId,
  labels: { nodeId },
  traceParentId: task.details.traceId ?? null,
});

createScope({
  module: "executeTask",
  traceId: taskScope.traceId,
  parent: taskScope,
});
```

---

## Anti-patterns

| ❌ Avoid | ✅ Instead |
|----------|-----------|
| `(a: string, b: string, c: string)` public helpers | Single `input` object |
| Boolean flags as 3rd+ positional args | `input: { dryRun?: boolean }` |
| Same-type ids without names (`id1`, `id2`) | `traceId`, `traceParentId` in object |
| Giant untyped `Record` for everything | Dedicated `*Input` interface |

---

## Checklist (new / review function)

- [ ] Count positional parameters — if **> 2**, use object?
- [ ] Any **two+ same primitive type** (especially `string`) — use object?
- [ ] Exported helper? — export matching `*Input` type
- [ ] Call sites readable without counting argument positions?

---

## Related skills

- [library-exports](../library-exports/SKILL.md) — export `*Input` types from domain barrel when public
- [sdk-error-handling](../sdk-error-handling/SKILL.md) — API payloads often already use Zod objects

## Reference files

| File | Role |
|------|------|
| `src/shared/log/log-scope.ts` | `CreateScopeInput`, `PatchScopeInput` |
| `src/node/node-runtime.base.ts` | Loop scopes via `createScope({ labels: { nodeId } })` |
