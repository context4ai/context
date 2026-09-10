---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "event-consumer-c07-page",
  "profile": "event-consumer",
  "reader_goal": "modify-or-diagnose-module",
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
      "id": "entries",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "identity",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "reading",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "boundaries",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "evidence",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "entries",
      "presence": "optional",
      "question_ref": "question:c07-entries",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "entries"
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
      "section_key": "identity",
      "presence": "optional",
      "question_ref": "question:c07-identity",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "identity"
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
      "section_key": "reading",
      "presence": "optional",
      "question_ref": "question:c07-reading",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "reading"
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
      "section_key": "boundaries",
      "presence": "optional",
      "question_ref": "question:c07-boundaries",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "boundaries"
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
      "section_key": "evidence",
      "presence": "optional",
      "question_ref": "question:c07-evidence",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "evidence"
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
<!-- context:indexer-section entries -->
## 问题到入口

{{variable:entries}}
<!-- /context:indexer-section -->

<!-- context:indexer-section identity -->
## 源码身份与版本

{{variable:identity}}
<!-- /context:indexer-section -->

<!-- context:indexer-section reading -->
## 推荐阅读顺序

{{variable:reading}}
<!-- /context:indexer-section -->

<!-- context:indexer-section boundaries -->
## 外部边界

{{variable:boundaries}}
<!-- /context:indexer-section -->

<!-- context:indexer-section evidence -->
## 进一步证据

{{variable:evidence}}
<!-- /context:indexer-section -->
