---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "domain-service-s03-page",
  "profile": "domain-service",
  "reader_goal": "look-up-public-contract",
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
      "id": "entry",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "validation",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "steps",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "downstream",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "response",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "concurrency",
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
    },
    {
      "id": "contract_api",
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
      "source_variable_id": "contract_api"
    }
  ],
  "sections": [
    {
      "section_key": "entry",
      "presence": "optional",
      "question_ref": "question:s03-entry",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "entry"
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
      "section_key": "validation",
      "presence": "optional",
      "question_ref": "question:s03-validation",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "validation"
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
      "section_key": "steps",
      "presence": "optional",
      "question_ref": "question:s03-steps",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "steps"
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
      "section_key": "contract_api",
      "presence": "optional",
      "question_ref": "question:public-contract",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "contract_api"
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
      "deletion_condition": "Omit when not applicable or no supported value is supplied."
    },
    {
      "section_key": "downstream",
      "presence": "optional",
      "question_ref": "question:s03-downstream",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "downstream"
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
      "section_key": "response",
      "presence": "optional",
      "question_ref": "question:s03-response",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "response"
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
      "section_key": "concurrency",
      "presence": "optional",
      "question_ref": "question:s03-concurrency",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "concurrency"
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
      "question_ref": "question:s03-references",
      "reader_goal": "look-up-public-contract",
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
<!-- context:indexer-section entry -->
## 用途与入口

{{variable:entry}}
<!-- /context:indexer-section -->

<!-- context:indexer-section validation -->
## 请求和边界校验

{{variable:validation}}
<!-- /context:indexer-section -->

<!-- context:indexer-section steps -->
## 处理步骤

{{variable:steps}}
<!-- /context:indexer-section -->

<!-- context:indexer-section contract_api -->
## API

{{block:api-table}}
<!-- /context:indexer-section -->

<!-- context:indexer-section downstream -->
## 数据与下游操作

{{variable:downstream}}
<!-- /context:indexer-section -->

<!-- context:indexer-section response -->
## 响应与错误

{{variable:response}}
<!-- /context:indexer-section -->

<!-- context:indexer-section concurrency -->
## 并发与幂等

{{variable:concurrency}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 调用方与入口

{{variable:references}}
<!-- /context:indexer-section -->
