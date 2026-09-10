import { test } from "bun:test";
import { runArticleScenario } from "./articleScenarioWorkflow.fixture.js";

const foundations = [
  { key: "colors", title: "Color semantics", definition: "--action-color aliases --palette-blue; the night theme changes the palette alias target.",
    use: "Use --action-color for actions. An alias definition does not prove the current browser value." },
  { key: "typography", title: "Typography", definition: "--body-size is 16px and --body-line-height is 1.5 in the Web specification.",
    use: "Use both values for body text; no native typography mapping or rendered layout validation is supplied." },
  { key: "spacing-layout", title: "Spacing and layout", definition: "--space-small is 4px; the documented compact layout breakpoint is 640px.",
    use: "Use the spacing token in layout gaps; check the consuming media query before assigning breakpoint behavior to a component." },
  { key: "elevation", title: "Layering", definition: "The overlay layer is 20 and the dialog layer is 30 in the documented layer map.",
    use: "Check the consumer's stacking context before assuming a higher token always appears above an overlay." },
  { key: "motion", title: "Motion", definition: "--motion-short is 120ms; reduced-motion mode disables the optional entrance animation.",
    use: "Keep the reduced-motion branch when replacing the token. This policy is not a recorded accessibility audit." },
  { key: "icons-assets", title: "Icon resources", definition: "@example/icons exports ArrowStart; its documented renderer mirrors it for RTL. The source SVG is owned by the asset package.",
    use: "Import the named asset through its renderer. Check package docs before adding a custom icon; do not generate a Props article per SVG." },
];

test("design foundations and migration keep topic-specific guidance and source limits in delivered articles", () => runArticleScenario({
  id: "design-foundations-and-migration", profile: "standard-policy", sourceType: "file",
  source: `# Web foundations specification
${foundations.map(item => `## ${item.title}\n${item.definition}\n${item.use}`).join("\n")}
## Migration
Version 2 replaces --primary with --action-color. Update consumers after loading the new aliases; preserve the existing night theme and reduced-motion branch. No rollout result is recorded.
`, articles: [
    ...foundations.map(item => ({ type: "l03", key: item.key, title: item.title, task: `Locate ${item.title.toLowerCase()} definitions and safe consumption`, slots: {
      purpose: `manual.md defines the Web ${item.title.toLowerCase()} topic.`,
      catalog: item.definition,
      rules: item.use,
      references: "Start with manual.md; implementation and current runtime values require reading the actual consuming source.",
    } })),
    { type: "l03", key: "migration", title: "Version 2 token adoption", task: "Find the documented replacement and preservation checks", slots: {
      adoption: "manual.md replaces --primary with --action-color in version 2; load the new aliases before updating consumers.",
      verification: "Preserve the night theme and reduced-motion branch. No rollout result is recorded; verify actual consumers before reporting migration complete.",
    } },
  ],
}), 180000);
