export interface DeliveryPage {
  ref: string;
  artifact_id: string;
  result_digest: string;
  workset_digest: string;
  content_digest: string;
  boundary: boolean;
  priority: number;
}

/** Counts complete, stable pages, independently of worksets and transport calls. */
export function selectDeliveryPages(input: {
  pages: readonly DeliveryPage[];
  delivered: Readonly<Record<string, string>>;
  allAuthorsAccepted: boolean;
  requestedEarly?: boolean;
  hasPriorDelivery?: boolean;
  waveSize?: number;
}): DeliveryPage[] {
  const unique = new Map<string, DeliveryPage>();
  for (const page of input.pages) {
    const previous = unique.get(page.ref);
    if (previous !== undefined && previous.content_digest !== page.content_digest) {
      throw new TypeError(`conflicting accepted page identity: ${page.ref}`);
    }
    unique.set(page.ref, page);
  }
  const ready = [...unique.values()].filter((page) => input.delivered[page.ref] !== page.content_digest)
    .sort((a, b) => a.priority - b.priority || a.ref.localeCompare(b.ref));
  if (ready.length === 0) return [];
  if (input.waveSize !== undefined) {
    if (input.requestedEarly || input.allAuthorsAccepted) {
      // Wave size counts themes, not derived pages. Keep the existing page cap.
      return ready.slice(0, 50);
    }
    return [];
  }
  if (!input.hasPriorDelivery && Object.keys(input.delivered).length === 0) {
    const firstBoundary = ready.slice(0, 50).findIndex((page) => page.boundary);
    return ready.slice(0, firstBoundary < 0 ? 3 : firstBoundary + 1);
  }
  if (input.requestedEarly || input.allAuthorsAccepted) return ready.slice(0, 50);
  const upper = Math.min(ready.length, 50);
  let boundary = -1;
  for (let index = 29; index < upper; index++) if (ready[index]!.boundary) boundary = index;
  if (boundary >= 29) return ready.slice(0, boundary + 1);
  return ready.length >= 50 ? ready.slice(0, 50) : [];
}
