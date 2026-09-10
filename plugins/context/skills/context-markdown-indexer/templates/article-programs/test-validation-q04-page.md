---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "test-validation-q04-page",
  "profile": "test-validation",
  "reader_goal": "verify-behavior-or-acceptance",
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
      "id": "smoke",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "selection",
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
      "id": "records",
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
      "id": "failures",
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
    },
    {
      "id": "conclusion",
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
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "context",
      "presence": "optional",
      "question_ref": "question:q04-context",
      "reader_goal": "verify-behavior-or-acceptance",
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
      "section_key": "smoke",
      "presence": "optional",
      "question_ref": "question:q04-smoke",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "smoke"
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
      "section_key": "selection",
      "presence": "optional",
      "question_ref": "question:q04-selection",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "selection"
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
      "question_ref": "question:q04-prerequisites",
      "reader_goal": "verify-behavior-or-acceptance",
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
      "section_key": "records",
      "presence": "optional",
      "question_ref": "question:q04-records",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "records"
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
      "question_ref": "question:q04-results",
      "reader_goal": "verify-behavior-or-acceptance",
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
      "section_key": "failures",
      "presence": "optional",
      "question_ref": "question:q04-failures",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "failures"
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
      "question_ref": "question:q04-evidence",
      "reader_goal": "verify-behavior-or-acceptance",
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
    },
    {
      "section_key": "conclusion",
      "presence": "optional",
      "question_ref": "question:q04-conclusion",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "conclusion"
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
      "question_ref": "question:q04-followup",
      "reader_goal": "verify-behavior-or-acceptance",
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
## 适用范围与版本

{{variable:context}}
<!-- /context:indexer-section -->

<!-- context:indexer-section smoke -->
## 冒烟场景集

{{variable:smoke}}
<!-- /context:indexer-section -->

<!-- context:indexer-section selection -->
## 变更影响与回归选择

{{variable:selection}}
<!-- /context:indexer-section -->

<!-- context:indexer-section prerequisites -->
## 执行前提

{{variable:prerequisites}}
<!-- /context:indexer-section -->

<!-- context:indexer-section records -->
## 结果记录入口

{{variable:records}}
<!-- /context:indexer-section -->

<!-- context:indexer-section results -->
## 实际结果

{{variable:results}}
<!-- /context:indexer-section -->

<!-- context:indexer-section failures -->
## 失败与阻塞

{{variable:failures}}
<!-- /context:indexer-section -->

<!-- context:indexer-section evidence -->
## 执行证据

{{variable:evidence}}
<!-- /context:indexer-section -->

<!-- context:indexer-section conclusion -->
## 结论与限制

{{variable:conclusion}}
<!-- /context:indexer-section -->

<!-- context:indexer-section followup -->
## 后续处理

{{variable:followup}}
<!-- /context:indexer-section -->
