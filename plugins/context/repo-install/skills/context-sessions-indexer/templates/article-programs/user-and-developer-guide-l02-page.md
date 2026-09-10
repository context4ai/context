---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "user-and-developer-guide-l02-page",
  "profile": "user-and-developer-guide",
  "reader_goal": "understand-product-intent",
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
      "id": "setup",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "scenarios",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "api",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "behavior",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "styles",
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
      "question_ref": "question:l02-purpose",
      "reader_goal": "understand-product-intent",
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
      "section_key": "setup",
      "presence": "optional",
      "question_ref": "question:l02-setup",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "setup"
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
      "section_key": "scenarios",
      "presence": "optional",
      "question_ref": "question:l02-scenarios",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "scenarios"
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
      "section_key": "api",
      "presence": "optional",
      "question_ref": "question:l02-api",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "api"
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
      "section_key": "behavior",
      "presence": "optional",
      "question_ref": "question:l02-behavior",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "behavior"
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
      "section_key": "styles",
      "presence": "optional",
      "question_ref": "question:l02-styles",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "styles"
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
      "question_ref": "question:l02-limits",
      "reader_goal": "understand-product-intent",
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
      "question_ref": "question:l02-references",
      "reader_goal": "understand-product-intent",
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
## 用途与选用

{{variable:purpose}}
<!-- /context:indexer-section -->

<!-- context:indexer-section setup -->
## 接入与基本用法

{{variable:setup}}
<!-- /context:indexer-section -->

<!-- context:indexer-section scenarios -->
## 场景与变体

{{variable:scenarios}}
<!-- /context:indexer-section -->

<!-- context:indexer-section api -->
## API 与公开契约

{{variable:api}}
<!-- /context:indexer-section -->

<!-- context:indexer-section behavior -->
## 行为与组合规则

{{variable:behavior}}
<!-- /context:indexer-section -->

<!-- context:indexer-section styles -->
## 样式与设计系统

{{variable:styles}}
<!-- /context:indexer-section -->

<!-- context:indexer-section limits -->
## 环境可访问性与限制

{{variable:limits}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 相关组件与源码入口

{{variable:references}}
<!-- /context:indexer-section -->
