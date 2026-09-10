---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "standard-policy-f08-page",
  "profile": "standard-policy",
  "reader_goal": "follow-standard-or-policy",
  "applicability": {
    "artifact_policy_variants": [
      "standard"
    ],
    "condition_refs": []
  },
  "variables": [
    {
      "id": "systems",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "layers",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "tokens",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "overrides",
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
      "id": "accessibility",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "examples",
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
      "section_key": "systems",
      "presence": "optional",
      "question_ref": "question:f08-systems",
      "reader_goal": "follow-standard-or-policy",
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
      "section_key": "layers",
      "presence": "optional",
      "question_ref": "question:f08-layers",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "layers"
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
      "section_key": "tokens",
      "presence": "optional",
      "question_ref": "question:f08-tokens",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "tokens"
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
      "section_key": "overrides",
      "presence": "optional",
      "question_ref": "question:f08-overrides",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "overrides"
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
      "question_ref": "question:f08-platforms",
      "reader_goal": "follow-standard-or-policy",
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
      "section_key": "accessibility",
      "presence": "optional",
      "question_ref": "question:f08-accessibility",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "accessibility"
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
      "section_key": "examples",
      "presence": "optional",
      "question_ref": "question:f08-examples",
      "reader_goal": "follow-standard-or-policy",
      "variable_ids": [
        "examples"
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
      "question_ref": "question:f08-references",
      "reader_goal": "follow-standard-or-policy",
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
<!-- context:indexer-section systems -->
## 使用的组件库与设计系统

{{variable:systems}}
<!-- /context:indexer-section -->

<!-- context:indexer-section layers -->
## 样式分层

{{variable:layers}}
<!-- /context:indexer-section -->

<!-- context:indexer-section tokens -->
## Token 定义与消费

{{variable:tokens}}
<!-- /context:indexer-section -->

<!-- context:indexer-section overrides -->
## 局部覆盖

{{variable:overrides}}
<!-- /context:indexer-section -->

<!-- context:indexer-section platforms -->
## 主题与平台差异

{{variable:platforms}}
<!-- /context:indexer-section -->

<!-- context:indexer-section accessibility -->
## 响应式与可访问性

{{variable:accessibility}}
<!-- /context:indexer-section -->

<!-- context:indexer-section examples -->
## 调整入口与示例

{{variable:examples}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 系统规范与源码

{{variable:references}}
<!-- /context:indexer-section -->
