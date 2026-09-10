---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "api-service-d02-page",
  "profile": "api-service",
  "reader_goal": "look-up-public-contract",
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
      "id": "trigger",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "actors",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "flow",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "branches",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "failures",
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
      "section_key": "trigger",
      "presence": "optional",
      "question_ref": "question:d02-trigger",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "trigger"
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
      "section_key": "actors",
      "presence": "optional",
      "question_ref": "question:d02-actors",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "actors"
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
      "section_key": "flow",
      "presence": "optional",
      "question_ref": "question:d02-flow",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "flow"
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
      "section_key": "branches",
      "presence": "optional",
      "question_ref": "question:d02-branches",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "branches"
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
      "section_key": "failures",
      "presence": "optional",
      "question_ref": "question:d02-failures",
      "reader_goal": "look-up-public-contract",
      "variable_ids": [
        "failures"
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
      "question_ref": "question:d02-sources",
      "reader_goal": "look-up-public-contract",
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
<!-- context:indexer-section trigger -->
## 场景与触发

{{variable:trigger}}
<!-- /context:indexer-section -->

<!-- context:indexer-section actors -->
## 参与方

{{variable:actors}}
<!-- /context:indexer-section -->

<!-- context:indexer-section flow -->
## 主流程

{{variable:flow}}
<!-- /context:indexer-section -->

<!-- context:indexer-section branches -->
## 分支与状态

{{variable:branches}}
<!-- /context:indexer-section -->

<!-- context:indexer-section failures -->
## 失败和下一步

{{variable:failures}}
<!-- /context:indexer-section -->

<!-- context:indexer-section sources -->
## 源码链路与证据边界

{{variable:sources}}
<!-- /context:indexer-section -->
