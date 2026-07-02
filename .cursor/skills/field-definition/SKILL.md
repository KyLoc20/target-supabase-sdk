---
name: field-definition
description: >-
  FieldDefinition and SchemaDefinition for service/API inline schemas in
  target-supabase-sdk. Use when authoring or reviewing base.interface.ts,
  ApiDetails request/response fields, introspection walks, enum members,
  nested object fields, or Zod-aligned validation without registry refs.
---

# FieldDefinition · SchemaDefinition

## Decisions (do not change without explicit request)

1. **All inline** — no `ref` / `enumKey` / `refMap` / registry lookup in field schemas.
2. **`fieldName` is for introspection** — paths, docs, forms, validators walk a **tree**; every named node carries `fieldName`.
3. **Named lists, not Records** — use `FieldDefinition[]` (`fields`, `query`, `response`), never `Record<string, FieldDefinition>` (avoids key vs `fieldName` drift).
4. **Anonymous nodes use `SchemaDefinition`** — array `items` and future union arms have no `fieldName`; path segment is `"[]"` or branch tag.
5. **Enums are `members: EnumMembers`** — `{ key, value }[]` inline; default is `defaultKey` (matches `members[].key`).

## Type layers

```text
EnumMembers     — inline enum entries
SchemaDefinition — type discriminant + constraints; nestable (array items, no fieldName)
FieldDefinition  — { fieldName: string } & SchemaDefinition
```

| Type | Has `fieldName` | Used where |
|------|-----------------|------------|
| `SchemaDefinition` | No | `array.items`, anonymous nesting |
| `FieldDefinition` | Yes | `ApiDetails.request.query`, `object.fields`, response fields |

## ApiDetails shape

```ts
request: { query: FieldDefinition[] };
response: { "200": FieldDefinition[] };
```

## Object & array

```ts
// object — nested named fields
{ fieldName: "address", type: "object", fields: [
  { fieldName: "zip", type: "string", ... },
], ... }

// array — element schema without fieldName
{ fieldName: "tags", type: "array", items: { type: "string", ... }, min?: 1, max?: 10 }
```

Do **not** use `descriptor` or `itemType` string unions — use `fields` / `items` / `members`.

## Introspection walk (pattern)

```ts
function* walkFields(
  fields: FieldDefinition[],
  prefix: string[] = [],
): Generator<{ path: string[]; field: FieldDefinition }> {
  for (const field of fields) {
    const path = [...prefix, field.fieldName];
    yield { path, field };
    if (field.type === "object") {
      yield* walkFields(field.fields, path);
    }
    if (field.type === "array" && field.items.type === "object") {
      yield* walkFields(field.items.fields, [...path, "[]"]);
    }
  }
}
```

Extend for `array` of scalars (path ends with `[]` only), nested arrays, and future `union` / `discriminatedUnion`.

## Zod alignment (mapping intent)

| FieldDefinition | Zod |
|-----------------|-----|
| `optional` | `.optional()` |
| `nullable` | `.nullable()` |
| `string` + min/max/regex | `z.string().min().max().regex()` |
| `enum.members` | `z.enum([...keys])` or custom map key→value |
| `object.fields` | `z.object(shape)` from walked fields |
| `array.items` | `z.array(itemSchema)` |
| `unknown` | `z.unknown()` |

Constraints (`min`, `max`, `regex`) are optional on the schema node.

## Naming

| Use | Name |
|-----|------|
| Enum member list | `EnumMembers` (not `EnumDescriptor` Target row) |
| Object shape | `fields: FieldDefinition[]` (not `ObjectDescriptor` Record) |
| Enum default | `defaultKey` (not display `value`) |

## Anti-patterns

- `Record<string, FieldDefinition>` alongside `fieldName` — duplicate names, broken introspection
- `array.descriptor: FieldDefinition` — item is not a named field; use `items: SchemaDefinition`
- `TargetDraft` / `refMap` for field types — use inline `members` / `fields`
- `default` on enum without specifying key vs value — use `defaultKey` only

## Checklist (new API field schema)

- [ ] Top-level `query` / `response["200"]` are `FieldDefinition[]`
- [ ] Each named field has unique `fieldName` among siblings
- [ ] `object` uses `fields`, not `descriptor` Record
- [ ] `array` uses `items: SchemaDefinition`
- [ ] `enum` uses `members` + optional `defaultKey`
- [ ] Validator / walk handles `object` recursion and `[]` path segment

## Future (TODO in code)

- `union` / `discriminatedUnion` on `SchemaDefinition`
- `string.format` (`email`, `uri`, `uuid`, `date-time`)
- `number.integer`
