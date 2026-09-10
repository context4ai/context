---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "event-consumer-q05-page",
  "profile": "event-consumer",
  "reader_goal": "operate-or-extend-task",
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
      "id": "requirements",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "preparation",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "isolation",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "lifecycle",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "verification",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "requirements",
      "presence": "optional",
      "question_ref": "question:q05-requirements",
      "reader_goal": "operate-or-extend-task",
      "variable_ids": [
        "requirements"
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
      "section_key": "preparation",
      "presence": "optional",
      "question_ref": "question:q05-preparation",
      "reader_goal": "operate-or-extend-task",
      "variable_ids": [
        "preparation"
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
      "section_key": "isolation",
      "presence": "optional",
      "question_ref": "question:q05-isolation",
      "reader_goal": "operate-or-extend-task",
      "variable_ids": [
        "isolation"
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
      "section_key": "lifecycle",
      "presence": "optional",
      "question_ref": "question:q05-lifecycle",
      "reader_goal": "operate-or-extend-task",
      "variable_ids": [
        "lifecycle"
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
      "section_key": "verification",
      "presence": "optional",
      "question_ref": "question:q05-verification",
      "reader_goal": "operate-or-extend-task",
      "variable_ids": [
        "verification"
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
<!-- context:indexer-section requirements -->
## 数据需求

{{variable:requirements}}
<!-- /context:indexer-section -->

<!-- context:indexer-section preparation -->
## 准备入口

{{variable:preparation}}
<!-- /context:indexer-section -->

<!-- context:indexer-section isolation -->
## 环境和隔离

{{variable:isolation}}
<!-- /context:indexer-section -->

<!-- context:indexer-section lifecycle -->
## 数据生命周期

{{variable:lifecycle}}
<!-- /context:indexer-section -->

<!-- context:indexer-section verification -->
## 验证和清理

{{variable:verification}}
<!-- /context:indexer-section -->
