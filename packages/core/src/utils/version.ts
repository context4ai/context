const VERSION_LABEL_REGEX = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/i;

function encodePrerelease(channel?: string, sequence?: string): number | null {
  if (!channel) {
    return 99;
  }

  const index = Number.parseInt(sequence ?? "", 10);
  if (!Number.isInteger(index) || index <= 0 || index > 29) {
    return null;
  }

  switch (channel.toLowerCase()) {
    case "alpha":
      return index;
    case "beta":
      return 30 + index;
    case "rc":
      return 60 + index;
    default:
      return null;
  }
}

export function encodeVersionLabel(label: string): number | null {
  const match = VERSION_LABEL_REGEX.exec(label.trim());
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1] ?? "", 10);
  const minor = Number.parseInt(match[2] ?? "", 10);
  const patch = Number.parseInt(match[3] ?? "", 10);
  const prerelease = encodePrerelease(match[4], match[5]);

  if (
    !Number.isInteger(major)
    || !Number.isInteger(minor)
    || !Number.isInteger(patch)
    || prerelease === null
  ) {
    return null;
  }

  return major * 1_000_000 + minor * 10_000 + patch * 100 + prerelease;
}

export function isVersionVisible(
  record: {
    valid_from: number | null;
    valid_until: number | null;
  },
  versionCode?: number | null,
): boolean {
  if (versionCode == null) {
    return true;
  }
  return (record.valid_from == null || record.valid_from <= versionCode)
    && (record.valid_until == null || record.valid_until > versionCode);
}
