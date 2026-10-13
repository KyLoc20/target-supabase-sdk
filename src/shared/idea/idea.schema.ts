import { z } from "zod";

/** Runtime shape of `Link.details.original` for value=idea. */
export const ideaOriginalSchema = z.object({
    content: z.string().trim().min(1).max(100_000),
    reviewList: z.array(z.string().trim().min(1).max(8000)).max(32).default([]),
    url: z.string().trim().max(2000).default(""),
    heat: z.number().int().min(0).default(0),
});

const ideaTagSchema = z.string().trim().min(1).max(128);

/** HTTP / API create body limits (upload-service `POST /v0/upload/idea`). */
export const ideaCreateSchema = z.object({
    name: z.string().trim().min(1, "name is required").max(500),
    content: z.string().trim().min(1, "content is required").max(100_000),
    reviewList: z.array(z.string().trim().min(1).max(8000)).max(32).default([]),
    url: z.string().trim().max(2000).default(""),
    tagList: z.array(ideaTagSchema).max(32).default([]),
});

export type IdeaCreateSchemaInput = z.infer<typeof ideaCreateSchema>;

export const ideaUpdateSchema = z.object({
    name: z.string().trim().min(1).max(500).optional(),
    content: z.string().trim().min(1).max(100_000).optional(),
    reviewList: z.array(z.string().trim().min(1).max(8000)).max(32).optional(),
    url: z.string().trim().max(2000).optional(),
    tagList: z.array(ideaTagSchema).max(32).optional(),
});

export type IdeaUpdateSchemaInput = z.infer<typeof ideaUpdateSchema>;
