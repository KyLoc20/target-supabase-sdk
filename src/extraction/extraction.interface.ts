import type { Target } from "../core.interface";

/**
 * Interpretation layer for a source Target: pipeline output (systems, models, algorithms)
 * materialized as structured data. Not a process (see Task) or raw bytes (see Parcel).
 *
 * @see `.cursor/skills/extraction/SKILL.md`
 */
export interface Extraction extends Target {
    /** Human-readable label. */
    name: string;
    /**
     * Source Target id — the single input this row interprets (any category).
     * Immutable after create. Indexed for lookup: all Extractions where `value = sourceId`.
     * Not a dedup hash or pipeline run id.
     */
    value: string;
    category: CategoryExtraction;
    details: ExtractionDetails;
}

export enum CategoryExtraction {
    EXTRACTION = "extraction",
}

export interface ExtractionDetails {
    manifestVersion: 0;
    /**
     * Extractor identifier. Together with {@link Extraction.value} (source id) forms the
     * logical unique key: one Extraction row per `(sourceTargetId, loaderKey)`.
     * Determines how to parse and render {@link objects} (Extractor-owned schema).
     */
    loaderKey: string;
    /**
     * Extractor-owned metadata for this interpretation (e.g. revision, updatedAt, pipeline).
     * Updated alongside {@link objects}; kept `unknown` at SDK boundary — see Extractor module.
     */
    meta: unknown;
    /**
     * Latest mutable analysis results for this source + Extractor — not an immutable snapshot.
     * Shape is defined by the Extractor for {@link loaderKey}; SDK keeps `unknown[]` at core.
     * Large payloads should reference Parcel (or similar) rather than inline in this array.
     */
    objects: Array<unknown>;
}
