---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "technical-guide-l03-page",
  "profile": "technical-guide",
  "reader_goal": "understand-technical-design",
  "applicability": {
    "artifact_policy_variants": [
      "standard"
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
      "id": "packages",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "foundations",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "components",
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
      "id": "adoption",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "purpose",
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
      "id": "mapping",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "consumption",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "rules",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "environment",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "globals",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "inheritance",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "resources",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "ssr",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "platforms",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "verification",
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
      "section_key": "scope",
      "presence": "optional",
      "question_ref": "question:l03-scope",
      "reader_goal": "understand-technical-design",
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
      "section_key": "packages",
      "presence": "optional",
      "question_ref": "question:l03-packages",
      "reader_goal": "understand-technical-design",
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
      "section_key": "foundations",
      "presence": "optional",
      "question_ref": "question:l03-foundations",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "foundations"
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
      "section_key": "components",
      "presence": "optional",
      "question_ref": "question:l03-components",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "components"
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
      "question_ref": "question:l03-configuration",
      "reader_goal": "understand-technical-design",
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
      "section_key": "adoption",
      "presence": "optional",
      "question_ref": "question:l03-adoption",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "adoption"
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
      "section_key": "purpose",
      "presence": "optional",
      "question_ref": "question:l03-purpose",
      "reader_goal": "understand-technical-design",
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
      "section_key": "catalog",
      "presence": "optional",
      "question_ref": "question:l03-catalog",
      "reader_goal": "understand-technical-design",
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
      "section_key": "mapping",
      "presence": "optional",
      "question_ref": "question:l03-mapping",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "mapping"
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
      "section_key": "consumption",
      "presence": "optional",
      "question_ref": "question:l03-consumption",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "consumption"
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
      "section_key": "rules",
      "presence": "optional",
      "question_ref": "question:l03-rules",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "rules"
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
      "section_key": "environment",
      "presence": "optional",
      "question_ref": "question:l03-environment",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "environment"
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
      "section_key": "globals",
      "presence": "optional",
      "question_ref": "question:l03-globals",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "globals"
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
      "section_key": "inheritance",
      "presence": "optional",
      "question_ref": "question:l03-inheritance",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "inheritance"
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
      "section_key": "resources",
      "presence": "optional",
      "question_ref": "question:l03-resources",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "resources"
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
      "section_key": "ssr",
      "presence": "optional",
      "question_ref": "question:l03-ssr",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "ssr"
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
      "section_key": "platforms",
      "presence": "optional",
      "question_ref": "question:l03-platforms",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "platforms"
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
      "section_key": "verification",
      "presence": "optional",
      "question_ref": "question:l03-verification",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "verification"
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
      "question_ref": "question:l03-references",
      "reader_goal": "understand-technical-design",
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
<!-- context:indexer-section scope -->
## 目标与适用范围

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section packages -->
## 平台软件包与版本

{{variable:packages}}
<!-- /context:indexer-section -->

<!-- context:indexer-section foundations -->
## 基础规范地图

{{variable:foundations}}
<!-- /context:indexer-section -->

<!-- context:indexer-section components -->
## 组件与交互模式

{{variable:components}}
<!-- /context:indexer-section -->

<!-- context:indexer-section configuration -->
## 主题及运行配置

{{variable:configuration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section adoption -->
## 采用定制与迁移

{{variable:adoption}}
<!-- /context:indexer-section -->

<!-- context:indexer-section purpose -->
## 用途与语义

{{variable:purpose}}
<!-- /context:indexer-section -->

<!-- context:indexer-section catalog -->
## 分类与 Token 目录

{{variable:catalog}}
<!-- /context:indexer-section -->

<!-- context:indexer-section mapping -->
## 命名及对应关系

{{variable:mapping}}
<!-- /context:indexer-section -->

<!-- context:indexer-section consumption -->
## 消费方式

{{variable:consumption}}
<!-- /context:indexer-section -->

<!-- context:indexer-section rules -->
## 组合与适用规则

{{variable:rules}}
<!-- /context:indexer-section -->

<!-- context:indexer-section environment -->
## 环境与 Provider

{{variable:environment}}
<!-- /context:indexer-section -->

<!-- context:indexer-section globals -->
## 全局配置

{{variable:globals}}
<!-- /context:indexer-section -->

<!-- context:indexer-section inheritance -->
## 继承与局部覆盖

{{variable:inheritance}}
<!-- /context:indexer-section -->

<!-- context:indexer-section resources -->
## CSS 与资源加载顺序

{{variable:resources}}
<!-- /context:indexer-section -->

<!-- context:indexer-section ssr -->
## SSR 与 Hydration

{{variable:ssr}}
<!-- /context:indexer-section -->

<!-- context:indexer-section platforms -->
## 平台和主题差异

{{variable:platforms}}
<!-- /context:indexer-section -->

<!-- context:indexer-section verification -->
## 验证与排查入口

{{variable:verification}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 来源与修改入口

{{variable:references}}
<!-- /context:indexer-section -->
