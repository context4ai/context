import { indexerArticleSectionKey, validateIndexerArticlePlan, type IndexerArticlePlan, type IndexerAuthorSemanticInput } from "@c4a/context";

export interface AuthorArticle {
  key: string;
  title: string;
  summary: string;
  section_keys: string[];
  artifact_intent?: string;
  template_id?: string;
  template_variables?: NonNullable<IndexerAuthorSemanticInput["template_variables"]>;
}

/** One inventory disposition per group, even when several articles cite it. */
export function prepareAuthorArticles(semantic: IndexerAuthorSemanticInput, plan: readonly IndexerArticlePlan[] | undefined) {
  if (plan === undefined) {
    if (semantic.articles !== undefined) throw new TypeError("articles require an accepted article plan; revise Partition first");
    return { semantic, articles: undefined };
  }
  validateIndexerArticlePlan(plan);
  if (semantic.outcome !== "publish" || semantic.articles === undefined) {
    throw new TypeError("the accepted plan requires articles; provide the required article set, or resolve missing material through the current task");
  }
  if (semantic.sections.length || semantic.template_variables !== undefined || semantic.artifact_intent !== undefined) {
    throw new TypeError("multi-article Author uses per-article sections, variables and intent; remove the legacy page fields");
  }
  const selected = new Set<string>();
  const articles: AuthorArticle[] = [];
  const sections: IndexerAuthorSemanticInput["sections"] = [];
  for (const article of semantic.articles) {
    const accepted = plan.find(item => item.key === article.key);
    if (!accepted || selected.has(article.key)) throw new TypeError(`unknown or duplicate article ${article.key}; follow the accepted article plan`);
    selected.add(article.key);
    if (article.artifact_intent !== undefined && article.artifact_intent !== accepted.artifact_intent) {
      throw new TypeError(`article ${article.key} changes its planned intent; use ${accepted.artifact_intent}`);
    }
    const localKeys = new Set<string>();
    for (const section of article.sections) {
      if (localKeys.has(section.key)) {
        throw new TypeError(`duplicate section ${article.key}/${section.key}; follow the accepted section plan`);
      }
      localKeys.add(section.key);
      sections.push({ ...section, key: indexerArticleSectionKey(article.key, section.key) });
    }
    articles.push({ key: article.key, title: article.title, summary: article.summary,
      section_keys: article.sections.map(section => indexerArticleSectionKey(article.key, section.key)),
      artifact_intent: accepted.artifact_intent,
      ...(accepted.template_id === undefined ? {} : { template_id: accepted.template_id }),
      ...(article.template_variables === undefined ? {} : { template_variables: article.template_variables }),
    });
  }
  for (const article of plan) if (article.required && !selected.has(article.key)) {
    throw new TypeError(`missing required article ${article.key}; complete the accepted article set before submitting`);
  }
  const members = semantic.member_dispositions.map(entry => {
    if (entry.state !== "covered") return entry;
    if (!entry.article || !selected.has(entry.article) || !sections.some(section => section.key === indexerArticleSectionKey(entry.article!, entry.section ?? ""))) {
      throw new TypeError(`member ${entry.item} needs an article and section from the submitted set`);
    }
    return { ...entry, section: indexerArticleSectionKey(entry.article, entry.section!) };
  });
  return { semantic: { ...semantic, sections, member_dispositions: members }, articles };
}
