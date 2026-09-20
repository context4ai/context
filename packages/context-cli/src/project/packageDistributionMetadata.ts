import { join } from "node:path";

export const PACKAGE_DISTRIBUTION_METADATA_DIR = join("others", "context");

export function packageDistributionMetadataPath(fileName: string): string {
  return join(PACKAGE_DISTRIBUTION_METADATA_DIR, fileName);
}
