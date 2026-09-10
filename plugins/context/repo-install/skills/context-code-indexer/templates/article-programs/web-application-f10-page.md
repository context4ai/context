---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "web-application-f10-page",
  "profile": "web-application",
  "reader_goal": "integrate-host-and-remote",
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
      "id": "roles",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "registration",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "loading",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "sharing",
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
      "section_key": "roles",
      "presence": "optional",
      "question_ref": "question:f10-roles",
      "reader_goal": "integrate-host-and-remote",
      "variable_ids": [
        "roles"
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
      "section_key": "registration",
      "presence": "optional",
      "question_ref": "question:f10-registration",
      "reader_goal": "integrate-host-and-remote",
      "variable_ids": [
        "registration"
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
      "section_key": "loading",
      "presence": "optional",
      "question_ref": "question:f10-loading",
      "reader_goal": "integrate-host-and-remote",
      "variable_ids": [
        "loading"
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
      "section_key": "sharing",
      "presence": "optional",
      "question_ref": "question:f10-sharing",
      "reader_goal": "integrate-host-and-remote",
      "variable_ids": [
        "sharing"
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
      "question_ref": "question:f10-failures",
      "reader_goal": "integrate-host-and-remote",
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
      "section_key": "references",
      "presence": "optional",
      "question_ref": "question:f10-references",
      "reader_goal": "integrate-host-and-remote",
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
<!-- context:indexer-section roles -->
## 宿主与 Remote

{{variable:roles}}
<!-- /context:indexer-section -->

<!-- context:indexer-section registration -->
## 注册与 Expose

{{variable:registration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section loading -->
## 加载和生命周期

{{variable:loading}}
<!-- /context:indexer-section -->

<!-- context:indexer-section sharing -->
## 共享依赖与上下文

{{variable:sharing}}
<!-- /context:indexer-section -->

<!-- context:indexer-section failures -->
## 错误与兼容边界

{{variable:failures}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 源码导航

{{variable:references}}
<!-- /context:indexer-section -->
