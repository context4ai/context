export interface ExternalEnvironmentIssue {
  reasonCode: "external.credential-store-unavailable";
  requiredCapabilities: ["credential-store"];
}

const CREDENTIAL_STORE_UNAVAILABLE = [
  /keychain[^\n]*(?:not initialized|unavailable|denied|locked|failed)/iu,
  /(?:credential[- ]store|credential storage|secure storage)[^\n]*(?:not initialized|unavailable|denied|locked|failed)/iu,
  /secret service[^\n]*(?:not available|unavailable|denied|locked|failed)/iu,
];

/**
 * Classifies failures caused by capabilities of the execution environment,
 * rather than by the source, payload, or lifecycle state.
 */
export function detectExternalEnvironmentIssue(
  value: string,
): ExternalEnvironmentIssue | undefined {
  if (CREDENTIAL_STORE_UNAVAILABLE.some((pattern) => pattern.test(value))) {
    return {
      reasonCode: "external.credential-store-unavailable",
      requiredCapabilities: ["credential-store"],
    };
  }
  return undefined;
}
