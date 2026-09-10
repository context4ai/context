---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "web-application-f02-page",
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
      "id": "organization",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "routes",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "access",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "layout",
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
      "section_key": "organization",
      "presence": "optional",
      "question_ref": "question:f02-organization",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "organization"
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
      "section_key": "routes",
      "presence": "optional",
      "question_ref": "question:f02-routes",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "routes"
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
      "section_key": "access",
      "presence": "optional",
      "question_ref": "question:f02-access",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "access"
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
      "section_key": "layout",
      "presence": "optional",
      "question_ref": "question:f02-layout",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "layout"
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
      "question_ref": "question:f02-references",
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
<!-- context:indexer-section organization -->
## 路由组织

{{variable:organization}}
<!-- /context:indexer-section -->

<!-- context:indexer-section routes -->
## 页面登记表

{{variable:routes}}
<!-- /context:indexer-section -->

<!-- context:indexer-section access -->
## 参数与访问控制

{{variable:access}}
<!-- /context:indexer-section -->

<!-- context:indexer-section layout -->
## 布局和全局兜底

{{variable:layout}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 页面详情导航

{{variable:references}}
<!-- /context:indexer-section -->
