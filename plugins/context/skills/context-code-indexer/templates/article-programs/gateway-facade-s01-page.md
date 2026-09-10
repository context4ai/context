---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "gateway-facade-s01-page",
  "profile": "gateway-facade",
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
      "id": "scope",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "startup",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "architecture",
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
      "id": "dependencies",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "index",
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
      "section_key": "scope",
      "presence": "optional",
      "question_ref": "question:s01-scope",
      "reader_goal": "look-up-public-contract",
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
      "section_key": "startup",
      "presence": "optional",
      "question_ref": "question:s01-startup",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "startup"
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
      "section_key": "architecture",
      "presence": "optional",
      "question_ref": "question:s01-architecture",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "architecture"
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
      "question_ref": "question:s01-capabilities",
      "reader_goal": "look-up-public-contract",
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
      "section_key": "dependencies",
      "presence": "optional",
      "question_ref": "question:s01-dependencies",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "dependencies"
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
      "section_key": "index",
      "presence": "optional",
      "question_ref": "question:s01-index",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "index"
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
      "question_ref": "question:s01-sources",
      "reader_goal": "look-up-public-contract",
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
<!-- context:indexer-section scope -->
## 服务定位

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section startup -->
## 接入和启动

{{variable:startup}}
<!-- /context:indexer-section -->

<!-- context:indexer-section architecture -->
## 架构分层

{{variable:architecture}}
<!-- /context:indexer-section -->

<!-- context:indexer-section capabilities -->
## 核心能力与接口

{{variable:capabilities}}
<!-- /context:indexer-section -->

<!-- context:indexer-section dependencies -->
## 模型和依赖摘要

{{variable:dependencies}}
<!-- /context:indexer-section -->

<!-- context:indexer-section index -->
## 知识索引

{{variable:index}}
<!-- /context:indexer-section -->

<!-- context:indexer-section sources -->
## 源码位置

{{variable:sources}}
<!-- /context:indexer-section -->
