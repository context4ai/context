import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import type { ArticleStructureEntry, SourcesRegistry } from "@c4a/context";
import { siteReferenceSource } from "./packageSiteSources.js";

/** A label in every reader language, or one string shared by all of them. */
export type SiteMapText = string | Record<string, string>;
export interface SiteSourceMapArea {
  kind: "repo" | "lark" | "note" | "other";
  label: SiteMapText;
  color: string;
  /** Circles `[x, y, r]` the theme melts into one flat blob. */
  blobs: number[][];
  /** Label position and its tilt in degrees, following the blob's outer edge. */
  lx: number; ly: number; la: number;
}
export interface SiteSourceMapDocument {
  title: string; path: string; area: number; x: number; y: number; r: number;
  /** Free space for the label to the left and right of the node. */
  rl: number; rr: number;
  /** `s` is the section index; one entry per cited region. */
  refs: { s: number; lines: [number, number]; href?: string }[];
}
/** One article's recorded references laid out for the website: its sections in the middle,
 * the cited documents grouped by where they come from around them. */
export interface SiteSourceMap {
  w: number; h: number;
  sections: { id: string; titles: Record<string, string>; x: number; y: number; rl: number; rr: number }[];
  sectionArea: { blobs: number[][]; lx: number; ly: number; la: number };
  areas: SiteSourceMapArea[];
  docs: SiteSourceMapDocument[];
  /** Other delivered articles citing at least one of the same documents; `docs` are indexes. */
  others: { titles: Record<string, string>; href: string; docs: number[] }[];
}
export interface SiteSourceMapArticle {
  article: ArticleStructureEntry;
  href: string;
  titles: Record<string, string>;
  /** Section id → reader language → heading. */
  sectionTitles: Record<string, Record<string, string>>;
}

const WIDTH = 720;
const AREA_LIMIT = 6;
/** Each source type has one fixed colour; the article's own sections are purple in the theme. */
const TYPE_COLORS = { repo: "#16a34a", skill: "#db2777", lark: "#2e7dd6", note: "#ea7a1e", other: "#8a8f98" } as const;
type SourceType = keyof typeof TYPE_COLORS;
/** Repository files, code and documentation alike, share one colour; Skills have their own. */
function sourceType(document: { kind: SiteSourceMapArea["kind"]; path: string }): SourceType {
  if (document.kind !== "repo") return document.kind;
  return /(?:^|\/)skills?\//iu.test(document.path) || /(?:^|\/)skill\.md$/iu.test(document.path) ? "skill" : "repo";
}
const KIND_LABELS = { lark: { zh: "飞书文档", en: "Lark docs" }, note: { zh: "笔记", en: "Notes" } } as const;
/** The theme names the sections' blob; only its width matters here. */
const SECTIONS_LABEL = { zh: "本文段落", en: "This article" };
const round = (value: number) => Math.round(value * 10) / 10;
/** One cited document: a registered source and a path inside it. */
export const siteDocumentKey = (sourceRef: string, path: string) => `${sourceRef}\u0000${path}`;

const plain = (value: string) => value.replace(/\s*\{#[^}]*\}$/u, "").replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
  .replace(/<[^>]+>/gu, "").replace(/[*_`~]/gu, "").replace(/\s+/gu, " ").trim();
/** Section names from approved Markdown: the section's heading, else the start of its first line of
 * prose. The opening section before any heading gets no name; the theme calls it the opening. */
export function siteSectionHeadings(markdown: string): Map<string, string> {
  const headings = new Map<string, string>();
  let first = true;
  for (const match of markdown.matchAll(/<!--\s*context:section\b[^>]*\bid="([^"]+)"[^>]*-->([\s\S]*?)(?=<!--\s*\/?context:section\b|$)/gu)) {
    const opening = first;
    first = false;
    if (headings.has(match[1]!)) continue;
    const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/mu.exec(match[2]!)?.[1];
    const prose = match[2]!.split(/\r?\n/u).map(line => plain(line.replace(/^(?:\s*>)+\s*(?:\[![A-Za-z]+\]\s*)?/u, "").replace(/^\s*(?:[-*+]|\d+\.)\s+/u, "")))
      .find(line => line && !/^(?:```|~~~|\||<!--)/u.test(line));
    const name = heading !== undefined ? plain(heading) : opening ? undefined : prose && [...prose].slice(0, 60).join("");
    if (name) headings.set(match[1]!, name);
  }
  return headings;
}

/** Repository files are titled by path, so every build titles them alike without reading snapshots. */
function pathTitle(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const file = parts.at(-1) ?? path;
  if (/^(?:skill|readme|index)\.mdx?$/iu.test(file) && parts.length > 1) return parts.at(-2)!;
  return file.replace(/\.[^.]+$/u, "") || file;
}
function seededRandom(seed: string) {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) | 0;
  return () => ((state = (Math.imul(state, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
}

interface Located { key: string; title: string; path: string; kind: SiteSourceMapArea["kind"]; owner: string; directory: string[];
  refs: { s: number; lines: [number, number]; href?: string }[] }
function locate(entry: SiteSourceMapArticle, registry: SourcesRegistry, titles: ReadonlyMap<string, string>, repositoryRemote?: string) {
  const documents = new Map<string, Located>();
  entry.article.sections.forEach((section, index) => section.references.forEach(reference => {
    const source = siteReferenceSource(reference, registry, repositoryRemote);
    const path = reference.locator.path;
    const key = siteDocumentKey(reference.source_ref, path);
    const document = documents.get(key) ?? { key, path, kind: source.kind, owner: source.owner, directory: path.split("/").slice(0, -1),
      title: titles.get(key) ?? (source.kind === "lark" ? source.owner : pathTitle(path)), refs: [] };
    const lines: [number, number] = [reference.locator.start_line, reference.locator.end_line];
    if (!document.refs.some(ref => ref.s === index && ref.lines[0] === lines[0] && ref.lines[1] === lines[1])) {
      document.refs.push({ s: index, lines, ...(source.href ? { href: source.href } : {}) });
    }
    documents.set(key, document);
  }));
  for (const document of documents.values()) document.refs.sort((left, right) => left.s - right.s || left.lines[0] - right.lines[0] || left.lines[1] - right.lines[1]);
  return [...documents.values()];
}

/** Repository documents group by module and leading directories, coarsened until few groups remain. */
function areasOf(documents: readonly Located[]) {
  const keyAt = (document: Located, depth: number) => document.kind === "repo"
    ? `repo:${document.owner}:${document.directory.slice(0, depth).join("/")}` : document.kind === "other" ? `other:${document.owner}` : document.kind;
  let depth = 3;
  while (depth > 0 && new Set(documents.map(document => keyAt(document, depth))).size > AREA_LIMIT) depth -= 1;
  return { depth, key: (document: Located) => keyAt(document, depth) };
}

/** Approximate drawn width of a label in the theme's 12px semibold type; wide characters count twice. */
const textUnits = (value: string) => [...value].reduce((sum, char) =>
  sum + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(char) ? 2 : 1), 0);
function labelWidth(label: SiteMapText): number {
  return Math.min(36, Math.max(...(typeof label === "string" ? [label] : Object.values(label)).map(textUnits))) * 6.6;
}

/** Node labels sit under their node. Each label may use the free space around it on its row, up to
 * halfway to the nearest neighbour on either side; the theme decides per reader language whether a
 * label fits on one line there or wraps. `rl`/`rr` are those distances to the left and right. */
function labelRoom(nodes: readonly { x: number; y: number }[]) {
  return nodes.map((node, index) => {
    const row = nodes.filter((other, at) => at !== index && Math.abs(other.y - node.y) < 34);
    const left = Math.max(8, ...row.filter(other => other.x < node.x).map(other => (node.x + other.x) / 2));
    const right = Math.min(WIDTH - 8, ...row.filter(other => other.x >= node.x).map(other => (node.x + other.x) / 2));
    return { rl: round(node.x - left), rr: round(right - node.x) };
  });
}

/** The outer edge of a blob above (or below) `x`: the highest (lowest) point of its circles there. */
function contour(circles: readonly number[][], x: number, below: boolean): number | undefined {
  let edge: number | undefined;
  for (const [cx, cy, r] of circles as [number, number, number][]) {
    const dx = x - cx;
    if (Math.abs(dx) >= r) continue;
    const y = below ? cy + Math.sqrt(r * r - dx * dx) : cy - Math.sqrt(r * r - dx * dx);
    if (edge === undefined || (below ? y > edge : y < edge)) edge = y;
  }
  return edge;
}

function layout(entry: SiteSourceMapArticle, documents: readonly Located[], areaKeys: readonly string[], areaOf: readonly number[],
  widths: { sections: number; areas: readonly number[] }) {
  const sections = entry.article.sections;
  // The middle grows with the sections, and the areas around it move out with it.
  const height = Math.round(Math.min(820, Math.max(440, 380 + sections.length * 16 + documents.length * 9)));
  const random = seededRandom(entry.article.article_id);
  const center: [number, number] = [WIDTH / 2, height / 2 + 6];
  // Areas sit evenly around the sections, in the order of the sections that use them.
  const usage = areaKeys.map((_, area) => {
    const used = documents.flatMap((document, index) => areaOf[index] === area ? document.refs.map(ref => ref.s) : []);
    return used.reduce((sum, value) => sum + value, 0) / Math.max(1, used.length);
  });
  const order = areaKeys.map((_, area) => area).sort((left, right) => usage[left]! - usage[right]! || left - right);
  const anchors = new Map<number, [number, number]>([[-1, center]]);
  order.forEach((area, position) => {
    const angle = -Math.PI / 2 + position / order.length * Math.PI * 2 + 0.35;
    anchors.set(area, [center[0] + Math.cos(angle) * WIDTH * 0.36, center[1] + Math.sin(angle) * height * 0.36]);
  });
  type Node = SimulationNodeDatum & { section: boolean; area: number; r: number };
  // Sections sit further apart, so their circles are larger to melt into one blob.
  const pad = (node: Node) => node.r + (node.section ? 32 : 24);
  const nodes: Node[] = [
    ...sections.map(() => ({ section: true, area: -1, r: 7.5 })),
    ...documents.map((document, index) => ({ section: false, area: areaOf[index]!, r: 5 + Math.min(document.refs.length, 7) * 0.75 })),
  ];
  for (const node of nodes) {
    const [x, y] = anchors.get(node.area)!;
    node.x = x + (random() - 0.5) * 30; node.y = y + (random() - 0.5) * 30;
  }
  const links = documents.flatMap((document, index) => [...new Set(document.refs.map(ref => ref.s))]
    .map(section => ({ source: nodes[section]!, target: nodes[sections.length + index]! })));
  const simulation = forceSimulation(nodes).randomSource(random)
    .force("link", forceLink(links).distance(130).strength(0.02))
    .force("charge", forceManyBody<Node>().strength(node => node.section ? -60 : -30))
    // Section labels sit side by side in the middle, so sections keep about a label's width apart.
    .force("collide", forceCollide<Node>(node => node.r + (node.section ? 34 : 28)).iterations(3))
    .force("x", forceX<Node>(node => anchors.get(node.area)![0]).strength(node => node.section ? 0.14 : 0.22))
    .force("y", forceY<Node>(node => anchors.get(node.area)![1]).strength(node => node.section ? 0.18 : 0.22))
    // Different areas keep their blobs apart, however many documents they hold.
    .force("separate", () => {
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!, b = nodes[j]!;
        if (a.area === b.area) continue;
        const dx = b.x! - a.x!, dy = b.y! - a.y!, distance = Math.hypot(dx, dy) || 1;
        const reach = pad(a) + pad(b) + 34;
        if (distance >= reach) continue;
        const push = (reach - distance) / distance * 0.4;
        a.vx! -= dx * push; a.vy! -= dy * push; b.vx! += dx * push; b.vy! += dy * push;
      }
    })
    .stop();
  for (let tick = 0; tick < 600; tick++) {
    simulation.tick();
    for (const node of nodes) {
      node.x = Math.max(70, Math.min(WIDTH - 70, node.x!));
      // The bottom margin leaves room for labels and an area name below them.
      node.y = Math.max(50, Math.min(height - 64, node.y!));
    }
  }
  // Each member adds two deterministic satellites, so a blob's edge is soft rather than a ring of circles.
  // Labels go on the outer side of an area, away from the sections in the middle.
  const cluster = (members: Node[], seed: string, width: number, below = false) => {
    const cx = members.reduce((sum, node) => sum + node.x!, 0) / members.length;
    const cy = members.reduce((sum, node) => sum + node.y!, 0) / members.length;
    const blobs = members.flatMap((node, index) => {
      const next = seededRandom(`${seed}:${index}`);
      const size = pad(node);
      const circles = [[node.x!, node.y!, size]];
      for (let satellite = 0; satellite < 2; satellite++) {
        const angle = next() * Math.PI * 2, distance = size * (0.35 + next() * 0.25);
        circles.push([node.x! + Math.cos(angle) * distance, node.y! + Math.sin(angle) * distance, size * (0.55 + next() * 0.15)]);
      }
      // Halfway toward the middle of the area, so a ring of members does not leave a hole.
      if (members.length > 2) circles.push([(node.x! + cx) / 2, (node.y! + cy) / 2, size * 0.9]);
      return circles.map(circle => circle.map(round));
    });
    // The label leans with the blob's edge: a chord across the edge under the label, moved out
    // until no part of the blob rises above it.
    const left = Math.min(...blobs.map(([x, , r]) => x! - r!)), right = Math.max(...blobs.map(([x, , r]) => x! + r!));
    const half = Math.max(4, Math.min(width / 2, (right - left) / 2 - 6));
    const x0 = Math.max(left + half + 6, Math.min(right - half - 6, members.reduce((sum, node) => sum + node.x!, 0) / members.length));
    const middle = contour(blobs, x0, below)!;
    const y1 = contour(blobs, x0 - half, below) ?? middle, y2 = contour(blobs, x0 + half, below) ?? middle;
    const tilt = Math.max(-0.5, Math.min(0.5, Math.atan2(y2 - y1, 2 * half)));
    const chord = (x: number) => y1 + (x - x0 + half) * Math.tan(tilt);
    let gap = 0;
    for (let step = 0; step <= 8; step++) {
      const x = x0 - half + step * half / 4;
      const y = contour(blobs, x, below);
      if (y !== undefined) gap = Math.max(gap, below ? y - chord(x) : chord(x) - y);
    }
    // Below a blob, the name also clears the members' own labels (up to two lines under each node).
    const labels = Math.max(...members.filter(node => Math.abs(node.x! - x0) < half + 40).map(node => node.y! + node.r + 48), -Infinity);
    const ly = below ? Math.max(chord(x0) + gap + 15, labels) : chord(x0) - gap - 6;
    return { blobs, lx: round(x0), ly: round(ly), la: round(tilt * 180 / Math.PI), below };
  };
  const groups = [{ members: nodes.slice(0, sections.length), seed: "sections", width: widths.sections, below: false },
    ...areaKeys.map((key, area) => ({ members: nodes.filter(node => node.area === area), seed: key, width: widths.areas[area]!,
      below: anchors.get(area)![1] > center[1] + 1 }))];
  const clusters = groups.map(group => cluster(group.members, group.seed, group.width, group.below));
  // A name that would sit on another blob moves to the other side of its own blob when that side is clear.
  const covered = (index: number, item: ReturnType<typeof cluster>) => clusters.some((other, at) => at !== index &&
    // The blur melts circles together, so a blob reaches well past its circles.
    [-0.5, -0.25, 0, 0.25, 0.5].some(offset => other.blobs.some(([x, y, r]) =>
      Math.hypot(item.lx + offset * groups[index]!.width - x!, item.ly - 5 - y!) < r! + 24)));
  clusters.forEach((item, index) => {
    if (!covered(index, item)) return;
    const flipped = cluster(groups[index]!.members, groups[index]!.seed, groups[index]!.width, !groups[index]!.below);
    if (!covered(index, flipped)) clusters[index] = flipped;
  });
  // Fit the drawing's height to what was drawn: blobs, node labels and area names.
  const top = Math.min(...clusters.flatMap(item => [...item.blobs.map(([, y, r]) => y! - r!), item.below ? Infinity : item.ly - 14]));
  const bottom = Math.max(...clusters.flatMap(item => [...item.blobs.map(([, y, r]) => y! + r!), item.below ? item.ly + 6 : -Infinity]),
    ...nodes.map(node => node.y! + node.r + 40));
  const shift = 16 - top;
  for (const node of nodes) node.y! += shift;
  const placed = clusters.map(({ below: _below, ...item }) => ({ ...item, ly: round(item.ly + shift),
    blobs: item.blobs.map(([x, y, r]) => [x!, round(y! + shift), r!]) }));
  return { height: Math.round(bottom - top + 32), nodes, sectionArea: placed[0]!, areas: placed.slice(1) };
}

/** Source maps for every delivered article with recorded references, keyed by article id. */
export function createSiteSourceMaps(input: { articles: readonly SiteSourceMapArticle[]; registry: SourcesRegistry;
  /** Titles read from committed Lark snapshots and notes, by `siteDocumentKey`; others are titled by path. */
  titles: ReadonlyMap<string, string>; repositoryRemote?: string }): Map<string, SiteSourceMap> {
  const located = input.articles.map(entry => ({ entry, documents: locate(entry, input.registry, input.titles, input.repositoryRemote) }));
  const citing = new Map<string, number[]>();
  located.forEach(({ documents }, index) => documents.forEach(document => citing.set(document.key, [...citing.get(document.key) ?? [], index])));
  const maps = new Map<string, SiteSourceMap>();
  located.forEach(({ entry, documents }, articleIndex) => {
    if (!documents.length) return;
    const grouping = areasOf(documents);
    const areaKeys = [...new Set(documents.map(grouping.key))];
    const areaOf = documents.map(document => areaKeys.indexOf(grouping.key(document)));
    // An area takes the colour of the type most of its documents have.
    const areaType = (area: number): SourceType => {
      const counts = new Map<SourceType, number>();
      documents.forEach((document, index) => { if (areaOf[index] === area) counts.set(sourceType(document), (counts.get(sourceType(document)) ?? 0) + 1); });
      return [...counts].sort((left, right) => right[1] - left[1])[0]![0];
    };
    const labels = areaKeys.map((_, area): SiteMapText => {
      const first = documents[areaOf.indexOf(area)]!;
      const directory = first.directory.slice(0, grouping.depth).join("/");
      // The innermost directory that says more than the module name.
      return first.kind === "repo" ? `${first.owner}${directory ? ` · ${directory.split("/").reverse().find(part => part !== first.owner) ?? directory}` : ""}`
        : first.kind === "other" ? first.owner : { ...KIND_LABELS[first.kind] };
    });
    const placed = layout(entry, documents, areaKeys, areaOf, { sections: labelWidth(SECTIONS_LABEL), areas: labels.map(labelWidth) });
    const areas = areaKeys.map((_, area): SiteSourceMapArea => {
      const first = documents[areaOf.indexOf(area)]!;
      return { kind: first.kind, ...placed.areas[area]!, label: labels[area]!,
        color: TYPE_COLORS[areaType(area)] };
    });
    const sharing = new Map<number, number[]>();
    documents.forEach((document, index) => citing.get(document.key)!.forEach(other => {
      if (other !== articleIndex) sharing.set(other, [...sharing.get(other) ?? [], index]);
    }));
    const sections = entry.article.sections;
    const rooms = labelRoom(placed.nodes.map(node => ({ x: node.x!, y: node.y! })));
    maps.set(entry.article.article_id, {
      w: WIDTH, h: placed.height,
      sections: sections.map((section, index) => ({ id: section.id, titles: entry.sectionTitles[section.id] ?? {},
        x: round(placed.nodes[index]!.x!), y: round(placed.nodes[index]!.y!), ...rooms[index]! })),
      sectionArea: placed.sectionArea, areas,
      docs: documents.map((document, index) => {
        const node = placed.nodes[sections.length + index]!;
        return { title: document.title, path: document.path, area: areaOf[index]!, x: round(node.x!), y: round(node.y!), r: round(node.r),
          ...rooms[sections.length + index]!, refs: document.refs };
      }),
      others: [...sharing].sort(([left, a], [right, b]) => b.length - a.length || left - right).slice(0, 50)
        .map(([other, docs]) => ({ titles: input.articles[other]!.titles, href: input.articles[other]!.href, docs })),
    });
  });
  return maps;
}
