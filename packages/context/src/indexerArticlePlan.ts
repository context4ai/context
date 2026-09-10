import { z } from "zod";
import type { IndexerArtifactResult } from "./indexerArtifactResult.js";
import { indexerKnowledgeDependencySchema } from "./indexerKnowledgeDependency.js";

/** Reader titles can change; these keys remain stable across revisions. */
export const indexerArticleKeySchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
export const indexerArticlePlanSchema = z.object({
  key: indexerArticleKeySchema,
  title: z.string().min(1),
  reader_task: z.string().min(1),
  artifact_intent: z.string().min(1),
  template_id: z.string().min(1).optional(),
  required: z.boolean(),
  sections: z.array(z.object({
    key: indexerArticleKeySchema,
    heading: z.string().min(1),
    required: z.boolean(),
  }).strict()).min(1),
  question_targets: z.array(z.string().min(1)).default([]),
  knowledge_dependencies: z.array(indexerKnowledgeDependencySchema).optional(),
}).strict();

export type IndexerArticlePlan = z.infer<typeof indexerArticlePlanSchema>;

export function validateIndexerArticlePlan(articles: readonly IndexerArticlePlan[], targets?: readonly string[]): void {
  if (!articles.length || !articles.some(article => article.required)) {
    throw new TypeError("article plan needs at least one required article; revise the current Partition plan");
  }
  const keys = new Set<string>(), owners = new Set<string>();
  for (const article of articles) {
    indexerArticlePlanSchema.parse(article);
    if (keys.has(article.key)) throw new TypeError(`duplicate article key ${article.key}; choose stable unique keys in Partition`);
    keys.add(article.key);
    if (new Set(article.sections.map(section => section.key)).size !== article.sections.length) {
      throw new TypeError(`article ${article.key} repeats a section key; revise its section plan`);
    }
    for (const target of article.question_targets) {
      if (!article.required || owners.has(target) || (targets !== undefined && !targets.includes(target))) {
        throw new TypeError(`article ${article.key} has invalid question responsibility ${target}; assign each group target to one required article`);
      }
      owners.add(target);
    }
  }
  if (targets?.some(target => !owners.has(target))) {
    throw new TypeError("article plan leaves a question without a primary article; revise the current Partition plan");
  }
}

export function indexerArticleSectionKey(article: string, section: string): string {
  return `${article}--${section}`;
}

/** Applies to both semantic submissions and programmatic Providers. */
export function validateIndexerPlannedArticles(result: IndexerArtifactResult, articles: readonly IndexerArticlePlan[]): Array<{ code: string; message: string }> {
  const warnings: Array<{ code: string; message: string }> = [];
  validateIndexerArticlePlan(articles);
  const planned = new Map(articles.map(article => [article.key, article]));
  for (const artifact of result.artifacts) {
    const article = planned.get(artifact.artifact_id);
    if (!article) throw new TypeError(`unplanned article ${artifact.artifact_id}; revise Partition before adding an article`);
    if (artifact.template_id !== article.template_id) {
      throw new TypeError(`article ${article.key} changes its accepted template; use the planned template or revise Partition`);
    }
    const sections = artifact.representation === "sections" ? artifact.sections : artifact.section_projections;
    const expected = new Map(article.sections.map(section => [indexerArticleSectionKey(article.key, section.key), section]));
    for (const section of sections) {
      if (!expected.has(section.section_key)) warnings.push({ code: "article-outline-drift", message: `Article ${article.key} includes additional section ${section.section_key}. Review its relevance; this does not block publication.` });
      const intent = [result.source_role, section.document_kind, section.reader_goal, section.artifact_kind].join("/");
      if (intent !== article.artifact_intent) throw new TypeError(`article ${article.key} changes its accepted intent; use ${article.artifact_intent}`);
    }
    for (const [key, section] of expected) {
      if (section.required && !sections.some(actual => actual.section_key === key)) {
        warnings.push({ code: "article-outline-gap", message: `Article ${article.key} omits suggested section ${section.key}. Explain material limits or add useful evidence when available; this does not block publication.` });
      }
    }
  }
  for (const article of articles) {
    if (article.required && !result.artifacts.some(artifact => artifact.artifact_id === article.key)) {
      throw new TypeError(`missing required article ${article.key}; complete the accepted article set before submitting`);
    }
  }
  return warnings;
}
