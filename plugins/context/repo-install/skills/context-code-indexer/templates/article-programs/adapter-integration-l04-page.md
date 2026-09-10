---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "adapter-integration-l04-page",
  "profile": "adapter-integration",
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
      "id": "boundary",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "registration",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "context",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "collaboration",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "cleanup",
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
      "section_key": "boundary",
      "presence": "optional",
      "question_ref": "question:l04-boundary",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "boundary"
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
      "section_key": "registration",
      "presence": "optional",
      "question_ref": "question:l04-registration",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "registration"
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
      "section_key": "context",
      "presence": "optional",
      "question_ref": "question:l04-context",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "context"
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
      "section_key": "collaboration",
      "presence": "optional",
      "question_ref": "question:l04-collaboration",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "collaboration"
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
      "section_key": "cleanup",
      "presence": "optional",
      "question_ref": "question:l04-cleanup",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "cleanup"
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
      "question_ref": "question:l04-references",
      "reader_goal": "integrate-capability",
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
<!-- context:indexer-section boundary -->
## 扩展边界

{{variable:boundary}}
<!-- /context:indexer-section -->

<!-- context:indexer-section registration -->
## 注册及执行顺序

{{variable:registration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section context -->
## 输入输出与上下文

{{variable:context}}
<!-- /context:indexer-section -->

<!-- context:indexer-section collaboration -->
## 宿主与下游协作

{{variable:collaboration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section cleanup -->
## 错误和清理

{{variable:cleanup}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 使用与测试入口

{{variable:references}}
<!-- /context:indexer-section -->
