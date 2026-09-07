---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "cli-tool-maintenance-guide",
  "profile": "cli-tool",
  "reader_goal": "modify-or-diagnose-module",
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
      "reader_goal": "modify-or-diagnose-module",
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
    "split_suggestion": "Explain responsibility, registration, state, persistence and downstream handoffs, actual success and error handling, and change entrypoints. Include only implementation details useful to this maintenance task.",
    "semantic_boundaries": [
      "reader-task",
      "public-contract"
    ],
    "keep_single_page_conditions": [
      "one-reader-subject"
    ]
  },
  "anonymous_section_examples": [
    "A declared parameter with an explicit default and a source-backed usage explanation."
  ],
  "anti_examples": [
    "Inferring server behavior from a generated client."
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
