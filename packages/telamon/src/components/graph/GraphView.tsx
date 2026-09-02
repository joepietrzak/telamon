import { useMemo, useRef, useState } from 'react';
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
import { Link, useNavigate, useRoute } from '../../router/context.js';
import { useClassName, useOkfBundle, useOkfConfig } from '../context.js';

interface SimNode extends SimulationNodeDatum {
  route: string;
  label: string;
  type?: string;
  degree: number;
}

type SimLink = SimulationLinkDatum<SimNode>;

const WIDTH = 900;
const HEIGHT = 620;
/** Ticks run to completion up front: a settled static layout beats an animated one here. */
const TICKS = 320;
const PALETTE_SIZE = 8;

/** Stable index into the palette so a given concept type keeps its colour across renders. */
function paletteIndex(type: string): number {
  let hash = 0;
  for (let i = 0; i < type.length; i += 1) hash = (hash * 31 + type.charCodeAt(i)) | 0;
  return Math.abs(hash) % PALETTE_SIZE;
}

function radiusOf(node: SimNode): number {
  return 6 + Math.min(10, Math.sqrt(node.degree) * 3);
}

function layout(bundle: Bundle): { nodes: SimNode[]; links: SimLink[] } {
  const nodes: SimNode[] = bundle.graph.nodes.map((node) => ({
    route: node.route,
    label: node.label,
    ...(node.type && { type: node.type }),
    degree: node.degree,
  }));

  const byRoute = new Map(nodes.map((node) => [node.route, node]));
  const seen = new Set<string>();
  const links: SimLink[] = [];
  for (const edge of bundle.graph.edges) {
    // The graph is undirected for layout purposes; collapse reciprocal pairs.
    const key = [edge.source, edge.target].sort().join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const source = byRoute.get(edge.source);
    const target = byRoute.get(edge.target);
    if (source && target) links.push({ source, target });
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

  const { nodes, links } = useMemo(() => layout(bundle), [bundle]);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

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
        className="okf-graph-canvas"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Force-directed graph of concepts and the links between them"
        onPointerDown={(event) => {
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          drag.x = event.clientX;
          drag.y = event.clientY;
          setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        }}
        onWheel={(event) => {
          const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
          setView((current) => ({
            ...current,
            scale: Math.min(4, Math.max(0.3, current.scale * factor)),
          }));
        }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {links.map((link, index) => {
            const source = link.source as SimNode;
            const target = link.target as SimNode;
            const touchesHover =
              hovered !== null && (source.route === hovered || target.route === hovered);
            return (
              <line
                key={index}
                className={`okf-graph-edge${touchesHover ? ' okf-graph-edge--active' : ''}`}
                x1={source.x ?? 0}
                y1={source.y ?? 0}
                x2={target.x ?? 0}
                y2={target.y ?? 0}
              />
            );
          })}
          {nodes.map((node) => {
            const isCurrent = node.route === route;
            return (
              <g
                key={node.route}
                className={`okf-graph-node${isCurrent ? ' okf-graph-node--current' : ''}`}
                transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
                onMouseEnter={() => setHovered(node.route)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => navigate(node.route)}
              >
                <circle r={radiusOf(node)} fill={colorFor(node.type)} />
                <text className="okf-graph-label" x={radiusOf(node) + 5} y={4}>
                  {node.label}
                </text>
                <title>{node.type ? `${node.label} - ${node.type}` : node.label}</title>
              </g>
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
