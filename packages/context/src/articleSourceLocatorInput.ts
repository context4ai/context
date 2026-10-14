import { z } from "zod";
import { articleSourceLocatorSchema } from "./articleStructure.js";
import { portableIndexerPathSchema } from "./indexerProtocolCommon.js";

/** Author submission syntax. Resolve against authorized captured text before
 * persisting an articleSourceLocatorSchema value. */
export const articleSourceLocatorInputSchema = z.union([
  articleSourceLocatorSchema,
  z.object({ path: portableIndexerPathSchema, heading: z.string().trim().min(1) }).strict(),
  z.object({ path: portableIndexerPathSchema, quote: z.string().min(1) }).strict(),
]);
export type ArticleSourceLocatorInput = z.infer<typeof articleSourceLocatorInputSchema>;
