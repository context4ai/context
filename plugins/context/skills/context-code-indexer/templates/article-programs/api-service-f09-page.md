---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "api-service-f09-page",
  "profile": "api-service",
  "reader_goal": "modify-or-diagnose-module",
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
      "id": "scope",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "prerequisites",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "commands",
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
      "id": "verification",
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
      "question_ref": "question:f09-scope",
      "reader_goal": "modify-or-diagnose-module",
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
      "section_key": "prerequisites",
      "presence": "optional",
      "question_ref": "question:f09-prerequisites",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "prerequisites"
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
      "section_key": "commands",
      "presence": "optional",
      "question_ref": "question:f09-commands",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "commands"
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
      "question_ref": "question:f09-deployment",
      "reader_goal": "modify-or-diagnose-module",
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
      "section_key": "verification",
      "presence": "optional",
      "question_ref": "question:f09-verification",
      "reader_goal": "modify-or-diagnose-module",
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
    },
    {
      "section_key": "references",
      "presence": "optional",
      "question_ref": "question:f09-references",
      "reader_goal": "modify-or-diagnose-module",
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
## 工程与交付边界

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section prerequisites -->
## 运行前提

{{variable:prerequisites}}
<!-- /context:indexer-section -->

<!-- context:indexer-section commands -->
## 构建与测试入口

{{variable:commands}}
<!-- /context:indexer-section -->

<!-- context:indexer-section deployment -->
## 部署与配置

{{variable:deployment}}
<!-- /context:indexer-section -->

<!-- context:indexer-section verification -->
## 验证与回滚

{{variable:verification}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 相关资料

{{variable:references}}
<!-- /context:indexer-section -->
