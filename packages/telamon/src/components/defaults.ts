import { Backlinks } from './Backlinks.js';
import { Breadcrumbs } from './Breadcrumbs.js';
import { Header } from './Header.js';
import { NavTree } from './NavTree.js';
import { Toc } from './Toc.js';
import { ConceptHeader, SourcesList } from './metadata.js';
import { NotFound } from './pages.js';
import { SearchBox } from './search/SearchBox.js';
import type { ResolvedSlots } from './slots.js';

/**
 * Every region's default implementation, resolved once so consumer overrides
 * can be merged in a single memoized object. Components then read
 * `config.slots.X` rather than picking a default mid-render, which keeps each
 * slot's identity stable across renders.
 */
export const DEFAULT_SLOTS: ResolvedSlots = {
  Header,
  Sidebar: NavTree,
  Breadcrumbs,
  ConceptHeader,
  SourcesList,
  Toc,
  Backlinks,
  SearchBox,
  NotFound,
  Footer: () => null,
};
