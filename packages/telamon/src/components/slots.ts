import type { ComponentType, ReactNode } from 'react';
import type { Components as HastComponents } from 'hast-util-to-jsx-runtime';
import type { ConceptDoc, NavNode, OkfDoc } from '../bundle/types.js';

/** Element-level overrides for rendered markdown (`h2`, `table`, `code`, ...). */
export type MarkdownComponents = Partial<HastComponents>;

export interface HeaderProps {
  title: string;
}

export interface SidebarProps {
  nodes: NavNode[];
}

export interface BreadcrumbsProps {
  route: string;
}

export interface ConceptChromeProps {
  doc: ConceptDoc;
}

export interface DocChromeProps {
  doc: OkfDoc;
}

export interface BacklinksProps {
  route: string;
}

export interface NotFoundProps {
  route: string;
}

/**
 * Whole regions of the page, each replaceable. Overriding a slot replaces that
 * region entirely; use `classNames` instead when the default markup is fine and
 * only the styling hooks need to change.
 */
export interface OkfSlots {
  Header: ComponentType<HeaderProps>;
  Sidebar: ComponentType<SidebarProps>;
  Breadcrumbs: ComponentType<BreadcrumbsProps>;
  ConceptHeader: ComponentType<ConceptChromeProps>;
  SourcesList: ComponentType<ConceptChromeProps>;
  Relationships: ComponentType<ConceptChromeProps>;
  Toc: ComponentType<DocChromeProps>;
  Backlinks: ComponentType<BacklinksProps>;
  SearchBox: ComponentType<Record<string, never>>;
  Download: ComponentType<Record<string, never>>;
  NotFound: ComponentType<NotFoundProps>;
  Footer: ComponentType<Record<string, never>>;
}

/**
 * Named styling hooks. Every one of these also carries a default `okf-*` class,
 * so supplying a value here adds to the default rather than replacing it —
 * which is what makes a utility-class framework workable on top of the
 * token-driven defaults.
 */
export type OkfSlotName =
  | 'root'
  | 'header'
  | 'headerTitle'
  | 'download'
  | 'sidebar'
  | 'nav'
  | 'navLink'
  | 'body'
  | 'main'
  | 'article'
  | 'breadcrumbs'
  | 'conceptHeader'
  | 'metaRow'
  | 'toc'
  | 'backlinks'
  | 'relationships'
  | 'sources'
  | 'search'
  | 'searchResults'
  | 'referencesToggle'
  | 'graph'
  | 'footer';

/** Every slot filled in: consumer overrides merged over the defaults. */
export type ResolvedSlots = Required<OkfSlots>;

export interface OkfFeatures {
  search?: boolean;
  graph?: boolean;
  backlinks?: boolean;
  toc?: boolean;
  /** Offer the control that hides provenance-only reference concepts. */
  referenceToggle?: boolean;
  /** Offer the button that downloads the bundle's source files as a ZIP. */
  download?: boolean;
}

export interface OkfConfig {
  title: string;
  features: Required<OkfFeatures>;
  classNames: Partial<Record<OkfSlotName, string>>;
  slots: ResolvedSlots;
  markdownComponents: MarkdownComponents;
  /** Render a fenced code block. Without one, code renders as plain `<pre><code>`. */
  highlightCode?: (code: string, language: string | undefined) => ReactNode;
  /** Map a bundle-relative asset path (an image, a `viz.html`) to a real URL. */
  resolveAssetUrl?: (bundlePath: string) => string;
  /** Clock used for staleness checks, injectable so tests and demos are deterministic. */
  now: Date;
  /** Route the concept graph is mounted at. */
  graphRoute: string;
  /** Colour for a concept `type` in the graph; falls back to a generated hue. */
  typeColor?: (type: string) => string | undefined;
}

/** Join a default `okf-*` class with any consumer-supplied class for the same slot. */
export function cx(...values: (string | false | undefined | null)[]): string {
  return values.filter(Boolean).join(' ');
}
