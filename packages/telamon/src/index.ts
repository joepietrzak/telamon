// Bundle model
export type {
  Actor,
  ActorKind,
  Attestation,
  Bundle,
  BundleDiagnostic,
  ConceptDoc,
  DiagnosticCode,
  DocKind,
  DocLink,
  DocRef,
  GraphEdge,
  GraphNode,
  Heading,
  IndexDoc,
  IndexEntry,
  LogDoc,
  NavNode,
  NavNodeKind,
  OkfDoc,
  OkfFrontmatter,
  OkfSourceRef,
  Relationship,
  OkfStatus,
  TrustTier,
  UsageWindow,
} from './bundle/types.js';

export { SUPPORTED_OKF_MAJOR, isBundle, parseBundle, type ParseOptions } from './bundle/parse.js';
export {
  diffFiles,
  updateBundle,
  type BundleChanges,
} from './bundle/update.js';

export {
  emptyFrontmatter,
  formatActor,
  isStale,
  normalizeVerified,
  parseActor,
  parseFrontmatter,
  splitFrontmatter,
  trustTierOf,
} from './bundle/frontmatter.js';

export {
  classifyHref,
  dirOf,
  filePathToRoute,
  hrefToRoute,
  normalizeBasename,
  normalizeFilePath,
  normalizeRoute,
  parentRoute,
  reservedKindOf,
  routeToHref,
  type HrefKind,
  type ResolvedHref,
} from './bundle/paths.js';

export { breadcrumbTrail, buildNavTree, humanize } from './bundle/tree.js';
export {
  RELATIONSHIPS_KEY,
  readRawRelationships,
  resolveRelationships,
} from './bundle/relationships.js';
export {
  REFERENCE_DIRECTORY,
  filterNavTree,
  isReferenceDoc,
  referenceRoutes,
} from './bundle/references.js';
export { collectLinks, parseIndexEntries } from './bundle/links.js';
export { archiveFileName, zipFiles, type ZipOptions } from './bundle/archive.js';

export {
  buildSearchIndex,
  getSearchIndex,
  tokenize,
  type SearchHighlight,
  type SearchIndex,
  type SearchResult,
  type SearchSnippet,
} from './bundle/search.js';

// Markdown
export {
  collectHeadings,
  createProcessor,
  firstHeadingText,
  markdownToHast,
  toText,
  type MarkdownProcessor,
  type PipelineOptions,
} from './markdown/pipeline.js';
export { Markdown, useMarkdownComponents } from './markdown/render.js';

// Routing
export { createHistoryRouter, type HistoryRouterOptions } from './router/history.js';
export { createMemoryRouter, type MemoryRouter } from './router/memory.js';
export { splitRoute, type NavigateOptions, type RouteTarget, type RouterAdapter } from './router/types.js';
export {
  Link,
  RouterProvider,
  useNavigate,
  useRoute,
  useRouter,
  type LinkProps,
} from './router/context.js';

// Site
export { OkfProvider, OkfSite, type OkfProviderProps, type OkfSiteProps } from './components/OkfSite.js';
export { OkfRoutes } from './components/OkfRoutes.js';
export { Layout } from './components/Layout.js';
export {
  ConceptPage,
  DirectoryPage,
  IndexPage,
  LogPage,
  NotFound,
} from './components/pages.js';
export { NavTree } from './components/NavTree.js';
export { Header } from './components/Header.js';
export { DEFAULT_SLOTS } from './components/defaults.js';
export { Breadcrumbs } from './components/Breadcrumbs.js';
export { Toc } from './components/Toc.js';
export { Backlinks } from './components/Backlinks.js';
export { Relationships, formatRelationshipType } from './components/Relationships.js';
export { ReferencesToggle } from './components/ReferencesToggle.js';
export { SearchBox } from './components/search/SearchBox.js';
export { DownloadButton } from './components/DownloadButton.js';
export { SearchResults, type SearchResultsProps } from './components/search/SearchResults.js';

export {
  ConceptFooter,
  ConceptHeader,
  GeneratedLine,
  SourcesList,
  StaleBanner,
  StatusBanner,
  Tags,
  TrustBadge,
  TypeBadge,
  UsageWindowLine,
  formatDate,
} from './components/metadata.js';

export {
  DocProvider,
  OkfContextProvider,
  useBacklinks,
  useClassName,
  useCurrentDoc,
  useDoc,
  useNavTree,
  useOkfBundle,
  useOkfConfig,
  useReferences,
  useSearch,
  type ReferencesState,
  type UseSearchOptions,
} from './components/context.js';

export {
  cx,
  type BacklinksProps,
  type BreadcrumbsProps,
  type ConceptChromeProps,
  type DocChromeProps,
  type HeaderProps,
  type MarkdownComponents,
  type NotFoundProps,
  type OkfConfig,
  type OkfFeatures,
  type OkfSlotName,
  type OkfSlots,
  type ResolvedSlots,
  type SidebarProps,
} from './components/slots.js';
