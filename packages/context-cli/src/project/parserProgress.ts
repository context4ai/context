/** Progress is diagnostic output; stdout remains a single machine-readable result. */
export function parserProgress(label: string, write = (text: string) => process.stderr.write(text)) {
  const started = performance.now();
  const emit = (state: string) => {
    const rss = Math.round(process.memoryUsage().rss / 1048576);
    write(`[context parser] ${label.replace(/[\r\n]/gu, " ")} | ${state} | ${Math.round((performance.now() - started) / 1000)}s | process RSS ${rss} MiB\n`);
  };
  emit("started");
  const timer = setInterval(() => emit("running"), 10_000);
  timer.unref();
  return {
    update: (state: string) => emit(state),
    close: (state = "completed") => { clearInterval(timer); emit(state); },
  };
}
