---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "cli-tool-c04-page",
  "profile": "cli-tool",
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
      "id": "layers",
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
      "id": "initialization",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "compatibility",
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
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "layers",
      "presence": "optional",
      "question_ref": "question:c04-layers",
      "reader_goal": "integrate-capability",
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
      "section_key": "catalog",
      "presence": "optional",
      "question_ref": "question:c04-catalog",
      "reader_goal": "integrate-capability",
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
      "section_key": "initialization",
      "presence": "optional",
      "question_ref": "question:c04-initialization",
      "reader_goal": "integrate-capability",
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
      "section_key": "compatibility",
      "presence": "optional",
      "question_ref": "question:c04-compatibility",
      "reader_goal": "integrate-capability",
      "variable_ids": [
        "compatibility"
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
      "question_ref": "question:c04-boundaries",
      "reader_goal": "integrate-capability",
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
<!-- context:indexer-section layers -->
## 依赖分层

{{variable:layers}}
<!-- /context:indexer-section -->

<!-- context:indexer-section catalog -->
## 核心依赖表

{{variable:catalog}}
<!-- /context:indexer-section -->

<!-- context:indexer-section initialization -->
## 初始化与注入

{{variable:initialization}}
<!-- /context:indexer-section -->

<!-- context:indexer-section compatibility -->
## 兼容和版本约束

{{variable:compatibility}}
<!-- /context:indexer-section -->

<!-- context:indexer-section boundaries -->
## 跨边界定位

{{variable:boundaries}}
<!-- /context:indexer-section -->
