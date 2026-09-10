---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "incident-review-c06-page",
  "profile": "incident-review",
  "reader_goal": "learn-from-incident",
  "applicability": {
    "artifact_policy_variants": [
      "standard"
    ],
    "condition_refs": []
  },
  "variables": [
    {
      "id": "context",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "decision",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "alternatives",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "impact",
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
      "id": "sources",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "context",
      "presence": "optional",
      "question_ref": "question:c06-context",
      "reader_goal": "learn-from-incident",
      "variable_ids": [
        "context"
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
      "section_key": "decision",
      "presence": "optional",
      "question_ref": "question:c06-decision",
      "reader_goal": "learn-from-incident",
      "variable_ids": [
        "decision"
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
      "section_key": "alternatives",
      "presence": "optional",
      "question_ref": "question:c06-alternatives",
      "reader_goal": "learn-from-incident",
      "variable_ids": [
        "alternatives"
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
      "section_key": "impact",
      "presence": "optional",
      "question_ref": "question:c06-impact",
      "reader_goal": "learn-from-incident",
      "variable_ids": [
        "impact"
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
      "question_ref": "question:c06-followup",
      "reader_goal": "learn-from-incident",
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
      "section_key": "sources",
      "presence": "optional",
      "question_ref": "question:c06-sources",
      "reader_goal": "learn-from-incident",
      "variable_ids": [
        "sources"
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
<!-- context:indexer-section context -->
## 背景与问题

{{variable:context}}
<!-- /context:indexer-section -->

<!-- context:indexer-section decision -->
## 结论与状态

{{variable:decision}}
<!-- /context:indexer-section -->

<!-- context:indexer-section alternatives -->
## 选项与取舍

{{variable:alternatives}}
<!-- /context:indexer-section -->

<!-- context:indexer-section impact -->
## 影响范围

{{variable:impact}}
<!-- /context:indexer-section -->

<!-- context:indexer-section followup -->
## 后续行动

{{variable:followup}}
<!-- /context:indexer-section -->

<!-- context:indexer-section sources -->
## 来源与版本

{{variable:sources}}
<!-- /context:indexer-section -->
