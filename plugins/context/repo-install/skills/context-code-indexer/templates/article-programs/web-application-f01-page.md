---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "web-application-f01-page",
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
      "id": "architecture",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "stack",
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
      "id": "crosscutting",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "deployment",
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
      "section_key": "architecture",
      "presence": "optional",
      "question_ref": "question:f01-architecture",
      "reader_goal": "develop-page-task",
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
      "section_key": "stack",
      "presence": "optional",
      "question_ref": "question:f01-stack",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "stack"
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
      "question_ref": "question:f01-startup",
      "reader_goal": "develop-page-task",
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
      "section_key": "crosscutting",
      "presence": "optional",
      "question_ref": "question:f01-crosscutting",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "crosscutting"
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
      "section_key": "deployment",
      "presence": "optional",
      "question_ref": "question:f01-deployment",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "deployment"
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
      "question_ref": "question:f01-references",
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
<!-- context:indexer-section architecture -->
## 架构总览

{{variable:architecture}}
<!-- /context:indexer-section -->

<!-- context:indexer-section stack -->
## 技术栈与运行方式

{{variable:stack}}
<!-- /context:indexer-section -->

<!-- context:indexer-section startup -->
## 启动与分层

{{variable:startup}}
<!-- /context:indexer-section -->

<!-- context:indexer-section crosscutting -->
## 关键横切能力

{{variable:crosscutting}}
<!-- /context:indexer-section -->

<!-- context:indexer-section deployment -->
## 部署边界

{{variable:deployment}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 相关入口

{{variable:references}}
<!-- /context:indexer-section -->
