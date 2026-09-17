/** Uses the host website's tokens, with the offline Review's equivalents. */
export const DIAGRAM_STYLES = String.raw`
.context-diagram-shell{--diagram-bg:var(--vp-c-bg,var(--bg,#fff));--diagram-text:var(--vp-c-text-1,var(--text,#161e2e));--diagram-muted:var(--vp-c-text-2,var(--muted,#646b7c));--diagram-line:var(--vp-c-divider,var(--line,#e7e9ef));--diagram-brand:var(--vp-c-brand-1,var(--blue,#2563eb));position:relative;color:var(--diagram-text);background:var(--diagram-bg);border:1px solid var(--diagram-line);border-radius:6px;margin:16px 0;overflow:hidden}
.context-diagram-tools{position:absolute;top:0;left:0;right:0;z-index:2;background:var(--diagram-bg);display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid var(--diagram-line)}
.context-diagram-tools button,.context-diagram-tools select{appearance:auto;box-sizing:border-box;min-height:28px;margin:0;padding:3px 9px;border:1px solid var(--diagram-line);border-radius:5px;background:var(--diagram-bg);color:var(--diagram-muted);font:12px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
.context-diagram-tools button:hover,.context-diagram-tools select:hover{border-color:var(--diagram-brand);color:var(--diagram-brand)}
.context-diagram-tools :focus-visible,.context-diagram-viewport:focus-visible{outline:2px solid var(--diagram-brand);outline-offset:-2px}
.context-diagram-percent{font-size:11px;color:var(--diagram-muted);min-width:34px;text-align:center}
.context-diagram-viewport{overflow:auto;max-height:620px;min-height:60px;overscroll-behavior:contain;cursor:grab}
.context-diagram-viewport:active{cursor:grabbing}.context-diagram-canvas{padding:16px;width:max-content;min-width:100%;box-sizing:border-box}
.context-diagram-canvas svg{display:block;margin:auto;height:auto;max-width:none}.context-diagram-status{padding:12px 16px;font-size:13px;color:var(--diagram-muted)}
.context-diagram-expanded{position:fixed!important;inset:16px!important;z-index:10000!important;margin:0!important;display:flex;flex-direction:column;box-shadow:0 0 0 100vmax #10182788}
.context-diagram-expanded .context-diagram-viewport{flex:1;max-height:none}.context-diagram-expanded .context-diagram-tools{flex-shrink:0}
.vp-doc div.language-mermaid.context-rendered{background:transparent;border:0}
.context-rendered>pre,.context-rendered>.copy,.context-rendered>.lang{display:none!important}.context-diagram-shell [hidden]{display:none!important}
.context-diagram-left,.context-diagram-right{display:flex;align-items:center;flex-wrap:wrap;gap:6px}.context-diagram-right{margin-left:auto}
.context-diagram-tools{opacity:0;pointer-events:none;transition:opacity .15s}.context-diagram-shell:hover .context-diagram-tools,.context-diagram-shell:focus-within .context-diagram-tools{opacity:1;pointer-events:auto}
.context-diagram-shell pre.context-diagram-source{margin:0;padding:16px;overflow:auto;max-height:620px;background:transparent;font-size:12px;line-height:1.6;white-space:pre}
.context-diagram-source code{font:inherit!important;color:var(--diagram-text)!important;padding:0!important;background:transparent!important}
.context-diagram-expanded .context-diagram-source{flex:1;max-height:none}
@media(hover:none){.context-diagram-tools{opacity:1;pointer-events:auto}}
@media(max-width:700px){.context-diagram-original,.context-diagram-source-toggle{display:none!important}.context-diagram-expanded{inset:4px!important}.context-diagram-tools{gap:4px;padding:6px}.context-diagram-tools button,.context-diagram-tools select{padding:3px 6px}}
`;
