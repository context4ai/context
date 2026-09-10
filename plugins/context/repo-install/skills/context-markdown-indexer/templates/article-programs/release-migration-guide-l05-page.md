---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "release-migration-guide-l05-page",
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
      "id": "packages",
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
      "id": "catalog",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "configuration",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "compatibility",
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
      "question_ref": "question:l05-purpose",
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
      "section_key": "packages",
      "presence": "optional",
      "question_ref": "question:l05-packages",
      "reader_goal": "understand-release-change",
      "variable_ids": [
        "packages"
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
      "question_ref": "question:l05-setup",
      "reader_goal": "understand-release-change",
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
      "section_key": "catalog",
      "presence": "optional",
      "question_ref": "question:l05-catalog",
      "reader_goal": "understand-release-change",
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
      "section_key": "configuration",
      "presence": "optional",
      "question_ref": "question:l05-configuration",
      "reader_goal": "understand-release-change",
      "variable_ids": [
        "configuration"
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
      "section_key": "compatibility",
      "presence": "optional",
      "question_ref": "question:l05-compatibility",
      "reader_goal": "understand-release-change",
      "variable_ids": [
        "compatibility"
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
      "question_ref": "question:l05-references",
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
## 定位与适用平台

{{variable:purpose}}
<!-- /context:indexer-section -->

<!-- context:indexer-section packages -->
## 软件包版本与维护状态

{{variable:packages}}
<!-- /context:indexer-section -->

<!-- context:indexer-section setup -->
## 安装与全局接入

{{variable:setup}}
<!-- /context:indexer-section -->

<!-- context:indexer-section catalog -->
## 组件分类与选择导航

{{variable:catalog}}
<!-- /context:indexer-section -->

<!-- context:indexer-section configuration -->
## 公共配置资源与设计系统

{{variable:configuration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section compatibility -->
## 兼容迁移与限制

{{variable:compatibility}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 示例文档与源码

{{variable:references}}
<!-- /context:indexer-section -->
