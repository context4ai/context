import { expect, test } from "bun:test";
import type { IndexerArtifactFact } from "@c4a/context";
import { renderPublicContractFacts } from "../project/indexerPublicContractDefaults.js";
import { componentBindingDefaults } from "@c4a/extract-ts";

const subject = { protocol: "context.subject-key/v1" as const, namespace: "sample", kind: "component", local_key: "view" };
const props: IndexerArtifactFact = { fact_ref: "fact:props", fact_kind: "code-symbol", subject_key: subject, evidence_refs: ["source:view"],
  value: { name: "Props", kind: "type", visibility: "exported", file: "view.tsx", members: [
    {name:"showToday",kind:"prop",visibility:"exported",typeAnnotation:"boolean",optional:true,defaultValue:"false"},
    {name:"locale",kind:"prop",visibility:"exported",typeAnnotation:"string",optional:true},
    {name:"activeDates",kind:"prop",visibility:"exported",typeAnnotation:"string[]",optional:true},
  ] } };
const component = (name: string, pattern: string): IndexerArtifactFact => ({ fact_ref:`fact:${name}`,fact_kind:"code-symbol",subject_key:subject,evidence_refs:["source:view"],
  value:{name,kind:"component",visibility:"exported",file:"view.tsx",typeAnnotation:"FC<Props>",params:[{name:pattern}], members: (props.value as {members: Array<Record<string, unknown>>}).members.map(member => ({...member, ...(Object.hasOwn(componentBindingDefaults(pattern), String(member.name)) ? {defaultValue:componentBindingDefaults(pattern)[String(member.name)]} : {})}))} });

test("retained component and type facts regenerate runtime defaults without mutating receipts", () => {
  const facts=[component("View","{ showToday = true, locale = 'en-US', activeDates = [] }"),props];
  const before=JSON.stringify(facts);
  const rendered=renderPublicContractFacts(facts);
  expect(rendered).toContain("| Props | showToday | boolean | optional | true |");
  expect(rendered).toContain("| locale | string | optional | 'en-US' |");
  expect(rendered).toContain("| activeDates | string[] | optional | [] |");
  expect(rendered).toContain("declaration documents false");
  expect(rendered.match(/\| Props \| showToday/g)?.length).toBe(1);
  expect(JSON.stringify(facts)).toBe(before);
});

test("shared types retain separate callable defaults and do not guess cross-file matches", () => {
  const first=component("First","{ showToday = true }");
  const second=component("Second","{ showToday = false }");
  const rendered=renderPublicContractFacts([first,props,second]);
  expect(rendered).toContain("| Props (First) | showToday | boolean | optional | true |");
  expect(rendered).toContain("| Props (Second) | showToday | boolean | optional | false |");
  const other={...props,value:{...(props.value as object),file:"other.tsx"}} as IndexerArtifactFact;
  expect(renderPublicContractFacts([first,other])).not.toContain("Props (First)");
  expect(renderPublicContractFacts([props])).toContain("| false |");
});

test("binding parsing preserves aliases, arrays and expressions without running code", () => {
  expect(componentBindingDefaults("{ value: local = 0, items = [], locale = resolveLocale(), ...rest }"))
    .toEqual({value:"0",items:"[]",locale:"resolveLocale()"});
  expect(componentBindingDefaults("{ broken = }")).toEqual({});
  expect(componentBindingDefaults("{ nested: { value = 2 } } ")).toEqual({});
});
