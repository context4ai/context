---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "event-consumer-s06-page",
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
      "id": "overview",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "requests",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "events",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "storage",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "initialization",
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
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "overview",
      "presence": "optional",
      "question_ref": "question:s06-overview",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "overview"
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
      "section_key": "requests",
      "presence": "optional",
      "question_ref": "question:s06-requests",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "requests"
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
      "section_key": "events",
      "presence": "optional",
      "question_ref": "question:s06-events",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "events"
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
      "section_key": "storage",
      "presence": "optional",
      "question_ref": "question:s06-storage",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "storage"
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
      "section_key": "initialization",
      "presence": "optional",
      "question_ref": "question:s06-initialization",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "initialization"
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
      "question_ref": "question:s06-failures",
      "reader_goal": "modify-or-diagnose-module",
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
<!-- context:indexer-section overview -->
## 依赖概览

{{variable:overview}}
<!-- /context:indexer-section -->

<!-- context:indexer-section requests -->
## RPC 与 HTTP

{{variable:requests}}
<!-- /context:indexer-section -->

<!-- context:indexer-section events -->
## 事件与任务

{{variable:events}}
<!-- /context:indexer-section -->

<!-- context:indexer-section storage -->
## 存储及配置服务

{{variable:storage}}
<!-- /context:indexer-section -->

<!-- context:indexer-section initialization -->
## 初始化与选择

{{variable:initialization}}
<!-- /context:indexer-section -->

<!-- context:indexer-section failures -->
## 故障边界和下一步

{{variable:failures}}
<!-- /context:indexer-section -->
