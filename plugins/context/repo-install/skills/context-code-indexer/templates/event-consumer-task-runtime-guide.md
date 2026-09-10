---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "event-consumer-task-runtime-guide",
  "profile": "event-consumer",
  "reader_goal": "operate-or-extend-task",
  "applicability": {
    "artifact_policy_variants": [
      "standard",
      "compact",
      "expanded"
    ],
    "condition_refs": []
  },
  "variables": [
    {
      "id": "api",
      "type": "json",
      "content_layer": "deterministic-fact",
      "required": false,
      "evidence_required": true
    }
  ],
  "deterministic_blocks": [
    {
      "id": "api-table",
      "renderer": "public-contract-table",
      "source_variable_id": "api"
    }
  ],
  "sections": [
    {
      "section_key": "api",
      "presence": "optional",
      "question_ref": "question:public-contract",
      "reader_goal": "operate-or-extend-task",
      "variable_ids": [
        "api"
      ],
      "deterministic_block_ids": [
        "api-table"
      ],
      "accepted_evidence_kinds": [
        "code",
        "contract",
        "configuration",
        "documentation"
      ],
      "minimum_evidence_items": 0,
      "on_missing": "omit",
      "deletion_condition": "Omit when no authorized structured contract is available."
    }
  ],
  "page_policy": {
    "split_suggestion": "Explain trigger and registration, input routing, effects and actual success conditions, then only source-supported retry, idempotency, compensation and operational guidance. Function success is not automatically business completion.",
    "semantic_boundaries": [
      "reader-task",
      "public-contract"
    ],
    "keep_single_page_conditions": [
      "one-reader-subject"
    ]
  },
  "anonymous_section_examples": [
    "A source-backed explanation of when to use an operation and how its options interact, referring to the generated API table without repeating its rows."
  ],
  "anti_examples": [
    "Inferring server behavior from a generated client.",
    "Duplicating a program-generated API table in prose or using prose to contradict its field values."
  ],
  "forbidden_outputs": [
    "Unresolved internal identifiers in reader-facing tables."
  ],
  "maximum_rendered_bytes": 1048576
}
---
<!-- context:indexer-section api -->
## API

{{block:api-table}}
<!-- /context:indexer-section -->
