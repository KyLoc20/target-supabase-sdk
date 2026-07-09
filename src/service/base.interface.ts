export enum ServiceLifecycleStatus {
    ACTIVE = "ACTIVE",
    DEPRECATED = "DEPRECATED",
    SUNSET = "SUNSET",
}

export interface ServiceLifecycle {
    status: ServiceLifecycleStatus;
    /** YYYY-MM-DD */
    activeSince: string;
    deprecatedAt: string | null;
    sunsetAt: string | null;
}

/** Inline enum members (no registry lookup). */
export type EnumMembers = ReadonlyArray<{
    key: string;
    value: string;
}>;

/**
 * Schema node without a field name — used for array items and anonymous nesting.
 * Named properties use {@link FieldDefinition} (`fieldName` + `SchemaDefinition`).
 */
export type SchemaDefinition =
    | {
          type: "string";
          nullable: boolean;
          optional: boolean;
          /** string length */
          min?: number;
          /** string length */
          max?: number;
          /** e.g. ^[a-z0-9_-]+$ */
          regex?: string;
          default?: string;
      }
    | {
          type: "number";
          nullable: boolean;
          optional: boolean;
          min?: number;
          max?: number;
          default?: number;
      }
    | {
          type: "boolean";
          nullable: boolean;
          optional: boolean;
          default?: boolean;
      }
    | {
          type: "unknown";
          nullable: boolean;
          optional: boolean;
          default?: unknown;
      }
    | {
          type: "enum";
          nullable: boolean;
          optional: boolean;
          members: EnumMembers;
          /** Must match a `members[].key` */
          defaultKey?: string;
      }
    | {
          type: "object";
          nullable: boolean;
          optional: boolean;
          fields: FieldDefinition[];
          default?: Record<string, unknown>;
      }
    | {
          type: "array";
          nullable: boolean;
          optional: boolean;
          items: SchemaDefinition;
          /** min/max item count */
          min?: number;
          max?: number;
          default?: unknown;
      };

/**
 * Named field schema. `fieldName` is required for introspection (walk paths, docs, forms).
 * Use `fields: FieldDefinition[]` — not `Record<string, …>` — so the name has a single source of truth.
 */
export type FieldDefinition = { fieldName: string } & SchemaDefinition;
