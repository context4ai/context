export const DOCUMENT_SECTION_CONTENT_MODES = ["verbatim", "empty"] as const;

export type DocumentSectionContentMode = typeof DOCUMENT_SECTION_CONTENT_MODES[number];

export type DocumentEvidenceSectionMetadata = {
  id: string;
  kind: string;
  content_mode: DocumentSectionContentMode;
  source_ref?: string;
  source_refs?: readonly string[];
};

export const DOCUMENT_EVIDENCE_SECTION_VALIDATION_STAGES = ["candidate", "approved"] as const;

export type DocumentEvidenceSectionValidationStage =
  typeof DOCUMENT_EVIDENCE_SECTION_VALIDATION_STAGES[number];

export type DocumentEvidenceSectionValidationOptions = {
  stage: DocumentEvidenceSectionValidationStage;
};

export const DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION = "context.compile-actions.v1";
export const DOCUMENT_STRUCTURE_SCHEMA_VERSION = "context.structure.v1";

const isContentMode = (value: unknown): value is DocumentSectionContentMode =>
  typeof value === "string" && (DOCUMENT_SECTION_CONTENT_MODES as readonly string[]).includes(value);

const isValidationStage = (value: unknown): value is DocumentEvidenceSectionValidationStage =>
  typeof value === "string" && (DOCUMENT_EVIDENCE_SECTION_VALIDATION_STAGES as readonly string[]).includes(value);

const sourceRefsFor = (section: DocumentEvidenceSectionMetadata): readonly string[] => {
  const refs = [
    ...(section.source_ref === undefined ? [] : [section.source_ref]),
    ...(section.source_refs ?? []),
  ];
  return refs.filter((ref) => ref.length > 0);
};

const assertNonEmptyString = (value: string, field: string): void => {
  if (value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
};

const assertNoSourceRefs = (section: DocumentEvidenceSectionMetadata, field: string): void => {
  if (sourceRefsFor(section).length > 0) {
    throw new TypeError(`${field} empty sections must not carry source refs`);
  }
};

const assertHasSourceRefs = (section: DocumentEvidenceSectionMetadata, field: string): void => {
  if (sourceRefsFor(section).length === 0) {
    throw new TypeError(`${field} ${section.content_mode} sections must carry source_ref or source_refs`);
  }
};

const assertApprovedSingleSourceRef = (section: DocumentEvidenceSectionMetadata, field: string): void => {
  if (section.source_refs !== undefined) {
    throw new TypeError(`${field}.source_refs is not supported for approved sections; use a single source_ref`);
  }
  if (section.source_ref === undefined || section.source_ref.length === 0) {
    throw new TypeError(`${field} approved sections must carry exactly one source_ref`);
  }
};

export const assertDocumentEvidenceSectionMetadata = (
  section: DocumentEvidenceSectionMetadata,
  options: DocumentEvidenceSectionValidationOptions,
  field = "document evidence section",
): void => {
  if (!isValidationStage(options?.stage)) {
    throw new TypeError(`${field} validation stage must be one of ${DOCUMENT_EVIDENCE_SECTION_VALIDATION_STAGES.join(", ")}`);
  }
  assertNonEmptyString(section.id, `${field}.id`);
  assertNonEmptyString(section.kind, `${field}.kind`);
  if (!isContentMode(section.content_mode)) {
    throw new TypeError(`${field}.content_mode must be one of ${DOCUMENT_SECTION_CONTENT_MODES.join(", ")}`);
  }
  if ((section as Record<string, unknown>).content_source_digest !== undefined) {
    throw new TypeError(`${field}.content_source_digest is not supported`);
  }

  if (options.stage === "approved") {
    assertApprovedSingleSourceRef(section, field);
    return;
  }

  if (section.content_mode === "empty") {
    assertNoSourceRefs(section, field);
    return;
  }

  assertHasSourceRefs(section, field);
};
