import { createContext, runInContext } from "node:vm";

/** A deterministic browser clock/storage surface for the standalone report. */
export function openReport(html: string, storage = new Map<string, string>()) {
  const elements = new Map<string, ReturnType<typeof element>>();
  function element() {
    const classes = new Set<string>();
    const handlers = new Map<string, (event: { target: { value: string } }) => void>();
    return {
      innerHTML: "", textContent: "", value: "", disabled: false, hidden: false, open: false,
      style: { height: "", width: "", setProperty() {} }, parentElement: { hidden: false },
      scrollHeight: 100, clientHeight: 100, offsetHeight: 64,
      classList: {
        toggle: (name: string, on?: boolean) => (on ?? !classes.has(name)) ? classes.add(name) : classes.delete(name),
        contains: (name: string) => classes.has(name), remove: (name: string) => classes.delete(name),
      },
      querySelector: () => null, setAttribute() {}, focus() {}, select() {},
      addEventListener: (name: string, handler: (event: { target: { value: string } }) => void) => handlers.set(name, handler),
      dispatchEvent(event: { type: string }) { handlers.get(event.type)?.({ target: this }); },
      showModal() { this.open = true; }, close() { this.open = false; },
    };
  }
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id)!;
  };
  let copied = "", now = 0, timerId = 0;
  const timers = new Map<number, () => void>();
  const runtime = createContext({
    performance: { now: () => now },
    setInterval: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearInterval: (id: number) => timers.delete(id),
    setTimeout: () => ++timerId, clearTimeout() {},
    document: { getElementById: get, querySelector: get, querySelectorAll: () => [],
      body: get("body"), documentElement: get("html"), addEventListener() {} },
    localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) },
    location: { hash: "", pathname: "/report.html", search: "" },
    history: { replaceState() {} },
    Event: class { constructor(public type: string) {} },
    ResizeObserver: class { observe() {} },
    window: { scrollTo() {}, addEventListener() {} },
    navigator: { clipboard: { writeText: async (text: string) => { copied = text; } } },
  });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
  runInContext(scripts.find(match => match[1]?.includes("const DATA="))![1]!, runtime);
  runInContext('language="en"; render()', runtime);
  return {
    runtime, get, storage, copied: () => copied,
    input(id: string, value: string) { const input = get(id); input.value = value; input.dispatchEvent({ type: "input" }); },
    advance(ms: number) { now += ms; for (const fn of [...timers.values()]) fn(); },
  };
}
