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

function applyScopePatch(scope: LogScope, patch: LogScopePatch): LogScope;
```

### Convert to object

```typescript
// ❌ Positional — three strings / four params
function scopeForNodeLoop(
  module: string,
  traceId: string,
  nodeId: string,
  traceParentId: string | null = null
): LogScope;

// ✅ Options object + named type
export type ScopeForNodeLoopInput = {
  module: string;
  traceId: string;
  nodeId: string;
  traceParentId?: string | null;
};

export function scopeForNodeLoop(input: ScopeForNodeLoopInput): LogScope {
  const { module, traceId, nodeId, traceParentId = null } = input;
  return createRootScope({ module, traceId, labels: { nodeId }, traceParentId });
}
```

---

## Naming conventions

| Piece | Pattern | Example |
|-------|---------|---------|
| Input type | `{Verb}{Noun}Input` or `{Feature}Input` | `CreateRootScopeInput`, `ScopeForNodeLoopInput` |
| Parameter name | `input` or `options` | `createRootScope(input)` |
| Export | Export input type when public / cross-module | `export type CreateChildScopeInput` |

Required fields in the type; optional fields use `?` with defaults inside the function body.

---

## Reference implementations (this repo)

| Function | File | Notes |
|----------|------|-------|
| `createRootScope` | `src/shared/log/log-scope.ts` | `CreateRootScopeInput` |
| `createChildScope` | `src/shared/log/log-scope.ts` | `CreateChildScopeInput` — `parent` + string fields |
| `scopeForNodeLoop` | `src/node/node-log-scope.ts` | Node-domain helper; multiple strings |
| `normalizeScope` | `src/shared/log/log-scope.ts` | Already object + second `options` bag |

---

## Call-site style

```typescript
// Named fields at call site — order free, self-documenting
createChildScope({
  module: `${runtimeModule}-loop-iteration`,
  parent: startupScope,
  traceId: loopTraceId,
});

scopeForNodeLoop({
  module: "prepareTask",
  traceId: taskTraceId,
  nodeId,
  traceParentId: loopTraceId,
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
| `src/shared/log/log-scope.ts` | `CreateRootScopeInput`, `CreateChildScopeInput` |
| `src/node/node-log-scope.ts` | `ScopeForNodeLoopInput` |
