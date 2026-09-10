---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "test-validation-q02-page",
  "profile": "test-validation",
  "reader_goal": "verify-behavior-or-acceptance",
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
      "id": "layers",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "coverage",
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
      "id": "risks",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "scenarios",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "environment",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "execution",
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
    }
  ],
  "deterministic_blocks": [],
  "sections": [
    {
      "section_key": "scope",
      "presence": "optional",
      "question_ref": "question:q02-scope",
      "reader_goal": "verify-behavior-or-acceptance",
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
      "section_key": "layers",
      "presence": "optional",
      "question_ref": "question:q02-layers",
      "reader_goal": "verify-behavior-or-acceptance",
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
      "section_key": "coverage",
      "presence": "optional",
      "question_ref": "question:q02-coverage",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "coverage"
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
      "question_ref": "question:q02-collaboration",
      "reader_goal": "verify-behavior-or-acceptance",
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
      "section_key": "risks",
      "presence": "optional",
      "question_ref": "question:q02-risks",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "risks"
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
      "section_key": "scenarios",
      "presence": "optional",
      "question_ref": "question:q02-scenarios",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "scenarios"
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
      "section_key": "environment",
      "presence": "optional",
      "question_ref": "question:q02-environment",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "environment"
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
      "section_key": "execution",
      "presence": "optional",
      "question_ref": "question:q02-execution",
      "reader_goal": "verify-behavior-or-acceptance",
      "variable_ids": [
        "execution"
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
      "question_ref": "question:q02-acceptance",
      "reader_goal": "verify-behavior-or-acceptance",
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
## 测试范围与目标

{{variable:scope}}
<!-- /context:indexer-section -->

<!-- context:indexer-section layers -->
## 测试分层

{{variable:layers}}
<!-- /context:indexer-section -->

<!-- context:indexer-section coverage -->
## 覆盖维度

{{variable:coverage}}
<!-- /context:indexer-section -->

<!-- context:indexer-section collaboration -->
## 协作方式

{{variable:collaboration}}
<!-- /context:indexer-section -->

<!-- context:indexer-section risks -->
## 变更与风险

{{variable:risks}}
<!-- /context:indexer-section -->

<!-- context:indexer-section scenarios -->
## 验证场景

{{variable:scenarios}}
<!-- /context:indexer-section -->

<!-- context:indexer-section environment -->
## 环境与数据

{{variable:environment}}
<!-- /context:indexer-section -->

<!-- context:indexer-section execution -->
## 执行方式

{{variable:execution}}
<!-- /context:indexer-section -->

<!-- context:indexer-section acceptance -->
## 验收与退出条件

{{variable:acceptance}}
<!-- /context:indexer-section -->
