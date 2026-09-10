---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "runbook-s07-page",
  "profile": "runbook",
  "reader_goal": "operate-or-recover-system",
  "applicability": {
    "artifact_policy_variants": [
      "standard"
    ],
    "condition_refs": []
  },
  "variables": [
    {
      "id": "triggers",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "registration",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "payload",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "processing",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "retry",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "reconciliation",
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
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "triggers",
      "presence": "optional",
      "question_ref": "question:s07-triggers",
      "reader_goal": "operate-or-recover-system",
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
      "section_key": "registration",
      "presence": "optional",
      "question_ref": "question:s07-registration",
      "reader_goal": "operate-or-recover-system",
      "variable_ids": [
        "registration"
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
      "section_key": "payload",
      "presence": "optional",
      "question_ref": "question:s07-payload",
      "reader_goal": "operate-or-recover-system",
      "variable_ids": [
        "payload"
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
      "section_key": "processing",
      "presence": "optional",
      "question_ref": "question:s07-processing",
      "reader_goal": "operate-or-recover-system",
      "variable_ids": [
        "processing"
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
      "section_key": "retry",
      "presence": "optional",
      "question_ref": "question:s07-retry",
      "reader_goal": "operate-or-recover-system",
      "variable_ids": [
        "retry"
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
      "section_key": "reconciliation",
      "presence": "optional",
      "question_ref": "question:s07-reconciliation",
      "reader_goal": "operate-or-recover-system",
      "variable_ids": [
        "reconciliation"
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
      "question_ref": "question:s07-operations",
      "reader_goal": "operate-or-recover-system",
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
<!-- context:indexer-section triggers -->
## 职责与触发源

{{variable:triggers}}
<!-- /context:indexer-section -->

<!-- context:indexer-section registration -->
## 注册与订阅

{{variable:registration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section payload -->
## Payload 与过滤

{{variable:payload}}
<!-- /context:indexer-section -->

<!-- context:indexer-section processing -->
## 处理链路

{{variable:processing}}
<!-- /context:indexer-section -->

<!-- context:indexer-section retry -->
## 重试幂等与并发

{{variable:retry}}
<!-- /context:indexer-section -->

<!-- context:indexer-section reconciliation -->
## 检查点补偿与对账

{{variable:reconciliation}}
<!-- /context:indexer-section -->

<!-- context:indexer-section operations -->
## 运行和观测入口

{{variable:operations}}
<!-- /context:indexer-section -->
