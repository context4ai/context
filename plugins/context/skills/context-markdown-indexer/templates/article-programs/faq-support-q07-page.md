---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "faq-support-q07-page",
  "profile": "faq-support",
  "reader_goal": "resolve-reader-question",
  "applicability": {
    "artifact_policy_variants": [
      "standard"
    ],
    "condition_refs": []
  },
  "variables": [
    {
      "id": "question",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "triggers",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "cause",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "repair",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "prevention",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "scope",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "answer",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "investigation",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "followup",
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
      "section_key": "question",
      "presence": "optional",
      "question_ref": "question:q07-question",
      "reader_goal": "resolve-reader-question",
      "variable_ids": [
        "question"
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
      "section_key": "triggers",
      "presence": "optional",
      "question_ref": "question:q07-triggers",
      "reader_goal": "resolve-reader-question",
      "variable_ids": [
        "triggers"
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
      "section_key": "cause",
      "presence": "optional",
      "question_ref": "question:q07-cause",
      "reader_goal": "resolve-reader-question",
      "variable_ids": [
        "cause"
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
      "section_key": "repair",
      "presence": "optional",
      "question_ref": "question:q07-repair",
      "reader_goal": "resolve-reader-question",
      "variable_ids": [
        "repair"
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
      "section_key": "prevention",
      "presence": "optional",
      "question_ref": "question:q07-prevention",
      "reader_goal": "resolve-reader-question",
      "variable_ids": [
        "prevention"
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
      "section_key": "scope",
      "presence": "optional",
      "question_ref": "question:q07-scope",
      "reader_goal": "resolve-reader-question",
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
      "section_key": "answer",
      "presence": "optional",
      "question_ref": "question:q07-answer",
      "reader_goal": "resolve-reader-question",
      "variable_ids": [
        "answer"
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
      "section_key": "investigation",
      "presence": "optional",
      "question_ref": "question:q07-investigation",
      "reader_goal": "resolve-reader-question",
      "variable_ids": [
        "investigation"
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
      "section_key": "followup",
      "presence": "optional",
      "question_ref": "question:q07-followup",
      "reader_goal": "resolve-reader-question",
      "variable_ids": [
        "followup"
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
      "question_ref": "question:q07-references",
      "reader_goal": "resolve-reader-question",
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
<!-- context:indexer-section question -->
## 问题与场景

{{variable:question}}
<!-- /context:indexer-section -->

<!-- context:indexer-section triggers -->
## 触发条件

{{variable:triggers}}
<!-- /context:indexer-section -->

<!-- context:indexer-section cause -->
## 根因与证据

{{variable:cause}}
<!-- /context:indexer-section -->

<!-- context:indexer-section repair -->
## 修复和验证

{{variable:repair}}
<!-- /context:indexer-section -->

<!-- context:indexer-section prevention -->
## 防复发检查

{{variable:prevention}}
<!-- /context:indexer-section -->

<!-- context:indexer-section scope -->
## 适用范围

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section answer -->
## 已确认结论

{{variable:answer}}
<!-- /context:indexer-section -->

<!-- context:indexer-section investigation -->
## 排查与证据

{{variable:investigation}}
<!-- /context:indexer-section -->

<!-- context:indexer-section followup -->
## 待查与下一步

{{variable:followup}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 来源与相关知识

{{variable:references}}
<!-- /context:indexer-section -->
