import { z } from "zod";

export const sourceRefSpanSchema = z.object({
  start: z.number().int().min(1),
  end: z.number().int().min(1),
});

export const sourceRefSchema = z.object({
  ref: z.string(),
  span: sourceRefSpanSchema.optional(),
});
