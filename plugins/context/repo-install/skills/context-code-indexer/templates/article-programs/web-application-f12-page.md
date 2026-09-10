---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "web-application-f12-page",
  "profile": "web-application",
  "reader_goal": "develop-page-task",
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
      "id": "purpose",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "callers",
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
      "id": "dependencies",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "change",
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
      "section_key": "purpose",
      "presence": "optional",
      "question_ref": "question:f12-purpose",
      "reader_goal": "develop-page-task",
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
      "section_key": "callers",
      "presence": "optional",
      "question_ref": "question:f12-callers",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "callers"
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
      "question_ref": "question:f12-behavior",
      "reader_goal": "develop-page-task",
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
      "section_key": "dependencies",
      "presence": "optional",
      "question_ref": "question:f12-dependencies",
      "reader_goal": "develop-page-task",
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
      "section_key": "change",
      "presence": "optional",
      "question_ref": "question:f12-change",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "change"
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
      "question_ref": "question:f12-verification",
      "reader_goal": "develop-page-task",
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
<!-- context:indexer-section purpose -->
## 职责与父层

{{variable:purpose}}
<!-- /context:indexer-section -->

<!-- context:indexer-section callers -->
## 调用方与输入

{{variable:callers}}
<!-- /context:indexer-section -->

<!-- context:indexer-section behavior -->
## 行为与状态

{{variable:behavior}}
<!-- /context:indexer-section -->

<!-- context:indexer-section dependencies -->
## 组件及请求依赖

{{variable:dependencies}}
<!-- /context:indexer-section -->

<!-- context:indexer-section change -->
## 修改入口

{{variable:change}}
<!-- /context:indexer-section -->

<!-- context:indexer-section verification -->
## 测试与验证

{{variable:verification}}
<!-- /context:indexer-section -->
