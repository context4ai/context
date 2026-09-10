---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "technical-guide-d01-page",
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
      "id": "services",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "entries",
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
      "question_ref": "question:d01-scope",
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
      "section_key": "services",
      "presence": "optional",
      "question_ref": "question:d01-services",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "services"
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
      "section_key": "entries",
      "presence": "optional",
      "question_ref": "question:d01-entries",
      "reader_goal": "understand-technical-design",
      "variable_ids": [
        "entries"
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
      "question_ref": "question:d01-collaboration",
      "reader_goal": "understand-technical-design",
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
      "section_key": "references",
      "presence": "optional",
      "question_ref": "question:d01-references",
      "reader_goal": "understand-technical-design",
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
## 领域职责

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section services -->
## 服务分工

{{variable:services}}
<!-- /context:indexer-section -->

<!-- context:indexer-section entries -->
## 入口与调用边界

{{variable:entries}}
<!-- /context:indexer-section -->

<!-- context:indexer-section collaboration -->
## 数据与事件协作

{{variable:collaboration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 阅读导航

{{variable:references}}
<!-- /context:indexer-section -->
