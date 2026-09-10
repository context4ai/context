---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "api-service-d04-page",
  "profile": "api-service",
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
      "id": "scope",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "commands",
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
      "id": "conventions",
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
      "id": "configuration",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "observability",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "diagnosis",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "recovery",
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
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "scope",
      "presence": "optional",
      "question_ref": "question:d04-scope",
      "reader_goal": "modify-or-diagnose-module",
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
      "section_key": "commands",
      "presence": "optional",
      "question_ref": "question:d04-commands",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "commands"
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
      "question_ref": "question:d04-delivery",
      "reader_goal": "modify-or-diagnose-module",
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
      "section_key": "conventions",
      "presence": "optional",
      "question_ref": "question:d04-conventions",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "conventions"
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
      "question_ref": "question:d04-environment",
      "reader_goal": "modify-or-diagnose-module",
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
      "section_key": "configuration",
      "presence": "optional",
      "question_ref": "question:d04-configuration",
      "reader_goal": "modify-or-diagnose-module",
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
      "section_key": "observability",
      "presence": "optional",
      "question_ref": "question:d04-observability",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "observability"
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
      "section_key": "diagnosis",
      "presence": "optional",
      "question_ref": "question:d04-diagnosis",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "diagnosis"
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
      "section_key": "recovery",
      "presence": "optional",
      "question_ref": "question:d04-recovery",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "recovery"
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
      "question_ref": "question:d04-verification",
      "reader_goal": "modify-or-diagnose-module",
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
## 工程边界

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section commands -->
## 构建与测试入口

{{variable:commands}}
<!-- /context:indexer-section -->

<!-- context:indexer-section delivery -->
## 环境与交付

{{variable:delivery}}
<!-- /context:indexer-section -->

<!-- context:indexer-section conventions -->
## 兼容与研发约定

{{variable:conventions}}
<!-- /context:indexer-section -->

<!-- context:indexer-section environment -->
## 运行与环境

{{variable:environment}}
<!-- /context:indexer-section -->

<!-- context:indexer-section configuration -->
## 配置定位

{{variable:configuration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section observability -->
## 日志指标与追踪

{{variable:observability}}
<!-- /context:indexer-section -->

<!-- context:indexer-section diagnosis -->
## 诊断路径

{{variable:diagnosis}}
<!-- /context:indexer-section -->

<!-- context:indexer-section recovery -->
## 恢复与回滚

{{variable:recovery}}
<!-- /context:indexer-section -->

<!-- context:indexer-section verification -->
## 验证依据

{{variable:verification}}
<!-- /context:indexer-section -->
