---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "web-application-f05-page",
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
      "id": "clients",
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
      "id": "errors",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "boundaries",
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
      "section_key": "clients",
      "presence": "optional",
      "question_ref": "question:f05-clients",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "clients"
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
      "question_ref": "question:f05-catalog",
      "reader_goal": "develop-page-task",
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
      "question_ref": "question:f05-mapping",
      "reader_goal": "develop-page-task",
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
      "section_key": "errors",
      "presence": "optional",
      "question_ref": "question:f05-errors",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "errors"
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
      "section_key": "boundaries",
      "presence": "optional",
      "question_ref": "question:f05-boundaries",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "boundaries"
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
      "question_ref": "question:f05-references",
      "reader_goal": "develop-page-task",
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
<!-- context:indexer-section clients -->
## 请求层与客户端

{{variable:clients}}
<!-- /context:indexer-section -->

<!-- context:indexer-section catalog -->
## 接口与调用入口

{{variable:catalog}}
<!-- /context:indexer-section -->

<!-- context:indexer-section mapping -->
## 输入输出与转换

{{variable:mapping}}
<!-- /context:indexer-section -->

<!-- context:indexer-section errors -->
## 错误与重试

{{variable:errors}}
<!-- /context:indexer-section -->

<!-- context:indexer-section boundaries -->
## 契约与外部边界

{{variable:boundaries}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 源码入口

{{variable:references}}
<!-- /context:indexer-section -->
