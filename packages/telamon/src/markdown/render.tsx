import { Fragment, useMemo, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime, type Components } from 'hast-util-to-jsx-runtime';
import type { Element } from 'hast';
import { classifyHref } from '../bundle/paths.js';
import type { OkfDoc } from '../bundle/types.js';
import { Link } from '../router/context.js';
import { useCurrentDoc, useOkfBundle, useOkfConfig } from '../components/context.js';
import { toText } from './pipeline.js';

type NodeProp = { node?: Element };

function MarkdownLink({ node, href, children, ...rest }: ComponentPropsWithoutRef<'a'> & NodeProp) {
  void node;
  const doc = useCurrentDoc();
  const bundle = useOkfBundle();
  const { resolveAssetUrl } = useOkfConfig();
  const resolved = classifyHref(href ?? '', doc?.dir ?? '');

  if (resolved.kind === 'document' && resolved.route && resolved.path) {
    if (!bundle.byPath.has(resolved.path)) {
      // SPEC §11 forbids rejecting a bundle over a broken link, so it renders
      // inert and visibly marked rather than as a link to nowhere.
      return (
        <span
          {...rest}
          className="okf-link okf-link--broken"
          title={`"${href}" does not resolve inside this bundle.`}
        >
          {children}
        </span>
      );
    }
    const to = resolved.fragment ? `${resolved.route}#${resolved.fragment}` : resolved.route;
    return (
      <Link {...rest} to={to} className="okf-link">
        {children}
      </Link>
    );
  }

  if (resolved.kind === 'external') {
    return (
      <a
        {...rest}
        href={href}
        className="okf-link okf-link--external"
        target="_blank"
        rel="noreferrer noopener"
      >
        {children}
      </a>
    );
  }

  if (resolved.kind === 'asset' && resolved.path) {
    return (
      <a {...rest} href={resolveAssetUrl?.(resolved.path) ?? href} className="okf-link okf-link--asset">
        {children}
      </a>
    );
  }

  return (
    <a {...rest} href={href} className="okf-link">
      {children}
    </a>
  );
}

function MarkdownImage({ node, src, ...rest }: ComponentPropsWithoutRef<'img'> & NodeProp) {
  void node;
  const doc = useCurrentDoc();
  const { resolveAssetUrl } = useOkfConfig();
  const resolved = classifyHref(typeof src === 'string' ? src : '', doc?.dir ?? '');
  const resolvedSrc =
    resolved.kind === 'asset' && resolved.path ? (resolveAssetUrl?.(resolved.path) ?? src) : src;
  return <img {...rest} src={resolvedSrc} className="okf-image" />;
}

const LANGUAGE = /(?:^|\s)language-([^\s]+)/;

function MarkdownCode({
  node,
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<'code'> & NodeProp) {
  const { highlightCode } = useOkfConfig();
  const language = className ? (LANGUAGE.exec(className)?.[1] ?? undefined) : undefined;

  // Only fenced blocks carry a `language-*` class; inline code stays untouched.
  if (language && highlightCode && node) {
    return (
      <code {...rest} className={className}>
        {highlightCode(toText(node), language)}
      </code>
    );
  }
  return (
    <code {...rest} className={className}>
      {children}
    </code>
  );
}

function MarkdownTable({ node, ...rest }: ComponentPropsWithoutRef<'table'> & NodeProp) {
  void node;
  // Schema tables are wide; they scroll inside their own box rather than
  // forcing the page to scroll sideways.
  return (
    <div className="okf-table-scroll" tabIndex={0} role="region" aria-label="Table">
      <table {...rest} className="okf-table" />
    </div>
  );
}

function heading(tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  const Tag = tag;
  return function MarkdownHeading({
    node,
    children,
    id,
    ...rest
  }: ComponentPropsWithoutRef<'h1'> & NodeProp) {
    void node;
    return (
      <Tag {...rest} id={id} className="okf-heading">
        {children}
        {id ? (
          <a className="okf-heading-anchor" href={`#${id}`} aria-label="Permalink to this section">
            #
          </a>
        ) : null}
      </Tag>
    );
  };
}

const DEFAULT_COMPONENTS: Partial<Components> = {
  a: MarkdownLink,
  img: MarkdownImage,
  code: MarkdownCode,
  table: MarkdownTable,
  h1: heading('h1'),
  h2: heading('h2'),
  h3: heading('h3'),
  h4: heading('h4'),
  h5: heading('h5'),
  h6: heading('h6'),
};

export function useMarkdownComponents(): Partial<Components> {
  const { markdownComponents } = useOkfConfig();
  return useMemo(
    () => ({ ...DEFAULT_COMPONENTS, ...markdownComponents }),
    [markdownComponents],
  );
}

/**
 * Render a document body.
 *
 * The hast was built once at parse time; this only turns it into React
 * elements, so re-renders never re-parse markdown.
 */
export function Markdown({ doc }: { doc: OkfDoc }): ReactNode {
  const components = useMarkdownComponents();
  return useMemo(
    () => toJsxRuntime(doc.hast, { Fragment, jsx, jsxs, components, passNode: true }),
    [doc.hast, components],
  );
}
