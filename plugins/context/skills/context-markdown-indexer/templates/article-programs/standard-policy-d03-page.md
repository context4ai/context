---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "standard-policy-d03-page",
  "profile": "standard-policy",
  "reader_goal": "follow-standard-or-policy",
  "applicability": {
    "artifact_policy_variants": [
      "standard"
    ],
    "condition_refs": []
  },
  "variables": [
    {
      "id": "scope",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "catalog",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "conditions",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "implementation",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "conflicts",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "references",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "scope",
      "presence": "optional",
      "question_ref": "question:d03-scope",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "scope"
      ],
      "deterministic_block_ids": [],
      "accepted_evidence_kinds": [
        "code",
        "contract",
        "configuration",
        "documentation"
      ],
      "minimum_evidence_items": 0,
      "on_missing": "omit",
      "deletion_condition": "Omit when not applicable or no supported value is supplied."
    },
    {
      "section_key": "catalog",
      "presence": "optional",
      "question_ref": "question:d03-catalog",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "catalog"
      ],
      "deterministic_block_ids": [],
      "accepted_evidence_kinds": [
        "code",
        "contract",
        "configuration",
        "documentation"
      ],
      "minimum_evidence_items": 0,
      "on_missing": "omit",
      "deletion_condition": "Omit when not applicable or no supported value is supplied."
    },
    {
      "section_key": "conditions",
      "presence": "optional",
      "question_ref": "question:d03-conditions",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "conditions"
      ],
      "deterministic_block_ids": [],
      "accepted_evidence_kinds": [
        "code",
        "contract",
        "configuration",
        "documentation"
      ],
      "minimum_evidence_items": 0,
      "on_missing": "omit",
      "deletion_condition": "Omit when not applicable or no supported value is supplied."
    },
    {
      "section_key": "implementation",
      "presence": "optional",
      "question_ref": "question:d03-implementation",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "implementation"
      ],
      "deterministic_block_ids": [],
      "accepted_evidence_kinds": [
        "code",
        "contract",
        "configuration",
        "documentation"
      ],
      "minimum_evidence_items": 0,
      "on_missing": "omit",
      "deletion_condition": "Omit when not applicable or no supported value is supplied."
    },
    {
      "section_key": "conflicts",
      "presence": "optional",
      "question_ref": "question:d03-conflicts",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "conflicts"
      ],
      "deterministic_block_ids": [],
      "accepted_evidence_kinds": [
        "code",
        "contract",
        "configuration",
        "documentation"
      ],
      "minimum_evidence_items": 0,
      "on_missing": "omit",
      "deletion_condition": "Omit when not applicable or no supported value is supplied."
    },
    {
      "section_key": "references",
      "presence": "optional",
      "question_ref": "question:d03-references",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "references"
      ],
      "deterministic_block_ids": [],
      "accepted_evidence_kinds": [
        "code",
        "contract",
        "configuration",
        "documentation"
      ],
      "minimum_evidence_items": 0,
      "on_missing": "omit",
      "deletion_condition": "Omit when not applicable or no supported value is supplied."
    }
  ],
  "page_policy": {
    "split_suggestion": "Split by independently useful reader task when supported; preserve stable article identities.",
    "semantic_boundaries": [
      "reader-task",
      "source-boundary"
    ],
    "keep_single_page_conditions": [
      "one-reader-subject"
    ]
  },
  "anonymous_section_examples": [
    "A source-backed explanation that names an entry and the next investigation step."
  ],
  "anti_examples": [
    "Invented relationships or current runtime values inferred from names alone."
  ],
  "forbidden_outputs": [
    "Unresolved internal identifiers in reader-facing prose."
  ],
  "maximum_rendered_bytes": 1048576
}
---
<!-- context:indexer-section scope -->
## 业务与版本

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section catalog -->
## 规则分类

{{variable:catalog}}
<!-- /context:indexer-section -->

<!-- context:indexer-section conditions -->
## 条件与结果

{{variable:conditions}}
<!-- /context:indexer-section -->

<!-- context:indexer-section implementation -->
## 执行位置

{{variable:implementation}}
<!-- /context:indexer-section -->

<!-- context:indexer-section conflicts -->
## 例外与冲突

{{variable:conflicts}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 相关流程

{{variable:references}}
<!-- /context:indexer-section -->
