# @c4a/tui

基于 Ink 5.x 的终端 UI 共享组件库，供 `dev-cli` 使用。

## Ink stdin 生命周期陷阱（必须遵守）

Ink 在 unmount 时会对 `process.stdin` 执行以下操作：

1. `stdin.setRawMode(false)` — 关闭 raw mode
2. `stdin.removeListener("readable", ...)` — 移除数据监听
3. **`stdin.unref()`** — 取消事件循环引用

第 3 步会导致：Ink 退出后如果立即使用 `readline.createInterface` 读取用户输入，Node.js 事件循环因无活跃 ref handle 而**直接退出进程**，readline 来不及等待输入。

**任何在 Ink render/unmount 之后需要读取 stdin 的场景，都必须先恢复 stdin 状态：**

```typescript
function resetStdin(): void {
  const { stdin } = process;
  if (stdin.isTTY) {
    try {
      stdin.setRawMode(false);
    } catch {
      // ignore
    }
  }
  if (typeof stdin.ref === "function") {
    stdin.ref();       // 重新引用，防止事件循环退出
  }
  if (stdin.isPaused()) {
    stdin.resume();    // 恢复流
  }
  // 清理 Ink 遗留的 listener
  stdin.removeAllListeners("readable");
  stdin.removeAllListeners("data");
}
```

**调用时机**：在 `inkRender` 返回的 `waitUntilExit()` resolve 之后、执行任何 readline 操作之前。

典型模式：

```typescript
const selection = await showMenu();  // 内部 inkRender + waitUntilExit
resetStdin();                        // 必须在此恢复
await executeCommand(selection);     // 内部可安全使用 readline
```

## Unicode 宽字符与 Ink 布局（必须遵守）

Ink 的底层布局引擎（Yoga）按**字符数**计算宽度，不感知终端实际列宽。以下字符在终端中占 2 列，但 Yoga 只算 1 列：

- CJK 汉字（charCode > 0x7F 的大部分字符）
- 特殊符号如 `▶`（U+25B6）、`→`（U+2192）等

这会导致：将宽字符和普通空格写在同一个 `<Text>` 中，选中/未选中状态切换时文字左右跳动。

**错误做法**：将指示符和标签放在同一个 Text 中

```tsx
// ❌ "▶ " 在终端占 3 列，但 Yoga 认为占 2 列
// "   " 在终端和 Yoga 中都占 3 列 → 选中时文字向左偏移 1 字符
<Text>
  {selected ? "▶ " : "   "}
  {label}
</Text>
```

**正确做法**：将指示符放入固定宽度的独立 Box

```tsx
// ✅ Box 的 width 由 Yoga 强制固定，内容不影响布局
<Box>
  <Box width={3}>
    <Text>{selected ? "▶" : " "}</Text>
  </Box>
  <Text>{label}</Text>
</Box>
```

**CJK 文本宽度计算**：在需要手动对齐（如 padEnd）时，必须按终端列宽计算：

```typescript
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  }
  return w;
}
```
