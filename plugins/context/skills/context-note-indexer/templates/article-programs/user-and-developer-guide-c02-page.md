---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "user-and-developer-guide-c02-page",
  "profile": "user-and-developer-guide",
  "reader_goal": "understand-product-intent",
  "applicability": {
    "artifact_policy_variants": [
      "standard"
    ],
    "condition_refs": []
  },
  "variables": [
    {
      "id": "goals",
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
      "id": "prerequisites",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "operations",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "exceptions",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "acceptance",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "version",
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
      "id": "flows",
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
      "section_key": "goals",
      "presence": "optional",
      "question_ref": "question:c02-goals",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "goals"
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
      "question_ref": "question:c02-actors",
      "reader_goal": "understand-product-intent",
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
      "section_key": "prerequisites",
      "presence": "optional",
      "question_ref": "question:c02-prerequisites",
      "reader_goal": "understand-product-intent",
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
      "section_key": "operations",
      "presence": "optional",
      "question_ref": "question:c02-operations",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "operations"
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
      "section_key": "exceptions",
      "presence": "optional",
      "question_ref": "question:c02-exceptions",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "exceptions"
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
      "section_key": "acceptance",
      "presence": "optional",
      "question_ref": "question:c02-acceptance",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "acceptance"
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
      "section_key": "version",
      "presence": "optional",
      "question_ref": "question:c02-version",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "version"
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
      "question_ref": "question:c02-capabilities",
      "reader_goal": "understand-product-intent",
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
      "section_key": "flows",
      "presence": "optional",
      "question_ref": "question:c02-flows",
      "reader_goal": "understand-product-intent",
      "variable_ids": [
        "flows"
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
      "question_ref": "question:c02-references",
      "reader_goal": "understand-product-intent",
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
<!-- context:indexer-section goals -->
## 业务目标

{{variable:goals}}
<!-- /context:indexer-section -->

<!-- context:indexer-section actors -->
## 角色与场景

{{variable:actors}}
<!-- /context:indexer-section -->

<!-- context:indexer-section prerequisites -->
## 使用前提

{{variable:prerequisites}}
<!-- /context:indexer-section -->

<!-- context:indexer-section operations -->
## 操作与结果

{{variable:operations}}
<!-- /context:indexer-section -->

<!-- context:indexer-section exceptions -->
## 规则与异常

{{variable:exceptions}}
<!-- /context:indexer-section -->

<!-- context:indexer-section acceptance -->
## 验收依据

{{variable:acceptance}}
<!-- /context:indexer-section -->

<!-- context:indexer-section version -->
## 版本和范围

{{variable:version}}
<!-- /context:indexer-section -->

<!-- context:indexer-section capabilities -->
## 能力边界

{{variable:capabilities}}
<!-- /context:indexer-section -->

<!-- context:indexer-section flows -->
## 主要流程入口

{{variable:flows}}
<!-- /context:indexer-section -->

<!-- context:indexer-section references -->
## 相关系统与文档

{{variable:references}}
<!-- /context:indexer-section -->
