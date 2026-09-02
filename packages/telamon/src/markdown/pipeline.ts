import { unified, type PluggableList, type Processor } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import { visit } from 'unist-util-visit';
import type { Element, Nodes, Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import type { Heading } from '../bundle/types.js';

export interface PipelineOptions {
  /**
   * Keep raw HTML blocks in the tree. Off by default, which drops them
   * entirely. Turning this on only makes raw nodes *available*; to render them
   * you must also supply `rehypePlugins: [rehypeRaw, rehypeSanitize]` yourself.
   * Those plugins are deliberately not a dependency of this library — they pull
   * in a full HTML parser, and most bundles are pure markdown.
   */
  allowHtml?: boolean;
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
}

export type MarkdownProcessor = Processor<MdastRoot, MdastRoot, HastRoot, undefined, undefined>;

/**
 * Build the shared markdown processor. One instance serves the whole bundle;
 * per-document work (link rewriting) happens as a separate tree pass so the
 * processor stays stateless and is not rebuilt for every file.
 */
export function createProcessor(options: PipelineOptions = {}): MarkdownProcessor {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(options.remarkPlugins ?? [])
    .use(remarkRehype, { allowDangerousHtml: options.allowHtml ?? false })
    .use(rehypeSlug)
    .use(options.rehypePlugins ?? []);
}

export function markdownToHast(processor: MarkdownProcessor, body: string): HastRoot {
  const mdast = processor.parse(body);
  return processor.runSync(mdast) as HastRoot;
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Plain-text content of a hast node, ignoring generated anchor decorations. */
export function toText(node: Nodes): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'comment' || node.type === 'doctype') return '';
  const children = 'children' in node ? node.children : [];
  return children.map((child) => toText(child)).join('');
}

export function collectHeadings(tree: HastRoot): Heading[] {
  const headings: Heading[] = [];
  visit(tree, 'element', (node: Element) => {
    if (!HEADING_TAGS.has(node.tagName)) return;
    const id = typeof node.properties?.id === 'string' ? node.properties.id : '';
    if (!id) return;
    headings.push({ id, depth: Number(node.tagName.slice(1)), text: toText(node).trim() });
  });
  return headings;
}

/** First heading in the document, used as a title fallback. */
export function firstHeadingText(tree: HastRoot): string | undefined {
  let found: string | undefined;
  visit(tree, 'element', (node: Element) => {
    if (found !== undefined || !HEADING_TAGS.has(node.tagName)) return;
    const text = toText(node).trim();
    if (text) found = text;
  });
  return found;
}
