const rawInput = process.env.AGENT_GRAPH_INPUT;
const revision = process.env.AGENT_GRAPH_REVISION;

if (typeof rawInput !== "string" || rawInput.length === 0) {
  throw new Error("Context view input is missing");
}

const input = JSON.parse(rawInput);
if (
  input === null ||
  typeof input !== "object" ||
  input.schema !== "context.workflow.resource-input.v1" ||
  typeof input.content !== "string"
) {
  throw new Error("Context view input is invalid");
}
if (input.revision !== revision) {
  throw new Error("Context view revision does not match the selected route");
}

process.stdout.write(input.content.endsWith("\n") ? input.content : `${input.content}\n`);
