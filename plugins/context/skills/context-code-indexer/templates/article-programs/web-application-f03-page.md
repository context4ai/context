---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "web-application-f03-page",
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
      "id": "identity",
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
      "id": "components",
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
      "id": "state",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "api",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "rules",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "feedback",
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
    },
    {
      "id": "contract_api",
      "type": "json",
      "content_layer": "deterministic-fact",
      "required": false,
      "evidence_required": true
    }
  ],
  "deterministic_blocks": [
    {
      "id": "api-table",
      "renderer": "public-contract-table",
      "source_variable_id": "contract_api"
    }
  ],
  "sections": [
    {
      "section_key": "identity",
      "presence": "optional",
      "question_ref": "question:f03-identity",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "identity"
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
      "question_ref": "question:f03-access",
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
      "section_key": "components",
      "presence": "optional",
      "question_ref": "question:f03-components",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "components"
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
      "section_key": "contract_api",
      "presence": "optional",
      "question_ref": "question:public-contract",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "contract_api"
      ],
      "deterministic_block_ids": [
        "api-table"
      ],
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
      "question_ref": "question:f03-flow",
      "reader_goal": "develop-page-task",
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
      "section_key": "state",
      "presence": "optional",
      "question_ref": "question:f03-state",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "state"
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
      "section_key": "api",
      "presence": "optional",
      "question_ref": "question:f03-api",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "api"
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
      "section_key": "rules",
      "presence": "optional",
      "question_ref": "question:f03-rules",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "rules"
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
      "section_key": "feedback",
      "presence": "optional",
      "question_ref": "question:f03-feedback",
      "reader_goal": "develop-page-task",
      "variable_ids": [
        "feedback"
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
      "question_ref": "question:f03-references",
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
<!-- context:indexer-section identity -->
## 页面定位

{{variable:identity}}
<!-- /context:indexer-section -->

<!-- context:indexer-section access -->
## 路由参数与权限

{{variable:access}}
<!-- /context:indexer-section -->

<!-- context:indexer-section components -->
## 主要组件与依赖

{{variable:components}}
<!-- /context:indexer-section -->

<!-- context:indexer-section contract_api -->
## API

{{block:api-table}}
<!-- /context:indexer-section -->

<!-- context:indexer-section flow -->
## 页面内流程

{{variable:flow}}
<!-- /context:indexer-section -->

<!-- context:indexer-section state -->
## 状态与数据流

{{variable:state}}
<!-- /context:indexer-section -->

<!-- context:indexer-section api -->
## API 边界

{{variable:api}}
<!-- /context:indexer-section -->

<!-- context:indexer-section rules -->
## 业务条件

{{variable:rules}}
<!-- /context:indexer-section -->

<!-- context:indexer-section feedback -->
## Loading Empty Error

{{variable:feedback}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 知识与源码

{{variable:references}}
<!-- /context:indexer-section -->
