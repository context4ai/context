import { describe, expect, test } from "bun:test";
import {
  indexerProtocolDigest,
  type IndexerParserFact,
  type IndexerParserFactFile,
  type IndexerParserFactView,
} from "@c4a/context";
import {
  planCapturedDocumentInventoryShards,
  planIndexerConsumerInventoryShards,
} from
  "../project/indexerConsumerWorksetPlanner.js";
import { bundledIndexerProfileContract } from "../project/indexerBaseContracts.js";

const SOURCE_REF = "repo:20260904/consumer-fixture";
const MODULE_REF = "module:library";
const PROFILE = bundledIndexerProfileContract().profiles.find((profile) =>
  profile.id === "component-library"
)!;

function fact(input: {
  path: string;
  name: string;
  visibility?: "exported" | "internal";
  symbolKind?: string;
  kind?: string;
  denominator?: IndexerParserFact["denominator"];
  payload?: Record<string, unknown>;
  qualifiedItemPath?: string;
}): IndexerParserFact {
  const kind = input.kind ?? "code-symbol";
  const payload = {
    name: input.name,
    kind: input.symbolKind ?? "function",
    ...(input.visibility === undefined && kind !== "code-symbol"
      ? {}
      : { visibility: input.visibility ?? "internal" }),
    ...input.payload,
  };
  return {
    fact_ref: `fact:${indexerProtocolDigest({
      path: input.path,
      name: input.name,
      kind,
    })}`,
    kind,
    locator: {
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: input.path,
      qualified_item_path: input.qualifiedItemPath ?? `symbol:${payload.kind}:${input.name}@1`,
      signature_digest: indexerProtocolDigest(payload),
    },
    payload,
    payload_digest: indexerProtocolDigest(payload),
    denominator: input.denominator ?? "symbol",
  };
}

function file(path: string, facts: IndexerParserFact[]): IndexerParserFactFile {
  return {
    file_ref: `file:${indexerProtocolDigest(path)}`,
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    normalized_path: path,
    disposition: "analyzed",
    facts,
  };
}

function view(files: IndexerParserFactFile[]): IndexerParserFactView {
  return {
    protocol: "context.indexer.parser-fact-view/v1",
    authorized_scope: {
      source_ref: SOURCE_REF,
      module_refs: [MODULE_REF],
      scope_digest: indexerProtocolDigest({ source_ref: SOURCE_REF }),
    },
    inventory_digest: indexerProtocolDigest({ files: files.length }),
    origin_result_digests: [indexerProtocolDigest({ origin: true })],
    files,
    fact_set_digest: indexerProtocolDigest({ facts: true }),
    view_digest: indexerProtocolDigest({ view: true }),
  };
}

describe("0.7.5 consumer workset planning", () => {
  test("keeps captured documents independently recoverable before semantic convergence", () => {
    const planned = planCapturedDocumentInventoryShards([
      {
        member: { member_id: "document:zeta", member_kind: "document" },
        path: "guides/zeta.md",
      },
      {
        member: { member_id: "document:alpha", member_kind: "document" },
        path: "guides/alpha.md",
      },
    ]);

    expect(planned).toHaveLength(2);
    expect(planned.map((shard) => shard.projection.family_key)).toEqual([
      "document-input:guides/alpha.md",
      "document-input:guides/zeta.md",
    ]);
    expect(planned.every((shard) =>
      shard.inventory.length === 1 && shard.projection.unresolved
    )).toBe(true);
  });

  test("lets public families rather than directories, tests, or generated exports drive tasks", () => {
    const button = fact({
      path: "src/components/button/Button.tsx",
      name: "Button",
      visibility: "exported",
      symbolKind: "component",
    });
    const buttonHelper = fact({
      path: "src/components/button/Button.tsx",
      name: "normalizeButton",
    });
    const card = fact({
      path: "src/components/card/Card.tsx",
      name: "Card",
      visibility: "exported",
      symbolKind: "component",
    });
    const buttonExample = fact({
      path: "src/components/button/examples/Basic.tsx",
      name: "BasicButtonExample",
      visibility: "exported",
    });
    const generatedExports = Array.from({ length: 12 }, (_, index) => fact({
      path: `src/components/card/_generated/Icon${index}.tsx`,
      name: `Icon${index}`,
      visibility: "exported",
      symbolKind: "component",
    }));
    const parserView = view([
      {
        ...file("package.json", []),
        disposition: "unsupported",
      },
      file("src/components/button/Button.tsx", [button, buttonHelper]),
      file("src/components/button/__tests__/Button.test.tsx", [fact({
        path: "src/components/button/__tests__/Button.test.tsx",
        name: "buttonFixture",
        visibility: "exported",
      })]),
      file("src/components/button/styles/button.css", [fact({
        path: "src/components/button/styles/button.css",
        name: "buttonStyle",
      })]),
      file("src/components/button/examples/Basic.tsx", [buttonExample]),
      file("src/components/card/Card.tsx", [card]),
      file("src/components/card/_generated/icons.ts", generatedExports),
      ...Array.from({ length: 10 }, (_, index) => file(
        `src/internal/area-${index}/helper.ts`,
        [fact({
          path: `src/internal/area-${index}/helper.ts`,
          name: `helper${index}`,
        })],
      )),
    ]);

    const planned = planIndexerConsumerInventoryShards({
      factView: parserView,
      profile: PROFILE,
      strategyId: "public-target-family",
    });

    expect(planned).toHaveLength(2);
    expect(planned.map((shard) => shard.projection.family_key)).toEqual([
      "components/button",
      "components/card",
    ]);
    expect(planned.flatMap((shard) => shard.inventory.map((item) => item.member_id)))
      .toEqual([button.fact_ref, card.fact_ref]);
    const manifestRef = parserView.files[0]!.file_ref;
    expect(planned.every((shard) => shard.projection.file_refs.includes(manifestRef)))
      .toBe(true);
    const buttonShard = planned[0]!;
    expect(buttonShard.projection.fact_items).toContainEqual({
      fact_ref: button.fact_ref,
      role: "consumer-anchor",
    });
    expect(buttonShard.projection.fact_items).toContainEqual({
      fact_ref: buttonHelper.fact_ref,
      role: "supporting-fact",
    });
    expect(buttonShard.projection.fact_items).toContainEqual({
      fact_ref: buttonExample.fact_ref,
      role: "supporting-fact",
    });
    const cardShard = planned[1]!;
    expect(cardShard.projection.file_refs).toContain(
      parserView.files.find((item) => item.normalized_path.includes("_generated"))!.file_ref,
    );
    expect(cardShard.projection.fact_items.some((item) =>
      generatedExports.some((generated) => generated.fact_ref === item.fact_ref)
    )).toBe(false);
  });

  test("does not create a reader task for an internal-only source", () => {
    const parserView = view(Array.from({ length: 8 }, (_, index) => file(
      `src/internal/area-${index}/helper.ts`,
      [fact({
        path: `src/internal/area-${index}/helper.ts`,
        name: `helper${index}`,
      })],
    )));

    const planned = planIndexerConsumerInventoryShards({
      factView: parserView,
      profile: PROFILE,
      strategyId: "canonical-semantic-subject",
    });

    expect(planned).toEqual([]);
  });

  test("keeps public material unresolved when no stable consumer anchor is known", () => {
    const publicObservation = fact({
      path: "src/runtime/observations.ts",
      name: "runtimeContract",
      visibility: "exported",
      kind: "behavior-observation",
      denominator: "none",
    });
    const parserView = view([
      file("src/runtime/observations.ts", [publicObservation]),
    ]);

    const planned = planIndexerConsumerInventoryShards({
      factView: parserView,
      profile: PROFILE,
      strategyId: "canonical-semantic-subject",
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]?.projection.unresolved).toBe(true);
    expect(planned[0]?.projection.fact_items).toEqual([{
      fact_ref: publicObservation.fact_ref,
      role: "supporting-fact",
    }]);
  });

  test("routes unmatched uncertain material into one bounded unresolved task", () => {
    const button = fact({
      path: "src/components/button/Button.tsx",
      name: "Button",
      visibility: "exported",
      symbolKind: "component",
    });
    const orphanBehavior = fact({
      path: "src/observations/navigation.fixture.ts",
      name: "navigationBehavior",
      visibility: "exported",
      kind: "behavior-observation",
      denominator: "none",
    });
    const unsupported: IndexerParserFactFile = {
      ...file("src/contracts/unparsed.schema", []),
      disposition: "unsupported",
    };
    const parserView = view([
      file("src/components/button/Button.tsx", [button]),
      file("src/observations/navigation.fixture.ts", [orphanBehavior]),
      unsupported,
    ]);

    const planned = planIndexerConsumerInventoryShards({
      factView: parserView,
      profile: PROFILE,
      strategyId: "public-target-family",
    });

    expect(planned).toHaveLength(2);
    const unresolved = planned.find((shard) => shard.projection.unresolved);
    const anchored = planned.find((shard) => !shard.projection.unresolved);
    expect(unresolved?.question_carrier_score).toBe(0);
    expect(anchored!.question_carrier_score).toBeGreaterThan(
      unresolved!.question_carrier_score,
    );
    expect(unresolved?.inventory).toEqual([
      { member_id: parserView.files[1]!.file_ref, member_kind: "entry" as const },
      { member_id: unsupported.file_ref, member_kind: "entry" as const },
    ].sort((left, right) => left.member_id.localeCompare(right.member_id)));
    expect(unresolved?.projection.fact_items).toEqual([{
      fact_ref: orphanBehavior.fact_ref,
      role: "supporting-fact",
    }]);
    expect(unresolved?.projection.file_refs).toEqual([
      parserView.files[1]!.file_ref,
      unsupported.file_ref,
    ].sort());
  });

  test("rejects a Provider profile that does not declare the inventory denominator", () => {
    const parserView = view([]);
    expect(() => planIndexerConsumerInventoryShards({
      factView: parserView,
      profile: {
        ...PROFILE,
        inventory_domains: [{
          id: "provider-private-domain",
          selector: { operator: "eligible-standard" },
          disposition_required: true,
        }],
      },
      strategyId: "public-target-family",
    })).toThrow(/without an all-inventory domain/u);
  });

  test("leaves a Provider-defined strategy as one explicit unresolved input", () => {
    const button = fact({
      path: "src/components/button/Button.tsx",
      name: "Button",
      visibility: "exported",
      symbolKind: "component",
    });
    const card = fact({
      path: "src/components/card/Card.tsx",
      name: "Card",
      visibility: "exported",
      symbolKind: "component",
    });

    const planned = planIndexerConsumerInventoryShards({
      factView: view([
        file("src/components/button/Button.tsx", [button]),
        file("src/components/card/Card.tsx", [card]),
      ]),
      profile: PROFILE,
      strategyId: "project-private-capability-boundary",
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]?.projection.unresolved).toBe(true);
    expect(planned[0]?.projection.family_key).toMatch(/^provider-defined:sha256:/u);
    expect(planned[0]?.inventory.map((member) => member.member_id).sort()).toEqual([
      button.fact_ref,
      card.fact_ref,
    ].sort());
  });

  test("groups protocol operations by their declared service instead of one task per method", () => {
    const first = fact({
      path: "api/catalog.thrift",
      name: "GetItem",
      kind: "contract-operation",
      denominator: "protocol-item",
      payload: { parent: "CatalogService" },
      qualifiedItemPath: "service:CatalogService/method:GetItem",
    });
    const second = fact({
      path: "api/catalog.thrift",
      name: "ListItems",
      kind: "contract-operation",
      denominator: "protocol-item",
      payload: { parent: "CatalogService", deprecated: true },
      qualifiedItemPath: "service:CatalogService/method:ListItems",
    });

    const planned = planIndexerConsumerInventoryShards({
      factView: view([file("api/catalog.thrift", [first, second])]),
      profile: PROFILE,
      strategyId: "canonical-semantic-subject",
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]?.projection.family_key).toBe("contract:CatalogService");
    expect(planned[0]?.inventory.map((member) => member.member_kind)).toEqual([
      "protocol-method",
      "protocol-method",
    ]);
  });

  test("groups IDL services and methods under one protocol boundary", () => {
    const service = fact({
      path: "idl/catalog.thrift",
      name: "CatalogService",
      kind: "protocol-service",
      denominator: "protocol-item",
      payload: { name: "CatalogService" },
      qualifiedItemPath: "service:CatalogService",
    });
    const method = fact({
      path: "idl/catalog.thrift",
      name: "GetItem",
      kind: "protocol-method",
      denominator: "protocol-item",
      payload: { service: "CatalogService" },
      qualifiedItemPath: "service:CatalogService:method:GetItem",
    });

    const planned = planIndexerConsumerInventoryShards({
      factView: view([file("idl/catalog.thrift", [service, method])]),
      profile: PROFILE,
      strategyId: "canonical-semantic-subject",
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]?.projection.family_key).toBe("protocol:CatalogService");
    expect(planned[0]?.inventory.map((member) => member.member_kind).sort()).toEqual([
      "protocol-method",
      "service",
    ]);
  });

  test("groups API endpoints and operations under one contract boundary", () => {
    const endpoint = fact({
      path: "api/openapi.yaml",
      name: "/items",
      kind: "contract-endpoint",
      denominator: "protocol-item",
      payload: { path_or_type: "/items" },
      qualifiedItemPath: "endpoint:/items",
    });
    const operation = fact({
      path: "api/openapi.yaml",
      name: "listItems",
      kind: "contract-operation",
      denominator: "protocol-item",
      payload: { parent: "/items" },
      qualifiedItemPath: "operation:get:/items",
    });

    const planned = planIndexerConsumerInventoryShards({
      factView: view([file("api/openapi.yaml", [endpoint, operation])]),
      profile: PROFILE,
      strategyId: "canonical-semantic-subject",
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]?.projection.family_key).toBe("contract:/items");
    expect(planned[0]?.inventory.map((member) => member.member_kind).sort()).toEqual([
      "protocol-method",
      "route",
    ]);
  });

  test("keeps public style tokens as anchors and private selectors as supporting facts", () => {
    const token = fact({
      path: "styles/theme.css",
      name: "--color-accent",
      kind: "style-token",
      denominator: "none",
      payload: { name: "--color-accent", configurable: true },
      qualifiedItemPath: "token:--color-accent",
    });
    const selector = fact({
      path: "styles/theme.css",
      name: ".internal-wrapper",
      kind: "style-selector",
      denominator: "none",
      qualifiedItemPath: "selector:.internal-wrapper",
    });

    const planned = planIndexerConsumerInventoryShards({
      factView: view([file("styles/theme.css", [token, selector])]),
      profile: PROFILE,
      strategyId: "canonical-semantic-subject",
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]?.inventory).toEqual([{
      member_id: token.fact_ref,
      member_kind: "entry",
    }]);
    expect(planned[0]?.projection.fact_items).toContainEqual({
      fact_ref: selector.fact_ref,
      role: "supporting-fact",
    });
  });

  test("attaches style evidence to its public component instead of creating a style task", () => {
    const button = fact({
      path: "src/components/button/Button.tsx",
      name: "Button",
      visibility: "exported",
      symbolKind: "component",
    });
    const buttonState = fact({
      path: "src/components/button/styles/button.css",
      name: "button-disabled",
      kind: "style-variant-state",
      denominator: "none",
    });

    const planned = planIndexerConsumerInventoryShards({
      factView: view([
        file("src/components/button/Button.tsx", [button]),
        file("src/components/button/styles/button.css", [buttonState]),
      ]),
      profile: PROFILE,
      strategyId: "public-target-family",
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]?.inventory).toEqual([{
      member_id: button.fact_ref,
      member_kind: "component",
    }]);
    expect(planned[0]?.projection.fact_items).toContainEqual({
      fact_ref: buttonState.fact_ref,
      role: "supporting-fact",
    });
  });

  test("does not create a reader task for generated-only exports", () => {
    const generated = fact({
      path: "src/generated/client.ts",
      name: "GeneratedClient",
      visibility: "exported",
    });
    const planned = planIndexerConsumerInventoryShards({
      factView: view([file("src/generated/client.ts", [generated])]),
      profile: PROFILE,
      strategyId: "canonical-semantic-subject",
    });

    expect(planned).toEqual([]);
  });

  test("uses structured SQL and monorepo facts as stable consumer anchors", () => {
    const table = fact({
      path: "migrations/catalog.sql",
      name: "catalog_items",
      kind: "sql-object",
      denominator: "none",
      payload: { object_kind: "table" },
      qualifiedItemPath: "object:catalog_items",
    });
    const project = fact({
      path: "rush.json",
      name: "@sample/catalog",
      kind: "rush-project",
      denominator: "none",
      payload: { project_name: "@sample/catalog" },
      qualifiedItemPath: "project:@sample/catalog",
    });

    const planned = planIndexerConsumerInventoryShards({
      factView: view([
        file("migrations/catalog.sql", [table]),
        file("rush.json", [project]),
      ]),
      profile: PROFILE,
      strategyId: "canonical-semantic-subject",
    });

    expect(planned.map((shard) => shard.inventory[0]?.member_kind).sort()).toEqual([
      "project",
      "store",
    ]);
    expect(planned.every((shard) => shard.projection.unresolved === false)).toBe(true);
  });
});
