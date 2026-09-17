import type { Mermaid, MermaidConfig } from "mermaid";

/** Self-contained browser factory, embedded in both the site and offline Review. */
export function createDiagramViewer(load: () => Promise<Mermaid>) {
  type State = {
    source: string; signature: string; revision: number; shell: HTMLElement;
    viewport: HTMLElement; canvas: HTMLElement; status: HTMLElement;
    scale: number; width: number; fit: boolean; layout: string; observer?: ResizeObserver;
    resize: () => void; close: () => void;
  };
  const states = new Map<HTMLElement, State>();
  let queue: Promise<void> = Promise.resolve();
  let serial = 0;
  let disposed = false;
  const instance = Math.random().toString(36).slice(2);
  const translations = {
    en: { fit: "Fit", original: "100%", zoomIn: "Zoom in", zoomOut: "Zoom out", expand: "Full screen", close: "Exit full screen", source: "Source", diagram: "Diagram", compact: "Compact style", intuitive: "Layered style", copy: "Copy", copied: "Copied", copyFailed: "Select and copy the source", layout: "Layout", loading: "Rendering diagram…", error: "Diagram could not be rendered. View the source below.", area: "Diagram. Use arrow keys to pan, plus or minus to zoom.", toolbar: "Diagram controls" },
    zh: { fit: "适配", original: "100%", zoomIn: "放大", zoomOut: "缩小", expand: "全屏", close: "退出全屏", source: "源码", diagram: "图表", compact: "紧凑风格", intuitive: "直观风格", copy: "复制", copied: "已复制", copyFailed: "请选中源码复制", layout: "布局", loading: "正在绘制图表…", error: "图表暂时无法渲染，请查看下方源码。", area: "图表。使用方向键平移，加减键缩放。", toolbar: "图表工具" },
  };
  function configuration(dark: boolean, layout: string, host: HTMLElement): MermaidConfig {
    const css = getComputedStyle(host);
    const color = (key: string, fallback: string) => css.getPropertyValue("--context-" + key).trim() || fallback;
    return {
      startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
      // Source directives cannot override site security, sizing or the selected layout.
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "theme", "themeVariables", "themeCSS", "dompurifyConfig", "fontFamily", "htmlLabels", "flowchart", "sequence", "layout"],
      theme: "base", layout,
      dompurifyConfig: { FORBID_TAGS: ["img", "image", "script", "iframe", "object", "embed", "style", "link"] },
      themeVariables: {
        darkMode: dark, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: "15px", primaryColor: color("surface", dark ? "#202735" : "#f5f8ff"),
        primaryTextColor: color("text", dark ? "#e2e4ed" : "#161e2e"),
        primaryBorderColor: color("border", dark ? "#8ea0bd" : "#8090aa"), lineColor: color("muted-text", dark ? "#9faec5" : "#66758d"),
        secondaryColor: color("surface", dark ? "#252c38" : "#f8f9fc"), tertiaryColor: color("surface", dark ? "#202735" : "#f5f8ff"),
        clusterBkg: color("surface", dark ? "#1b212d" : "#fafbfe"), clusterBorder: color("border", dark ? "#475267" : "#d7deea"),
        edgeLabelBackground: color("background", dark ? "#171b24" : "#ffffff"),
        actorBkg: color("surface", dark ? "#202735" : "#f5f8ff"), actorTextColor: color("text", dark ? "#e2e4ed" : "#161e2e"),
        signalColor: color("muted-text", dark ? "#9faec5" : "#66758d"), signalTextColor: color("text", dark ? "#e2e4ed" : "#161e2e"),
      },
      flowchart: { useMaxWidth: false, nodeSpacing: 36, rankSpacing: 58, padding: 16, curve: "linear", wrappingWidth: 220, htmlLabels: false },
      sequence: { useMaxWidth: false, diagramMarginX: 24, diagramMarginY: 20, actorMargin: 48, messageMargin: 38, wrap: true },
      state: { useMaxWidth: false }, er: { useMaxWidth: false },
    };
  }
  function prune() {
    for (const [node, state] of states) if (!node.isConnected) {
      state.observer?.disconnect(); state.close(); states.delete(node);
    }
  }
  function mount(node: HTMLElement, source: string, dark: boolean, language: string) {
    const prior = states.get(node);
    prior?.observer?.disconnect(); prior?.close(); prior?.shell.remove();
    const t = language.startsWith("zh") ? translations.zh : translations.en;
    const shell = document.createElement("div"); shell.className = "context-diagram-shell";
    const toolbar = document.createElement("div"); toolbar.className = "context-diagram-tools";
    toolbar.setAttribute("role", "group"); toolbar.setAttribute("aria-label", t.toolbar);
    const viewport = document.createElement("div"); viewport.className = "context-diagram-viewport";
    viewport.tabIndex = 0; viewport.setAttribute("role", "region"); viewport.setAttribute("aria-label", t.area);
    const canvas = document.createElement("div"); canvas.className = "context-diagram-canvas"; viewport.append(canvas);
    const status = document.createElement("div"); status.className = "context-diagram-status";
    status.setAttribute("role", "status"); status.textContent = t.loading;
    shell.append(toolbar, status, viewport); node.append(shell);
    const state: State = { source, signature: `${dark}:${language}`, revision: 0, shell, viewport, canvas, status,
      scale: prior?.scale ?? 1, width: 0, fit: prior?.fit ?? true, layout: prior?.layout ?? "elk", resize: () => {}, close: () => {} };
    states.set(node, state); node.classList.add("context-rendered");
    const button = (text: string, title: string, action: () => void) => {
      const element = document.createElement("button"); element.type = "button";
      element.textContent = text; element.title = title; element.setAttribute("aria-label", title);
      element.onclick = action; toolbar.append(element); return element;
    };
    const left = document.createElement("div"); left.className = "context-diagram-left";
    const right = document.createElement("div"); right.className = "context-diagram-right";
    toolbar.append(left, right);
    const sourceView = document.createElement("pre"); sourceView.className = "context-diagram-source";
    const sourceCode = document.createElement("code"); sourceCode.textContent = source; sourceView.append(sourceCode); shell.append(sourceView);
    const percent = document.createElement("span"); percent.className = "context-diagram-percent";
    function resize() {
      const svg = canvas.querySelector("svg"); if (!svg || !state.width) return;
      if (state.fit) state.scale = Math.min(1, Math.max(.1, (viewport.clientWidth - 32) / state.width));
      svg.style.width = `${state.width * state.scale}px`; svg.style.maxWidth = "none"; svg.style.height = "auto";
      percent.textContent = `${Math.round(state.scale * 100)}%`;
    }
    state.resize = resize;
    function zoom(factor: number) { state.fit = false; state.scale = Math.min(4, Math.max(.1, state.scale * factor)); resize(); }
    const fit = button(t.fit, t.fit, () => { state.fit = true; resize(); viewport.scrollTo(0, 0); });
    button(t.original, t.original, () => { state.fit = false; state.scale = 1; resize(); }).classList.add("context-diagram-original");
    button("−", t.zoomOut, () => zoom(1 / 1.2)); button("+", t.zoomIn, () => zoom(1.2)); toolbar.append(percent);
    const full = button(t.expand, t.expand, () => {
      const expanded = shell.classList.toggle("context-diagram-expanded");
      full.textContent = expanded ? t.close : t.expand; full.setAttribute("aria-label", full.textContent); full.title = full.textContent;
      full.setAttribute("aria-pressed", String(expanded));
      if (expanded) { document.addEventListener("keydown", escape); viewport.focus(); }
      else document.removeEventListener("keydown", escape);
      resize();
    });
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { state.close(); full.focus(); } }
    state.close = () => { shell.classList.remove("context-diagram-expanded"); document.removeEventListener("keydown", escape); full.textContent = t.expand; full.title = t.expand; full.setAttribute("aria-pressed", "false"); resize(); };
    const sourceButton = button(t.source, t.source, () => {
      node.classList.toggle("context-show-source"); updateSource(); resize();
    });
    sourceButton.classList.add("context-diagram-source-toggle");
    const copy = button(t.copy, t.copy, () => { void (async () => {
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(source);
        else {
          const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(sourceCode);
          selection?.removeAllRanges(); selection?.addRange(range);
          if (!document.execCommand("copy")) throw new Error("Copy unavailable");
          selection?.removeAllRanges();
        }
        copy.textContent = t.copied;
      } catch { copy.textContent = t.copyFailed; }
    })(); });
    function updateSource() {
      const showing = node.classList.contains("context-show-source");
      sourceView.hidden = !showing; viewport.hidden = showing; copy.hidden = !showing;
      sourceButton.textContent = showing ? t.diagram : t.source;
      sourceButton.setAttribute("aria-label", sourceButton.textContent); sourceButton.title = sourceButton.textContent;
      sourceButton.setAttribute("aria-pressed", String(showing));
    }
    const canChooseLayout = /^\s*(?:---[\s\S]*?---\s*)?(?:flowchart|graph)\b/u.test(source);
    if (canChooseLayout) {
      const layout = button(state.layout === "elk" ? t.compact : t.intuitive, t.layout, () => {
        state.layout = state.layout === "elk" ? "dagre" : "elk";
        layout.textContent = state.layout === "elk" ? t.compact : t.intuitive;
        layout.setAttribute("aria-pressed", String(state.layout === "elk")); void draw();
      });
      layout.setAttribute("aria-pressed", String(state.layout === "elk")); left.append(layout);
    }
    left.append(sourceButton, copy);
    for (const element of [...toolbar.children]) if (element !== left && element !== right) right.append(element);
    right.append(fit, full);
    updateSource();
    viewport.onkeydown = event => {
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.2); }
      if (event.key === "-") { event.preventDefault(); zoom(1 / 1.2); }
    };
    let drag: { x: number; y: number; left: number; top: number } | undefined;
    viewport.onpointerdown = event => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      viewport.setPointerCapture(event.pointerId);
    };
    viewport.onpointermove = event => { if (drag) { viewport.scrollLeft = drag.left + drag.x - event.clientX; viewport.scrollTop = drag.top + drag.y - event.clientY; } };
    viewport.onpointerup = viewport.onpointercancel = () => { drag = undefined; };
    if (typeof ResizeObserver !== "undefined") { state.observer = new ResizeObserver(resize); state.observer.observe(viewport); }
    function draw() {
      const revision = ++state.revision;
      status.hidden = false; status.textContent = t.loading;
      queue = queue.catch(() => {}).then(async () => {
        if (disposed || !node.isConnected || states.get(node) !== state || state.revision !== revision) return;
        const id = `context-diagram-${instance}-${++serial}`;
        try {
          // Reader diagrams are offline content. Mermaid strict mode alone still
          // permits image fetches; resource-bearing markup stays visible as source.
          if (/<(?:img|image|iframe|object|embed|script|style|link)\b/iu.test(source) || /@\{[^}]*\bimg\s*:/iu.test(source)) throw new Error("Embedded resources are unsupported");
          const mermaid = await load();
          mermaid.initialize(configuration(dark, state.layout, node));
          if (!await mermaid.parse(source, { suppressErrors: true })) throw new Error("Invalid Mermaid");
          const { svg } = await mermaid.render(id, source);
          if (disposed || !node.isConnected || states.get(node) !== state || state.revision !== revision) return;
          canvas.innerHTML = svg;
          const element = canvas.querySelector("svg");
          if (!element) throw new Error("Missing SVG");
          state.width = element.viewBox.baseVal.width || element.getBoundingClientRect().width || 640;
          element.setAttribute("role", "img");
          if (!element.hasAttribute("aria-label") && !element.hasAttribute("aria-labelledby")) element.setAttribute("aria-label", t.area);
          status.hidden = true; resize();
        } catch (error) {
          status.title = error instanceof Error ? error.message : String(error);
          document.getElementById(`d${id}`)?.remove(); canvas.replaceChildren();
          status.hidden = false; status.textContent = t.error;
          node.classList.add("context-show-source"); updateSource();
        }
      });
      return queue;
    }
    return draw();
  }
  return {
    async render(root: ParentNode, options: { dark: boolean; language: string }) {
      prune();
      for (const node of root.querySelectorAll<HTMLElement>("div.language-mermaid")) {
        if (!node.isConnected) continue;
        const code = node.querySelector("pre code"); if (!code) continue;
        const source = code.textContent ?? "";
        const state = states.get(node);
        if (state?.source === source && state.signature === `${options.dark}:${options.language}`) continue;
        await mount(node, source, options.dark, options.language);
      }
      await queue;
    },
    destroy() { disposed = true; for (const state of states.values()) { state.observer?.disconnect(); state.close(); } states.clear(); },
  };
}

export const DIAGRAM_VIEWER_SCRIPT = `(${createDiagramViewer.toString()})`;
