---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "web-application-f04-page",
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
      "id": "ownership",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "initialization",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "writes",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "async",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "lifecycle",
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
      "section_key": "ownership",
      "presence": "optional",
      "question_ref": "question:f04-ownership",
      "reader_goal": "develop-page-task",
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
      "section_key": "initialization",
      "presence": "optional",
      "question_ref": "question:f04-initialization",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "initialization"
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
      "section_key": "writes",
      "presence": "optional",
      "question_ref": "question:f04-writes",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "writes"
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
      "section_key": "async",
      "presence": "optional",
      "question_ref": "question:f04-async",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "async"
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
      "section_key": "lifecycle",
      "presence": "optional",
      "question_ref": "question:f04-lifecycle",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "lifecycle"
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
      "question_ref": "question:f04-references",
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
<!-- context:indexer-section ownership -->
## 状态归属

{{variable:ownership}}
<!-- /context:indexer-section -->

<!-- context:indexer-section initialization -->
## 初始化与读取

{{variable:initialization}}
<!-- /context:indexer-section -->

<!-- context:indexer-section writes -->
## 写入与派生

{{variable:writes}}
<!-- /context:indexer-section -->

<!-- context:indexer-section async -->
## 异步与缓存

{{variable:async}}
<!-- /context:indexer-section -->

<!-- context:indexer-section lifecycle -->
## 清理与生命周期

{{variable:lifecycle}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 定位与排障

{{variable:references}}
<!-- /context:indexer-section -->
