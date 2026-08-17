import type { ProseCandidateSection } from "./candidateLedger.js";

export function proseSectionMarkdown(section: ProseCandidateSection): string {
  return [
    section.title !== undefined ? `## ${section.title}` : "",
    section.summary !== undefined ? `> ${section.summary}` : "",
    section.body ?? "",
  ].filter((part) => part.trim().length > 0).join("\n\n").trimEnd();
}

export function proseMarkdownFromSections(sections: readonly ProseCandidateSection[] | undefined): string {
  return (sections ?? [])
    .map((section) => proseSectionMarkdown(section))
    .filter((section) => section.trim().length > 0)
    .join("\n\n");
}

export function proseCandidateMarkdown(input: {
  body?: string;
  sections?: readonly ProseCandidateSection[];
}): string {
  if (input.sections !== undefined && input.sections.length > 0) {
    return proseMarkdownFromSections(input.sections);
  }
  return input.body ?? "";
}
