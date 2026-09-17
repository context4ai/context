import mermaid from "mermaid";
import elk from "@mermaid-js/layout-elk";
import { createDiagramViewer } from "./diagramViewer.js";
mermaid.registerLayoutLoaders(elk);
Object.assign(globalThis, { contextDiagramViewer: createDiagramViewer(async () => mermaid) });
