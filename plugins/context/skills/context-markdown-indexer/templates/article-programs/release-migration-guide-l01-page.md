---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "release-migration-guide-l01-page",
  "profile": "release-migration-guide",
  "reader_goal": "understand-release-change",
  "applicability": {
    "artifact_policy_variants": [
      "standard"
    ],
    "condition_refs": []
  },
  "variables": [
    {
      "id": "purpose",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "installation",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "capabilities",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "usage",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "contracts",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "limits",
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
      "section_key": "purpose",
      "presence": "optional",
      "question_ref": "question:l01-purpose",
      "reader_goal": "understand-release-change",
      "variable_ids": [
        "purpose"
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
      "section_key": "installation",
      "presence": "optional",
      "question_ref": "question:l01-installation",
      "reader_goal": "understand-release-change",
      "variable_ids": [
        "installation"
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
      "section_key": "capabilities",
      "presence": "optional",
      "question_ref": "question:l01-capabilities",
      "reader_goal": "understand-release-change",
      "variable_ids": [
        "capabilities"
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
      "section_key": "usage",
      "presence": "optional",
      "question_ref": "question:l01-usage",
      "reader_goal": "understand-release-change",
      "variable_ids": [
        "usage"
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
      "section_key": "contracts",
      "presence": "optional",
      "question_ref": "question:l01-contracts",
      "reader_goal": "understand-release-change",
      "variable_ids": [
        "contracts"
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
      "section_key": "limits",
      "presence": "optional",
      "question_ref": "question:l01-limits",
      "reader_goal": "understand-release-change",
      "variable_ids": [
        "limits"
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
      "question_ref": "question:l01-references",
      "reader_goal": "understand-release-change",
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
<!-- context:indexer-section purpose -->
## 用途与适用范围

{{variable:purpose}}
<!-- /context:indexer-section -->

<!-- context:indexer-section installation -->
## 安装与初始化

{{variable:installation}}
<!-- /context:indexer-section -->

<!-- context:indexer-section capabilities -->
## 主要能力

{{variable:capabilities}}
<!-- /context:indexer-section -->

<!-- context:indexer-section usage -->
## 典型用法

{{variable:usage}}
<!-- /context:indexer-section -->

<!-- context:indexer-section contracts -->
## 契约与扩展点

{{variable:contracts}}
<!-- /context:indexer-section -->

<!-- context:indexer-section limits -->
## 限制与兼容

{{variable:limits}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 源码与验证入口

{{variable:references}}
<!-- /context:indexer-section -->
