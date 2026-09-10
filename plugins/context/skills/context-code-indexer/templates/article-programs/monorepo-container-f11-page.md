---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "monorepo-container-f11-page",
  "profile": "monorepo-container",
  "reader_goal": "integrate-capability",
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
      "id": "scope",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "catalog",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "ownership",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "integration",
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
      "id": "capabilities",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "navigation",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "delivery",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "details",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "scope",
      "presence": "optional",
      "question_ref": "question:f11-scope",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "scope"
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
      "section_key": "catalog",
      "presence": "optional",
      "question_ref": "question:f11-catalog",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "catalog"
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
      "section_key": "ownership",
      "presence": "optional",
      "question_ref": "question:f11-ownership",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "ownership"
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
      "section_key": "integration",
      "presence": "optional",
      "question_ref": "question:f11-integration",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "integration"
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
      "question_ref": "question:f11-contracts",
      "reader_goal": "integrate-capability",
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
      "section_key": "capabilities",
      "presence": "optional",
      "question_ref": "question:f11-capabilities",
      "reader_goal": "integrate-capability",
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
      "section_key": "navigation",
      "presence": "optional",
      "question_ref": "question:f11-navigation",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "navigation"
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
      "section_key": "delivery",
      "presence": "optional",
      "question_ref": "question:f11-delivery",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "delivery"
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
      "section_key": "details",
      "presence": "optional",
      "question_ref": "question:f11-details",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "details"
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
<!-- context:indexer-section scope -->
## 子应用范围

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section catalog -->
## 子应用目录

{{variable:catalog}}
<!-- /context:indexer-section -->

<!-- context:indexer-section ownership -->
## 入口与职责

{{variable:ownership}}
<!-- /context:indexer-section -->

<!-- context:indexer-section integration -->
## 宿主接入

{{variable:integration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section contracts -->
## 共享契约

{{variable:contracts}}
<!-- /context:indexer-section -->

<!-- context:indexer-section capabilities -->
## 暴露能力与入口

{{variable:capabilities}}
<!-- /context:indexer-section -->

<!-- context:indexer-section navigation -->
## 页面与 API 导航

{{variable:navigation}}
<!-- /context:indexer-section -->

<!-- context:indexer-section delivery -->
## 开发交付差异

{{variable:delivery}}
<!-- /context:indexer-section -->

<!-- context:indexer-section details -->
## 详情与下一步

{{variable:details}}
<!-- /context:indexer-section -->
