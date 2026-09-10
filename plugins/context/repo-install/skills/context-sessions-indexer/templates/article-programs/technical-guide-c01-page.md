---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "technical-guide-c01-page",
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
      "id": "capabilities",
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
      "id": "index",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "tasks",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "sources",
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
      "question_ref": "question:c01-scope",
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
      "section_key": "capabilities",
      "presence": "optional",
      "question_ref": "question:c01-capabilities",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "capabilities"
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
      "question_ref": "question:c01-dependencies",
      "reader_goal": "understand-technical-design",
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
      "section_key": "index",
      "presence": "optional",
      "question_ref": "question:c01-index",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "index"
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
      "section_key": "tasks",
      "presence": "optional",
      "question_ref": "question:c01-tasks",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "tasks"
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
      "section_key": "sources",
      "presence": "optional",
      "question_ref": "question:c01-sources",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "sources"
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
## 定位与边界

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section capabilities -->
## 核心能力

{{variable:capabilities}}
<!-- /context:indexer-section -->

<!-- context:indexer-section dependencies -->
## 技术与依赖摘要

{{variable:dependencies}}
<!-- /context:indexer-section -->

<!-- context:indexer-section index -->
## 知识索引

{{variable:index}}
<!-- /context:indexer-section -->

<!-- context:indexer-section tasks -->
## 任务导航

{{variable:tasks}}
<!-- /context:indexer-section -->

<!-- context:indexer-section sources -->
## 来源与适用版本

{{variable:sources}}
<!-- /context:indexer-section -->
