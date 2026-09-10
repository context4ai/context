---
{
  "protocol": "context.indexer.template/v1",
  "template_id": "component-library-c05-page",
  "profile": "component-library",
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
      "id": "symptoms",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "conditions",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "findings",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "diagnosis",
      "type": "string",
      "content_layer": "semantic-prose",
      "required": false,
      "evidence_required": true
    },
    {
      "id": "recovery",
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
      "section_key": "symptoms",
      "presence": "optional",
      "question_ref": "question:c05-symptoms",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "symptoms"
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
      "section_key": "conditions",
      "presence": "optional",
      "question_ref": "question:c05-conditions",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "conditions"
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
      "section_key": "findings",
      "presence": "optional",
      "question_ref": "question:c05-findings",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "findings"
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
      "section_key": "diagnosis",
      "presence": "optional",
      "question_ref": "question:c05-diagnosis",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "diagnosis"
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
      "section_key": "recovery",
      "presence": "optional",
      "question_ref": "question:c05-recovery",
      "reader_goal": "modify-or-diagnose-module",
      "variable_ids": [
        "recovery"
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
      "question_ref": "question:c05-sources",
      "reader_goal": "modify-or-diagnose-module",
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
<!-- context:indexer-section symptoms -->
## 现象索引

{{variable:symptoms}}
<!-- /context:indexer-section -->

<!-- context:indexer-section conditions -->
## 适用条件

{{variable:conditions}}
<!-- /context:indexer-section -->

<!-- context:indexer-section findings -->
## 已知事实与判断

{{variable:findings}}
<!-- /context:indexer-section -->

<!-- context:indexer-section diagnosis -->
## 排查步骤

{{variable:diagnosis}}
<!-- /context:indexer-section -->

<!-- context:indexer-section recovery -->
## 修复与验证

{{variable:recovery}}
<!-- /context:indexer-section -->

<!-- context:indexer-section sources -->
## 来源

{{variable:sources}}
<!-- /context:indexer-section -->
