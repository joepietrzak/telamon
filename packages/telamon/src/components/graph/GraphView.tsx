import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Bundle } from '../../bundle/types.js';
import { Link, useNavigate, useRoute, useRouter } from '../../router/context.js';
import { useClassName, useOkfBundle, useOkfConfig } from '../context.js';
import {
  INITIAL_VIEW,
  VIEWPORT_CLASS,
  isPan,
  panned,
  viewTransform,
  zoomed,
  type View,
} from './viewport.js';

interface SimNode extends SimulationNodeDatum {
  route: string;
  label: string;
  type?: string;
  degree: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  /** Relationship type, for typed edges declared in frontmatter. */
  type?: string;
  directed: boolean;
  /** Position among the edges sharing this node pair, so parallel edges fan out. */
  parallel: number;
  parallelCount: number;
}

const WIDTH = 900;
const HEIGHT = 620;
/** Ticks run to completion up front: a settled static layout beats an animated one here. */
const TICKS = 320;
const PALETTE_SIZE = 8;
/** Perpendicular offset between edges joining the same pair of nodes. */
const PARALLEL_SPREAD = 26;
/** Stable index into the palette so a given concept type keeps its colour across renders. */
function paletteIndex(type: string): number {
  let hash = 0;
  for (let i = 0; i < type.length; i += 1) hash = (hash * 31 + type.charCodeAt(i)) | 0;
  return Math.abs(hash) % PALETTE_SIZE;
}

function radiusOf(node: SimNode): number {
  return 6 + Math.min(10, Math.sqrt(node.degree) * 3);
}

function layout(graph: Bundle['graph']): { nodes: SimNode[]; links: SimLink[] } {
  const nodes: SimNode[] = graph.nodes.map((node) => ({
    route: node.route,
    label: node.label,
    ...(node.type && { type: node.type }),
    degree: node.degree,
  }));

  const byRoute = new Map(nodes.map((node) => [node.route, node]));
  const seen = new Set<string>();
  const links: SimLink[] = [];

  for (const edge of graph.edges) {
    // An untyped body link says only "these are connected", so reciprocal pairs
    // collapse into one line. A typed relationship names a direction, so
    // `A depends_on B` and `B depends_on A` are two distinct edges.
    const key = edge.directed
      ? `${edge.source}\u0000${edge.target}\u0000${edge.type ?? ''}`
      : [edge.source, edge.target].sort().join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);

    const source = byRoute.get(edge.source);
    const target = byRoute.get(edge.target);
    if (!source || !target) continue;
    links.push({
      source,
      target,
      ...(edge.type && { type: edge.type }),
      directed: edge.directed,
      parallel: 0,
      parallelCount: 1,
    });
  }

  // Fan out edges that join the same pair, so they do not draw on top of
  // each other and their labels stay readable.
  const groups = new Map<string, SimLink[]>();
  for (const link of links) {
    const pair = [(link.source as SimNode).route, (link.target as SimNode).route]
      .sort()
      .join('\u0000');
    const group = groups.get(pair);
    if (group) group.push(link);
    else groups.set(pair, [link]);
  }
  for (const group of groups.values()) {
    group.forEach((link, index) => {
      link.parallel = index;
      link.parallelCount = group.length;
    });
  }

  const simulation = forceSimulation(nodes)
    .force('link', forceLink<SimNode, SimLink>(links).distance(70).strength(0.6))
    .force('charge', forceManyBody().strength(-220))
    .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
    .force(
      'collide',
      forceCollide<SimNode>().radius((node) => radiusOf(node) + 12),
    )
    .stop();
  simulation.tick(TICKS);

  return { nodes, links };
}

/**
 * Settled layouts, keyed by the graph they were built from.
 *
 * The simulation is the expensive part -- hundreds of ticks over every node,
 * seconds of it on a large bundle -- and it is deterministic, so the result is
 * worth keeping. `useMemo` covers re-renders within one mount, which is all a
 * browser needs; a server renders a fresh tree per request and would otherwise
 * pay the whole cost again on every visit to the graph.
 *
 * Keyed weakly on `bundle.graph`, which is built once per parse, so re-reading
 * the source drops the old layout along with the old bundle. Mirrors how
 * `getSearchIndex` caches the other expensive derived structure.
 *
 * Safe to share: `layout` finishes mutating its nodes and links before it
 * returns, and nothing downstream writes to them.
 */
const LAYOUTS = new WeakMap<Bundle['graph'], { nodes: SimNode[]; links: SimLink[] }>();

function settledLayout(graph: Bundle['graph']): { nodes: SimNode[]; links: SimLink[] } {
  let settled = LAYOUTS.get(graph);
  if (!settled) {
    settled = layout(graph);
    LAYOUTS.set(graph, settled);
  }
  return settled;
}

interface EdgeGeometry {
  d: string;
  labelX: number;
  labelY: number;
}

/**
 * Path for one edge, trimmed to stop at each node's rim so an arrowhead is not
 * buried under the target circle, and bowed aside when edges run in parallel.
 */
function edgeGeometry(link: SimLink): EdgeGeometry {
  const source = link.source as SimNode;
  const target = link.target as SimNode;
  const sx = source.x ?? 0;
  const sy = source.y ?? 0;
  const tx = target.x ?? 0;
  const ty = target.y ?? 0;

  const length = Math.hypot(tx - sx, ty - sy) || 1;
  const ux = (tx - sx) / length;
  const uy = (ty - sy) / length;

  const x1 = sx + ux * (radiusOf(source) + 2);
  const y1 = sy + uy * (radiusOf(source) + 2);
  const x2 = tx - ux * (radiusOf(target) + (link.directed ? 9 : 2));
  const y2 = ty - uy * (radiusOf(target) + (link.directed ? 9 : 2));

  const offset =
    link.parallelCount > 1
      ? (link.parallel - (link.parallelCount - 1) / 2) * PARALLEL_SPREAD
      : 0;

  if (offset === 0) {
    return { d: `M ${x1} ${y1} L ${x2} ${y2}`, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 };
  }

  // Quadratic control point pushed along the perpendicular; the curve's
  // midpoint sits half way to it, which is where the label goes.
  const cx = (x1 + x2) / 2 - uy * offset;
  const cy = (y1 + y2) / 2 + ux * offset;
  return {
    d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
    labelX: 0.25 * x1 + 0.5 * cx + 0.25 * x2,
    labelY: 0.25 * y1 + 0.5 * cy + 0.25 * y2,
  };
}

/**
 * A force-directed view of the bundle's cross-links.
 *
 * Loaded lazily by the router so `d3-force` never lands in the main chunk. Pan
 * and zoom are hand-rolled on an SVG transform rather than pulling in `d3-zoom`
 * for two gestures.
 */
export default function GraphView() {
  const bundle = useOkfBundle();
  const { typeColor } = useOkfConfig();
  const className = useClassName('graph');
  const { route } = useRoute();
  const navigate = useNavigate();
  const router = useRouter();

  const markerPrefix = useId().replace(/:/g, '');
  const { nodes, links } = useMemo(() => settledLayout(bundle.graph), [bundle.graph]);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  // Whether the gestures below are actually wired up. False through the server
  // render, and false forever on a served page that React never takes over --
  // there the enhancement script sets the class instead. Deliberately an
  // effect rather than a `typeof window` check, which is true during
  // `renderToString` under jsdom and mismatches on hydration.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [hovered, setHovered] = useState<string | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    panning: boolean;
  } | null>(null);
  /** True once a press has travelled far enough to pan, so the click it ends with is ignored. */
  const draggedRef = useRef(false);

  const colorFor = (type: string | undefined) => {
    if (!type) return 'var(--okf-graph-node-default, currentColor)';
    return typeColor?.(type) ?? `var(--okf-graph-node-${paletteIndex(type)})`;
  };

  return (
    <section className={className} aria-labelledby="okf-graph-heading">
      <header className="okf-graph-header">
        <h1 id="okf-graph-heading" className="okf-title">
          Concept graph
        </h1>
        <p className="okf-description">
          {nodes.length} concepts, {links.length} cross-links. Drag to pan, scroll to zoom, click a
          node to open it.
        </p>
      </header>

      <svg
        className={`okf-graph-canvas${interactive ? ' okf-graph-canvas--interactive' : ''}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        // Not role="img": that would collapse the graph into a single opaque
        // image and hide the focusable nodes inside it.
        role="group"
        aria-label="Force-directed graph of concepts and the links between them"
        onPointerDown={(event) => {
          // Deliberately no setPointerCapture here. Capturing on press retargets
          // the click that follows to this <svg>, so a node's own click handler
          // never runs -- capture is taken below, only once a pan really starts.
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
            panning: false,
          };
          draggedRef.current = false;
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;

          if (!drag.panning) {
            if (!isPan(event.clientX - drag.startX, event.clientY - drag.startY)) return;
            drag.panning = true;
            draggedRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }

          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          // `panned` guards the transform; this guards the origin. Recording a
          // coordinate-less event as the new origin makes every later delta
          // NaN, and the pan is stuck for the rest of the gesture.
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
          drag.x = event.clientX;
          drag.y = event.clientY;
          setView((current) => panned(current, dx, dy));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId !== event.pointerId) return;
          if (drag.panning && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onWheel={(event) => {
          setView((current) => zoomed(current, event.deltaY));
        }}
      >
        <defs>
          {['arrow', 'arrow-active'].map((name) => (
            <marker
              key={name}
              id={`${markerPrefix}-${name}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className={`okf-graph-${name}`} />
            </marker>
          ))}
        </defs>

        <g className={VIEWPORT_CLASS} transform={viewTransform(view)}>
          {links.map((link, index) => {
            const source = link.source as SimNode;
            const target = link.target as SimNode;
            const touchesHover =
              hovered !== null && (source.route === hovered || target.route === hovered);
            const { d, labelX, labelY } = edgeGeometry(link);
            const marker = touchesHover ? 'arrow-active' : 'arrow';

            return (
              <g key={index} className="okf-graph-edge-group">
                <path
                  className={[
                    'okf-graph-edge',
                    link.directed && 'okf-graph-edge--typed',
                    touchesHover && 'okf-graph-edge--active',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  d={d}
                  fill="none"
                  markerEnd={link.directed ? `url(#${markerPrefix}-${marker})` : undefined}
                />
                {link.type ? (
                  <text
                    className={`okf-graph-edge-label${
                      touchesHover ? ' okf-graph-edge-label--active' : ''
                    }`}
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    dy="-3"
                  >
                    {link.type}
                  </text>
                ) : null}
              </g>
            );
          })}
          {nodes.map((node) => {
            const isCurrent = node.route === route;
            return (
              // A real link rather than a `role="button"`: an anchor is
              // focusable, activates on Enter, opens in a new tab on a
              // modified click, and -- the reason it matters here -- still
              // navigates on a page that was rendered by a server and has no
              // JavaScript behind it. A button that only works once React
              // arrives advertises something it cannot do.
              <a
                key={node.route}
                className={`okf-graph-node${isCurrent ? ' okf-graph-node--current' : ''}`}
                href={router.createHref(node.route)}
                aria-label={node.type ? `${node.label}, ${node.type}` : node.label}
                {...(isCurrent && { 'aria-current': 'page' as const })}
                onMouseEnter={() => setHovered(node.route)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.route)}
                onBlur={() => setHovered(null)}
                onClick={(event) => {
                  // Leave the browser to handle anything that is not a plain
                  // left click: open in a new tab, a new window, a download.
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  // The click that ends a pan is not a click on the node.
                  if (draggedRef.current) return;
                  navigate(node.route);
                }}
              >
                {/* The transform lives on a group inside: React types `a` as
                    an HTML anchor, which has no transform, and nesting is the
                    better-supported SVG shape anyway. */}
                <g transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}>
                  <circle r={radiusOf(node)} fill={colorFor(node.type)} />
                  <text className="okf-graph-label" x={radiusOf(node) + 5} y={4}>
                    {node.label}
                  </text>
                  <title>{node.type ? `${node.label} - ${node.type}` : node.label}</title>
                </g>
              </a>
            );
          })}
        </g>
      </svg>

      {/* The graph is a picture; this is the same information as navigable text. */}
      <section className="okf-graph-list" aria-labelledby="okf-graph-list-heading">
        <h2 id="okf-graph-list-heading" className="okf-section-heading">
          All concepts
        </h2>
        <ul className="okf-listing">
          {[...nodes]
            .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
            .map((node) => (
              <li key={node.route} className="okf-listing-item">
                <Link to={node.route} className="okf-link">
                  {node.label}
                </Link>
                {node.type ? <span className="okf-badge okf-badge--type">{node.type}</span> : null}
                <span className="okf-listing-description">
                  {node.degree} {node.degree === 1 ? 'link' : 'links'}
                </span>
              </li>
            ))}
        </ul>
      </section>
    </section>
  );
}
