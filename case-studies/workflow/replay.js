const replay = await fetch("./data/context-run.json").then((response) => {
  if (!response.ok) throw new Error(`Unable to load replay data: ${response.status}`);
  return response.json();
});

const steps = replay.steps;
const byId = (id) => document.getElementById(id);
const svg = byId("graph");
const namespace = "http://www.w3.org/2000/svg";
const make = (name, attributes = {}) => {
  const element = document.createElementNS(namespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
};

const copy = {
  zh: {
    title: "Context 工作图回放",
    case: "案例说明",
    journey: "决策旅程",
    play: "▶ 播放",
    pause: "Ⅱ 暂停",
    previous: "上一步",
    next: "下一步",
    speed: "播放速度",
    scrubber: "回放步骤",
    theme: "切换主题",
    inspector: "这一步发生了什么",
    explainer: "路线说明",
    brandLabel: "Agent Graph 实践案例",
    state: "当前状态",
    why: "为什么走到这里",
    action: "下一步行动",
    evidence: "完成证据",
    time: "相对时间",
    command: "CLI 调用",
    workflow: "Action 与按需资源",
    protocol: "协议字段",
    graphMap: "工作图",
    graphDialogLabel: "静态工作契约",
    graphDialogTitle: "Context 工作区图",
    graphDialogCopy: "这张图对应本次脱敏回放所使用的工作契约；当前契约以 Context 仓库中的 workspace.yaml 为准。节点保持静态；运行时 Facts 决定当前 Route，Action 改变外部状态，Resources 只在被选中时交付给 Agent。",
    workflowSource: "浏览完整工作流目录",
    graphSource: "查看 workspace.yaml 源文件",
    github: "在 GitHub 查看 Context",
    actionFile: "Action",
    resourceFiles: "Resources",
    terminalNode: "Terminal（无需 Action）",
    gateContract: "Gate（由宿主提供授权或决策）",
    close: "关闭",
    steps: "步",
    actionable: "可执行",
    waiting: "等待授权或决策",
    complete: "目标完成",
    single: "一次推进",
    loop: "循环",
    checkpoint: "检查点",
    fields: ["来源范围与采集", "统一 Indexer 与审核", "知识包构建", "当前结果"],
    provenance: "本回放由脱敏 Context 记录按当前工作区契约归一化：退役阶段折叠为唯一 Indexer 路由，不包含来源正文、私有路径和不透明标识。"
  },
  en: {
    title: "Context Work Graph Replay",
    case: "Case study",
    journey: "Decision journey",
    play: "▶ Play",
    pause: "Ⅱ Pause",
    previous: "Previous step",
    next: "Next step",
    speed: "Playback speed",
    scrubber: "Replay step",
    theme: "Toggle theme",
    inspector: "What happened at this step",
    explainer: "ROUTE EXPLAINER",
    brandLabel: "Agent Graph case studies",
    state: "Current state",
    why: "Why this route",
    action: "Next action",
    evidence: "Completion evidence",
    time: "Relative time",
    command: "CLI invocation",
    workflow: "Action and on-demand resources",
    protocol: "Protocol fields",
    graphMap: "Workspace graph",
    graphDialogLabel: "STATIC WORK CONTRACT",
    graphDialogTitle: "Context workspace graph",
    graphDialogCopy: "This map represents the workflow contract used by the sanitized replay; the current contract is the workspace.yaml published by Context. Nodes stay static; runtime Facts select the current Route, Actions change external state, and Resources reach the Agent only when selected.",
    workflowSource: "Browse the workflow directory",
    graphSource: "Open workspace.yaml source",
    github: "View Context on GitHub",
    actionFile: "Action",
    resourceFiles: "Resources",
    terminalNode: "Terminal (no Action)",
    gateContract: "Gate (authority or decision supplied by the host)",
    close: "Close",
    steps: "steps",
    actionable: "Actionable",
    waiting: "Waiting for authority or a decision",
    complete: "Goal complete",
    single: "Single pass",
    loop: "Loop",
    checkpoint: "Checkpoint",
    fields: ["SOURCE SCOPE & CAPTURE", "SOLE INDEXER & REVIEW", "PACKAGE BUILD", "CURRENT OUTCOME"],
    provenance: "This replay is normalized from a sanitized Context recording to the current workspace contract. Retired phases collapse into the sole Indexer route; source text, private paths, and opaque identifiers are excluded."
  }
};

const nodes = {
  "choose-source-boundary": {
    phase: "SCOPE",
    zh: ["定义知识边界", "用户已提出目标，但本轮允许读取的来源尚未确定。", "登记本轮允许使用的代码与文档来源。", "来源清单及授权边界已成为工作区事实。"],
    en: ["Define knowledge scope", "The goal exists, but the sources permitted for this run are not yet fixed.", "Register the code and document sources allowed in this run.", "The source list and authority boundary become workspace facts."]
  },
  "configure-document-capture": {
    phase: "CAPTURE",
    zh: ["配置文档采集", "已登记文档来源，但项目尚未声明如何采集它们。", "为已登记文档声明确定性的采集阶段。", "每个文档来源都有可执行的采集目标。"],
    en: ["Configure document capture", "Document sources are registered, but the project has not declared how to capture them.", "Declare deterministic capture phases for the registered documents.", "Every document source has an executable capture target."]
  },
  "authorize-document-capture": {
    phase: "AUTHORITY",
    zh: ["授权读取来源", "采集动作需要读取外部来源，当前会话尚未持有对应权限。", "取得本次会话的来源读取授权。", "会话 Authority 允许采集动作继续。"],
    en: ["Authorize source reads", "Capture needs to read external sources, but the session does not yet hold that authority.", "Obtain source-read authority for this session.", "Session authority permits the capture actions to continue."]
  },
  "capture-next": {
    phase: "CAPTURE",
    zh: ["采集来源快照", "仍有文档来源缺少可审计快照。", "采集下一份来源并记录证据摘要。", "该来源的快照与资源清单已落盘。"],
    en: ["Capture source snapshot", "At least one document source still lacks an auditable snapshot.", "Capture the next source and record its evidence digest.", "The source snapshot and resource inventory are persisted."]
  },
  "run-indexer-lifecycle": {
    phase: "INDEXER",
    zh: ["生成统一候选", "当前登记表尚未生成与已授权来源一致的完整候选批次。", "按 Indexer Graph 继续 Provider 选择、分区、生成、合并、布局与候选编译。", "代码、Markdown 与扩展材料共同收敛为一批当前 Candidate。"],
    en: ["Produce the candidate batch", "The current registry has not produced a complete candidate batch for the authorized sources.", "Follow the Indexer Graph through Provider selection, partitioning, authoring, reconciliation, layout, and candidate compilation.", "Code, Markdown, and extension materials converge into one current Candidate batch."]
  },
  "apply-managed-review": {
    phase: "GATE",
    zh: ["审核最终候选", "完整 Indexer 批次已经生成，但还没有进入批准知识。", "依据本次托管授权原子应用整批审核决定。", "唯一 Candidate 批次一次性写入批准知识。"],
    en: ["Review final candidates", "The complete Indexer batch exists but has not entered approved knowledge.", "Atomically apply the batch decision under the current managed authority.", "The sole Candidate batch enters approved knowledge in one transaction."]
  },
  "close-approved-knowledge": {
    phase: "CHECKPOINT",
    zh: ["固化知识投影", "批准页面已变化，结构投影仍对应旧事实。", "从已批准页面确定性重建知识投影。", "页面、节点和关系投影彼此一致。"],
    en: ["Close knowledge projection", "Approved pages changed while the structure projection still reflects older facts.", "Deterministically rebuild the projection from approved pages.", "Pages, nodes, and relation projections agree."]
  },
  "configure-package-output": {
    phase: "PACKAGE",
    zh: ["配置知识包输出", "知识已经关闭，但还没有声明面向消费端的产物。", "声明包名、模板和分发出口。", "构建器拥有明确的输出契约。"],
    en: ["Configure package output", "Knowledge is closed, but no consumer-facing output is declared.", "Declare the package identity, template, and distribution output.", "The builder has an explicit output contract."]
  },
  "review-package-template": {
    phase: "GATE",
    zh: ["确认消费入口", "生成的查询入口与模板需要在发布前确认。", "确认将进入知识包的消费入口。", "模板选择成为可审计的用户决定。"],
    en: ["Confirm consumer entry", "Generated query entrypoints and templates require confirmation before publication.", "Confirm the consumer entrypoints included in the package.", "Template selection becomes an auditable user decision."]
  },
  "build-next": {
    phase: "PACKAGE",
    zh: ["构建可消费知识包", "批准知识或输出配置比当前产物更新。", "构建知识包并执行确定性验证。", "产物清单与知识摘要一致。"],
    en: ["Build consumable package", "Approved knowledge or output configuration is newer than the current artifact.", "Build the package and run deterministic verification.", "The artifact inventory matches the knowledge digest."]
  },
  "flush-logs-after-build": {
    phase: "DELIVERY",
    zh: ["投递最终运行事件", "知识包已经完成，但仍有本次构建的运行事件等待投递。", "投递待处理事件；失败时保留本地 outbox 供后续重试。", "最终事件已投递，或已安全留在可恢复 outbox。"],
    en: ["Deliver final runtime events", "The package is complete, but runtime events from this build still await delivery.", "Flush pending events, retaining the local outbox for a later retry if delivery fails.", "Final events are delivered or remain safely recoverable from the outbox."]
  },
  "current-scope-complete": {
    phase: "OUTCOME",
    zh: ["当前范围完成", "所有已声明目标均已满足，没有待处理门禁或陈旧产物。", "停止执行；后续只在来源或目标变化时重新进入工作流。", "当前知识、结构和构建产物彼此一致。"],
    en: ["Current scope complete", "Every declared target is satisfied with no pending gate or stale artifact.", "Stop; re-enter the workflow only when sources or goals change.", "Current knowledge, structure, and build artifacts agree."]
  }
};

const commands = {
  "choose-source-boundary": "context --workflow-managed source add batch --input <source-batch> --format json",
  "configure-document-capture": "context status --managed --format json",
  "authorize-document-capture": "context run --managed --authority context.source-read --until blocked-or-complete --format json",
  "capture-next": "context --workflow-managed --workflow-authority context.source-read run capture:document-source --format json",
  "run-indexer-lifecycle": "context run --managed --until blocked-or-complete --format json",
  "apply-managed-review": "context review approve-all --all --managed --format json",
  "close-approved-knowledge": "context close --format json",
  "configure-package-output": "context status --managed --format json",
  "review-package-template": "context package template accept --all --format json",
  "build-next": "context build --format json",
  "flush-logs-after-build": "context logs flush --format json",
  "current-scope-complete": "context status --managed --format json"
};

const workflowRoot = "https://github.com/context4ai/context/tree/main/packages/context-cli/context-workflow";
const workflowBlob = "https://github.com/context4ai/context/blob/main/packages/context-cli/context-workflow";
const workflowArtifacts = {
  "choose-source-boundary": {
    action: "actions/register-source-batch.yaml",
    resources: ["resources/procedures/source-boundary.md", "resources/dialogue/human-gates.md", "resources/dialogue/source-boundary.md", "resources/views/source-current.yaml"]
  },
  "configure-document-capture": {
    action: "actions/configure-document-capture.yaml",
    resources: ["resources/procedures/project-configuration.md", "resources/manuals/reference/project-api.md", "resources/procedures/document-capture.md", "resources/views/source-current.yaml"]
  },
  "authorize-document-capture": {
    resources: ["resources/procedures/document-capture.md", "resources/dialogue/human-gates.md", "resources/dialogue/document-capture.md", "resources/views/source-current.yaml"]
  },
  "capture-next": {
    action: "actions/capture-next.yaml",
    resources: ["resources/procedures/document-capture.md", "resources/views/source-boundary.yaml", "resources/procedures/source-capture-detailed.md", "resources/manuals/guides/lark-resources.md"]
  },
  "run-indexer-lifecycle": {
    action: "actions/run-indexer-lifecycle.yaml",
    resources: []
  },
  "apply-managed-review": {
    action: "actions/apply-managed-review.yaml",
    resources: ["resources/procedures/knowledge-review.md", "resources/views/review-current.yaml"]
  },
  "close-approved-knowledge": {
    action: "actions/close-approved-knowledge.yaml",
    resources: ["resources/procedures/close-and-build.md", "resources/views/verification-current.yaml", "resources/diagnostics/projection-stale.md"]
  },
  "configure-package-output": {
    action: "actions/configure-package-output.yaml",
    resources: ["resources/procedures/project-configuration.md", "resources/procedures/package-output.md", "resources/views/package-current.yaml", "resources/manuals/guides/package-outputs.md", "resources/manuals/reference/project-api.md", "resources/manuals/reference/package-templates.md", "resources/manuals/reference/template-variables.md"]
  },
  "review-package-template": {
    action: "actions/accept-package-templates.yaml",
    resources: ["resources/procedures/package-output.md", "resources/dialogue/human-gates.md", "resources/views/package-current.yaml", "resources/manuals/reference/package-templates.md"]
  },
  "build-next": {
    action: "actions/build-next.yaml",
    resources: ["resources/procedures/close-and-build.md", "resources/views/package-current.yaml"]
  },
  "flush-logs-after-build": {
    action: "actions/flush-runtime-events.yaml",
    resources: ["resources/procedures/runtime-event-delivery.md"]
  },
  "current-scope-complete": { resources: [] }
};

const workspaceGroups = [
  {
    en: "Recovery and evidence", zh: "恢复与证据", nodes: [
      ["Repair project entry", "修复项目入口", "action"],
      ["Repair workspace facts", "修复工作区事实", "action"],
      ["Repair verification", "修复验证结果", "action"],
      ["Choose evidence maintenance", "选择证据维护方式", "gate"],
      ["Maintain evidence", "维护来源证据", "action"]
    ]
  },
  {
    en: "Document maintenance", zh: "文档维护", nodes: [
      ["Revise requested document", "修订已请求文档", "action"]
    ]
  },
  {
    en: "Sources and capture", zh: "来源与采集", nodes: [
      ["Choose source boundary", "选择来源边界", "gate"],
      ["Restore repositories", "恢复代码仓库", "gate"],
      ["Configure capture", "配置文档采集", "action"],
      ["Authorize source reads", "授权读取来源", "gate"],
      ["Capture next source", "采集下一来源", "action"]
    ]
  },
  {
    en: "Indexer and review", zh: "Indexer 与审核", nodes: [
      ["Run Indexer lifecycle", "执行 Indexer 生命周期", "action"],
      ["Review current batch", "审核当前批次", "gate"],
      ["Apply managed review", "应用托管审核", "action"],
      ["Close approved knowledge", "固化批准知识", "action"]
    ]
  },
  {
    en: "Package outcome", zh: "知识包结果", nodes: [
      ["Choose package output", "选择知识包输出", "gate"],
      ["Configure package", "配置知识包", "action"],
      ["Review templates", "审核消费模板", "gate"],
      ["Build package", "构建知识包", "action"],
      ["Flush runtime events", "投递运行事件", "action"],
      ["Scope complete", "当前目标完成", "terminal"]
    ]
  }
];

const positions = [
  [58, 72], [270, 52], [490, 92], [714, 54], [886, 160],
  [650, 226], [414, 226], [92, 370], [310, 402], [530, 370],
  [750, 402], [886, 510]
];

const instances = [];
for (const step of steps) {
  const previous = instances.at(-1);
  if (previous?.node === step.node) previous.steps.push(step);
  else instances.push({ node: step.node, steps: [step] });
}

const positionOf = (index) => ({ x: positions[index][0], y: positions[index][1] });
const port = (node, side) => {
  if (side === "top") return { x: node.x + 91, y: node.y, nx: 0, ny: -1 };
  if (side === "right") return { x: node.x + 182, y: node.y + 35, nx: 1, ny: 0 };
  if (side === "bottom") return { x: node.x + 91, y: node.y + 70, nx: 0, ny: 1 };
  return { x: node.x, y: node.y + 35, nx: -1, ny: 0 };
};
const boundary = (node, toward) => {
  const center = { x: node.x + 91, y: node.y + 35 };
  const other = { x: toward.x + 91, y: toward.y + 35 };
  const dx = other.x - center.x;
  const dy = other.y - center.y;
  if (Math.abs(dx) / 91 >= Math.abs(dy) / 35) {
    const sign = dx >= 0 ? 1 : -1;
    const scale = 91 / Math.max(Math.abs(dx), .001);
    return { x: center.x + sign * 91, y: center.y + dy * scale, nx: sign, ny: 0 };
  }
  const sign = dy >= 0 ? 1 : -1;
  const scale = 35 / Math.max(Math.abs(dy), .001);
  return { x: center.x + dx * scale, y: center.y + sign * 35, nx: 0, ny: sign };
};

const defs = make("defs");
for (const [id, className] of [["arrow", "arrow-default"], ["arrow-visited", "arrow-visited"], ["arrow-active", "arrow-active"]]) {
  const marker = make("marker", { id, viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 4.5, markerHeight: 4.5, orient: "auto" });
  marker.append(make("path", { d: "M 0 0 L 10 5 L 0 10 z", class: className }));
  defs.append(marker);
}
svg.append(defs);
const fieldLayer = make("g");
const edgeLayer = make("g");
const nodeLayer = make("g");
svg.append(fieldLayer, edgeLayer, nodeLayer);

const fields = [
  { x: 38, y: 30, w: 852, h: 116 },
  { x: 270, y: 170, w: 800, h: 140 },
  { x: 44, y: 318, w: 1022, h: 148 },
  { x: 64, y: 474, w: 922, h: 130 }
];
const fieldLabels = [];
fields.forEach((field, index) => {
  fieldLayer.append(make("rect", { ...field, rx: 28, class: "field" }));
  const label = make("text", { x: field.x + 18, y: field.y + 22, class: "field-label" });
  fieldLayer.append(label);
  fieldLabels.push({ label, index });
});

const overrides = new Map([
  ["capture-next>run-indexer-lifecycle", ["right", "top"]],
  ["run-indexer-lifecycle>apply-managed-review", ["left", "right"]],
  ["apply-managed-review>close-approved-knowledge", ["left", "right"]],
  ["close-approved-knowledge>configure-package-output", ["bottom", "top"]],
  ["configure-package-output>review-package-template", ["right", "left"]],
  ["review-package-template>build-next", ["right", "left"]],
  ["build-next>flush-logs-after-build", ["right", "left"]],
  ["flush-logs-after-build>current-scope-complete", ["bottom", "left"]]
]);
const edges = [];
for (let index = 0; index < instances.length - 1; index += 1) {
  const from = positionOf(index);
  const to = positionOf(index + 1);
  const pair = `${instances[index].node}>${instances[index + 1].node}`;
  const override = overrides.get(pair);
  const start = override ? port(from, override[0]) : boundary(from, to);
  const end = override ? port(to, override[1]) : boundary(to, from);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const curve = Math.max(34, Math.min(82, distance * .24));
  const path = make("path", {
    d: `M ${start.x} ${start.y} C ${start.x + start.nx * curve} ${start.y + start.ny * curve}, ${end.x + end.nx * curve} ${end.y + end.ny * curve}, ${end.x} ${end.y}`,
    class: "edge"
  });
  edgeLayer.append(path);
  edges.push(path);
}

const nodeElements = [];
const loops = new Map();
instances.forEach((instance, index) => {
  const position = positionOf(index);
  const group = make("g", { class: "node future", transform: `translate(${position.x} ${position.y})` });
  group.append(make("rect", { width: 182, height: 70, rx: 13 }));
  group.append(make("circle", { cx: 16, cy: 17, r: 3, class: "dot" }));
  const phase = make("text", { x: 27, y: 20, class: "phase" });
  const name = make("text", { x: 14, y: 43, class: "name" });
  const count = make("text", { x: 168, y: 58, class: "count", "text-anchor": "end" });
  group.append(phase, name, count);
  nodeLayer.append(group);
  nodeElements.push({ instance, group, phase, name, count });
  if (instance.steps.length > 1) {
    const loop = make("path", { d: `M ${position.x + 72} ${position.y - 4} A 27 27 0 1 1 ${position.x + 110} ${position.y - 4}`, class: "edge" });
    edgeLayer.append(loop);
    loops.set(index, loop);
  }
});

const requestedLanguage = new URLSearchParams(window.location.search).get("lang");
let language = requestedLanguage === "zh" ? "zh" : "en";
const state = { index: 0, playing: false, timer: undefined, hoveredIndex: undefined };
const localized = (node) => nodes[node][language === "zh" ? "zh" : "en"];
const elapsed = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const statusText = (status) => status === "complete" ? copy[language].complete : status === "waiting-user" ? copy[language].waiting : copy[language].actionable;

const countText = (instance, currentStep) => {
  const c = copy[language];
  if (instance.steps.length > 1) {
    const done = instance.steps.filter((step) => steps.indexOf(step) <= currentStep).length;
    return `${c.loop} ${done} / ${instance.steps.length}`;
  }
  const step = instance.steps[0];
  if (step.checkpoint) return `${c.checkpoint} ${step.checkpoint}/${step.checkpoints}`;
  return c.single;
};

function renderList() {
  const list = byId("event-list");
  list.replaceChildren();
  const fragment = document.createDocumentFragment();
  steps.forEach((step, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-item${index === state.index ? " active" : ""}`;
    const number = document.createElement("span");
    number.className = "event-step";
    number.textContent = String(index + 1).padStart(2, "0");
    const body = document.createElement("span");
    body.className = "event-copy";
    const title = document.createElement("span");
    title.className = "event-title";
    title.textContent = localized(step.node)[0];
    body.append(title);
    button.append(number, body);
    button.addEventListener("click", () => { pause(); state.index = index; render(); });
    button.addEventListener("mouseenter", () => { state.hoveredIndex = index; renderGraph(); });
    button.addEventListener("mouseleave", () => { state.hoveredIndex = undefined; renderGraph(); });
    button.addEventListener("focus", () => { state.hoveredIndex = index; renderGraph(); });
    button.addEventListener("blur", () => { state.hoveredIndex = undefined; renderGraph(); });
    fragment.append(button);
  });
  list.append(fragment);
  byId("rail-count").textContent = `${steps.length} ${copy[language].steps}`;
}

function renderGraph() {
  const currentStep = steps[state.index];
  const hoveredStep = state.hoveredIndex === undefined ? undefined : steps[state.hoveredIndex];
  const hoveredInstance = hoveredStep
    ? instances.findIndex((instance) => instance.steps.includes(hoveredStep))
    : -1;
  let currentInstance = 0;
  instances.forEach((instance, index) => {
    if (instance.steps.some((step) => steps.indexOf(step) <= state.index)) currentInstance = index;
  });
  nodeElements.forEach(({ instance, group, phase, name, count }, index) => {
    phase.textContent = nodes[instance.node].phase;
    name.textContent = localized(instance.node)[0];
    count.textContent = countText(instance, state.index);
    const hoverClass = index !== hoveredInstance
      ? ""
      : state.hoveredIndex <= state.index
        ? " hover-executed"
        : " hover-future";
    group.setAttribute("class", `node ${index > currentInstance ? "future" : "visited"}${index === currentInstance ? " current" : ""}${instance.node === "current-scope-complete" && currentStep.node === "current-scope-complete" ? " complete" : ""}${hoverClass}`);
  });
  edges.forEach((edge, index) => {
    const className = index === currentInstance - 1 ? "edge current" : index < currentInstance - 1 ? "edge visited" : "edge";
    edge.setAttribute("class", className);
    edge.setAttribute("marker-end", className.includes("current") ? "url(#arrow-active)" : className.includes("visited") ? "url(#arrow-visited)" : "url(#arrow)");
  });
  loops.forEach((loop, index) => {
    const className = index < currentInstance ? "edge visited" : index === currentInstance ? "edge current" : "edge";
    loop.setAttribute("class", className);
    loop.setAttribute("marker-end", className.includes("current") ? "url(#arrow-active)" : className.includes("visited") ? "url(#arrow-visited)" : "url(#arrow)");
  });
  fieldLabels.forEach(({ label, index }) => { label.textContent = copy[language].fields[index]; });
}

function artifactLink(path, role) {
  const link = document.createElement("a");
  link.href = `${workflowBlob}/${path}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.innerHTML = `<span>${role}</span><code>${path}</code>`;
  return link;
}

function renderWorkflowLinks(nodeId) {
  const container = byId("workflow-links");
  container.replaceChildren();
  const artifacts = workflowArtifacts[nodeId] ?? { resources: [] };
  if (artifacts.action) {
    container.append(artifactLink(artifacts.action, copy[language].actionFile));
  } else {
    const note = document.createElement("p");
    note.textContent = nodeId === "current-scope-complete" ? copy[language].terminalNode : copy[language].gateContract;
    container.append(note);
  }
  for (const resource of artifacts.resources) {
    container.append(artifactLink(resource, copy[language].resourceFiles));
  }
}

function renderContractMap() {
  const map = byId("contract-map");
  map.replaceChildren();
  const fragment = document.createDocumentFragment();
  workspaceGroups.forEach((group, groupIndex) => {
    const lane = document.createElement("section");
    lane.className = "contract-lane";
    const heading = document.createElement("h3");
    heading.textContent = language === "zh" ? group.zh : group.en;
    lane.append(heading);
    const nodesList = document.createElement("div");
    nodesList.className = "contract-nodes";
    group.nodes.forEach(([en, zh, kind]) => {
      const node = document.createElement("div");
      node.className = `contract-node ${kind}`;
      const label = document.createElement("strong");
      label.textContent = language === "zh" ? zh : en;
      const badge = document.createElement("span");
      badge.textContent = kind;
      node.append(label, badge);
      nodesList.append(node);
    });
    lane.append(nodesList);
    fragment.append(lane);
    if (groupIndex < workspaceGroups.length - 1) {
      const connector = document.createElement("div");
      connector.className = "contract-connector";
      connector.textContent = "→";
      fragment.append(connector);
    }
  });
  map.append(fragment);
}

function renderInspector() {
  const step = steps[state.index];
  const text = localized(step.node);
  byId("state-value").textContent = statusText(step.status);
  byId("why-value").textContent = text[1];
  byId("action-value").textContent = text[2];
  byId("evidence-value").textContent = text[3];
  byId("sequence-value").textContent = elapsed(step.elapsed);
  byId("command-value").textContent = commands[step.node];
  renderWorkflowLinks(step.node);
  byId("technical-value").textContent = `statusCode: ${step.status}\nreasonCode: ${step.reasonCode}\nnode: ${step.node}`;
}

function render() {
  const step = steps[state.index];
  byId("step-count").textContent = `${state.index + 1} / ${steps.length}`;
  byId("event-time").textContent = elapsed(step.elapsed);
  byId("scrubber").max = String(steps.length - 1);
  byId("scrubber").value = String(state.index);
  byId("progress-fill").style.width = `${state.index / (steps.length - 1) * 100}%`;
  byId("previous").disabled = state.index === 0;
  byId("next").disabled = state.index === steps.length - 1;
  renderGraph();
  renderInspector();
  document.querySelectorAll(".event-item").forEach((item, index) => item.classList.toggle("active", index === state.index));
  document.querySelector(".event-item.active")?.scrollIntoView({ block: "nearest" });
}

function applyLanguage() {
  const c = copy[language];
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = language === "zh" ? "Context · Agent Graph 实践案例" : "Context · Agent Graph case study";
  byId("brand-link").setAttribute("aria-label", c.brandLabel);
  byId("page-title").textContent = c.title;
  byId("case-link").textContent = c.case;
  byId("case-link").href = language === "zh"
    ? "https://github.com/context4ai/context/blob/main/docs/zh-CN/case-studies/agent-graph-workflow.md"
    : "https://github.com/context4ai/context/blob/main/docs/en/case-studies/agent-graph-workflow.md";
  byId("language").textContent = language === "zh" ? "EN" : "中文";
  byId("theme").setAttribute("aria-label", c.theme);
  byId("previous").setAttribute("aria-label", c.previous);
  byId("next").setAttribute("aria-label", c.next);
  byId("speed").setAttribute("aria-label", c.speed);
  byId("scrubber").setAttribute("aria-label", c.scrubber);
  byId("play").textContent = state.playing ? c.pause : c.play;
  byId("rail-title").textContent = c.journey;
  byId("inspector-title").textContent = c.inspector;
  byId("explainer-label").textContent = c.explainer;
  byId("state-label").textContent = c.state;
  byId("why-label").textContent = c.why;
  byId("action-label").textContent = c.action;
  byId("evidence-label").textContent = c.evidence;
  byId("time-label").textContent = c.time;
  byId("command-summary").textContent = c.command;
  byId("workflow-summary").textContent = c.workflow;
  byId("technical-summary").textContent = c.protocol;
  byId("graph-map").textContent = c.graphMap;
  byId("graph-dialog-label").textContent = c.graphDialogLabel;
  byId("graph-dialog-title").textContent = c.graphDialogTitle;
  byId("graph-dialog-copy").textContent = c.graphDialogCopy;
  byId("workflow-source").textContent = c.workflowSource;
  byId("workflow-source").href = workflowRoot;
  byId("graph-source").textContent = c.graphSource;
  byId("github-link").setAttribute("aria-label", c.github);
  byId("github-link").setAttribute("title", c.github);
  byId("graph-close").setAttribute("aria-label", c.close);
  byId("provenance").textContent = c.provenance;
  svg.setAttribute("aria-label", language === "zh" ? "Context 工作图" : "Context work graph");
  renderContractMap();
  renderList();
  render();
}

function pause() {
  state.playing = false;
  clearTimeout(state.timer);
  byId("play").textContent = copy[language].play;
}

function tick() {
  if (!state.playing) return;
  if (state.index >= steps.length - 1) { pause(); return; }
  state.index += 1;
  render();
  state.timer = setTimeout(tick, Number(byId("speed").value));
}

function togglePlay() {
  if (state.playing) { pause(); return; }
  if (state.index === steps.length - 1) state.index = 0;
  state.playing = true;
  byId("play").textContent = copy[language].pause;
  render();
  state.timer = setTimeout(tick, Number(byId("speed").value));
}

byId("play").addEventListener("click", togglePlay);
byId("previous").addEventListener("click", () => { pause(); state.index = Math.max(0, state.index - 1); render(); });
byId("next").addEventListener("click", () => { pause(); state.index = Math.min(steps.length - 1, state.index + 1); render(); });
byId("scrubber").addEventListener("input", (event) => { pause(); state.index = Number(event.target.value); render(); });
byId("speed").addEventListener("change", () => { if (state.playing) { clearTimeout(state.timer); state.timer = setTimeout(tick, Number(byId("speed").value)); } });
byId("theme").addEventListener("click", () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; });
byId("graph-map").addEventListener("click", () => byId("graph-dialog").showModal());
byId("graph-close").addEventListener("click", () => byId("graph-dialog").close());
byId("graph-dialog").addEventListener("click", (event) => {
  if (event.target === byId("graph-dialog")) byId("graph-dialog").close();
});
byId("language").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  const url = new URL(window.location.href);
  url.searchParams.set("lang", language);
  window.history.replaceState({}, "", url);
  applyLanguage();
});
document.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (event.code === "Space") { event.preventDefault(); togglePlay(); }
  if (event.key === "ArrowLeft") { pause(); state.index = Math.max(0, state.index - 1); render(); }
  if (event.key === "ArrowRight") { pause(); state.index = Math.min(steps.length - 1, state.index + 1); render(); }
});

applyLanguage();
