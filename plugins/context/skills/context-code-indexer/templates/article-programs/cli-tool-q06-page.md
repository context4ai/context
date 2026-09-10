---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "cli-tool-q06-page",
  "profile": "cli-tool",
  "reader_goal": "integrate-capability",
  "applicability": {
    "artifact_policy_variants": [
      "compact",
      "standard",
      "expanded"
    ],
    "condition_refs": []
  },
  "variables": [
    {
      "id": "tasks",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "prerequisites",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "operations",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "results",
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
      "section_key": "tasks",
      "presence": "optional",
      "question_ref": "question:q06-tasks",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "tasks"
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
      "section_key": "prerequisites",
      "presence": "optional",
      "question_ref": "question:q06-prerequisites",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "prerequisites"
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
      "section_key": "operations",
      "presence": "optional",
      "question_ref": "question:q06-operations",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "operations"
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
      "section_key": "results",
      "presence": "optional",
      "question_ref": "question:q06-results",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "results"
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
      "question_ref": "question:q06-references",
      "reader_goal": "integrate-capability",
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
<!-- context:indexer-section tasks -->
## 任务到工具

{{variable:tasks}}
<!-- /context:indexer-section -->

<!-- context:indexer-section prerequisites -->
## 接入前提

{{variable:prerequisites}}
<!-- /context:indexer-section -->

<!-- context:indexer-section operations -->
## 常用操作

{{variable:operations}}
<!-- /context:indexer-section -->

<!-- context:indexer-section results -->
## 结果解释

{{variable:results}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 代码与文档入口

{{variable:references}}
<!-- /context:indexer-section -->
