import { z } from "zod";
import {
  indexerProviderLayerRefSchema,
} from "./indexerLayerComposition.js";
import { indexerDigestSchema } from "./indexerProtocolCommon.js";

export const indexerRunFinalAuthoritySchema = z.object({
  layer_ref: indexerProviderLayerRefSchema,
  integrity: indexerDigestSchema,
  bundle_digest: indexerDigestSchema,
  config_fingerprint: indexerDigestSchema,
  customization_fingerprint: indexerDigestSchema.nullable(),
}).strict();

export type IndexerRunFinalAuthority = z.infer<
  typeof indexerRunFinalAuthoritySchema
>;
