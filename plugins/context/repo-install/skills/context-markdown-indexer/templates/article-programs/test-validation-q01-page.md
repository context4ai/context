---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "test-validation-q01-page",
  "profile": "test-validation",
  "reader_goal": "verify-behavior-or-acceptance",
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
      "id": "systems",
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
      "id": "development",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "tools",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "strategy",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "responsibility",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "risks",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "acceptance",
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
      "question_ref": "question:q01-scope",
      "reader_goal": "verify-behavior-or-acceptance",
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
      "section_key": "systems",
      "presence": "optional",
      "question_ref": "question:q01-systems",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "systems"
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
      "question_ref": "question:q01-navigation",
      "reader_goal": "verify-behavior-or-acceptance",
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
      "section_key": "development",
      "presence": "optional",
      "question_ref": "question:q01-development",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "development"
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
      "section_key": "tools",
      "presence": "optional",
      "question_ref": "question:q01-tools",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "tools"
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
      "section_key": "strategy",
      "presence": "optional",
      "question_ref": "question:q01-strategy",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "strategy"
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
      "section_key": "responsibility",
      "presence": "optional",
      "question_ref": "question:q01-responsibility",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "responsibility"
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
      "section_key": "risks",
      "presence": "optional",
      "question_ref": "question:q01-risks",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "risks"
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
      "section_key": "acceptance",
      "presence": "optional",
      "question_ref": "question:q01-acceptance",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "acceptance"
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
      "question_ref": "question:q01-references",
      "reader_goal": "verify-behavior-or-acceptance",
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
## 业务与质量范围

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section systems -->
## 系统与能力

{{variable:systems}}
<!-- /context:indexer-section -->

<!-- context:indexer-section navigation -->
## 测试资料导航

{{variable:navigation}}
<!-- /context:indexer-section -->

<!-- context:indexer-section development -->
## 开发知识关联

{{variable:development}}
<!-- /context:indexer-section -->

<!-- context:indexer-section tools -->
## 工具入口

{{variable:tools}}
<!-- /context:indexer-section -->

<!-- context:indexer-section strategy -->
## 测试策略

{{variable:strategy}}
<!-- /context:indexer-section -->

<!-- context:indexer-section responsibility -->
## 职责与分层

{{variable:responsibility}}
<!-- /context:indexer-section -->

<!-- context:indexer-section risks -->
## 风险与重点

{{variable:risks}}
<!-- /context:indexer-section -->

<!-- context:indexer-section acceptance -->
## 验收依据

{{variable:acceptance}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 计划与执行入口

{{variable:references}}
<!-- /context:indexer-section -->
