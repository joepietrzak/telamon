import type { ReactNode } from 'react';
import { formatActor, isStale, trustTierOf } from '../bundle/frontmatter.js';
import type { ConceptDoc, OkfFrontmatter, OkfSourceRef, TrustTier } from '../bundle/types.js';
import { useClassName, useOkfConfig } from './context.js';

/**
 * Render an ISO-8601 value as `YYYY-MM-DD`.
 *
 * Deliberately locale-independent: a locale-formatted date renders differently
 * on the server and in the browser and breaks hydration. The full value stays
 * available in the `datetime` attribute.
 */
export function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString().slice(0, 10);
}

function DateText({ value }: { value: string }) {
  return <time dateTime={value}>{formatDate(value)}</time>;
}

export function TypeBadge({ type }: { type: string | undefined }) {
  if (!type) return null;
  return (
    <span className="okf-badge okf-badge--type" data-okf-type={type}>
      {type}
    </span>
  );
}

const TRUST_LABEL: Record<TrustTier, string> = {
  unverified: 'Unverified',
  'machine-confirmed': 'Machine confirmed',
  'human-reviewed': 'Human reviewed',
};

/** SPEC §5.3: the trust tier a consumer derives from `verified`. */
export function TrustBadge({ frontmatter }: { frontmatter: OkfFrontmatter }) {
  const tier = trustTierOf(frontmatter);
  const verifiers = frontmatter.verified
    .map((entry) => (entry.by ? formatActor(entry.by) : undefined))
    .filter(Boolean)
    .join(', ');
  return (
    <span
      className={`okf-badge okf-badge--trust okf-trust--${tier}`}
      title={verifiers ? `Verified by ${verifiers}` : 'No verification recorded'}
    >
      {TRUST_LABEL[tier]}
    </span>
  );
}

export function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="okf-tags">
      {tags.map((tag) => (
        <li key={tag} className="okf-tag">
          {tag}
        </li>
      ))}
    </ul>
  );
}

function Banner({ tone, children }: { tone: 'warning' | 'danger' | 'info'; children: ReactNode }) {
  return (
    <p className={`okf-banner okf-banner--${tone}`} role="note">
      {children}
    </p>
  );
}

/** SPEC §5.4. `stable` is the default and needs no banner. */
export function StatusBanner({ frontmatter }: { frontmatter: OkfFrontmatter }) {
  if (frontmatter.status === 'deprecated') {
    return <Banner tone="danger">This concept is deprecated.</Banner>;
  }
  if (frontmatter.status === 'draft') {
    return <Banner tone="warning">This concept is a draft and may change.</Banner>;
  }
  return null;
}

/** SPEC §5.5. */
export function StaleBanner({ frontmatter }: { frontmatter: OkfFrontmatter }) {
  const { now } = useOkfConfig();
  if (!isStale(frontmatter, now)) return null;
  return (
    <Banner tone="warning">
      This content was marked stale after <DateText value={frontmatter.staleAfter!} /> and may no
      longer be accurate.
    </Banner>
  );
}

/** SPEC §5.2. */
export function GeneratedLine({ frontmatter }: { frontmatter: OkfFrontmatter }) {
  const { generated } = frontmatter;
  if (!generated?.by && !generated?.at) return null;
  return (
    <p className="okf-generated">
      Generated
      {generated.by ? ` by ${formatActor(generated.by)}` : ''}
      {generated.at ? (
        <>
          {' on '}
          <DateText value={generated.at} />
        </>
      ) : null}
      .
    </p>
  );
}

export function UsageWindowLine({ frontmatter }: { frontmatter: OkfFrontmatter }) {
  const window = frontmatter.usageWindow;
  if (!window?.from && !window?.to) return null;
  return (
    <p className="okf-usage-window">
      Usage observed
      {window.from ? (
        <>
          {' from '}
          <DateText value={window.from} />
        </>
      ) : null}
      {window.to ? (
        <>
          {' to '}
          <DateText value={window.to} />
        </>
      ) : null}
      .
    </p>
  );
}

function SourceItem({ source }: { source: OkfSourceRef }) {
  const label = source.title ?? source.resource;
  const isUrl = /^https?:\/\//i.test(source.resource);
  return (
    <li className="okf-source" id={source.id ? `okf-source-${source.id}` : undefined}>
      {isUrl ? (
        <a className="okf-link okf-link--external" href={source.resource} target="_blank" rel="noreferrer noopener">
          {label}
        </a>
      ) : (
        <span className="okf-source-label">{label}</span>
      )}
      <span className="okf-source-meta">
        {source.author ? <span className="okf-source-author">{source.author}</span> : null}
        {source.lastModified ? <DateText value={source.lastModified} /> : null}
        {source.usageCount !== undefined ? (
          <span className="okf-source-usage">{source.usageCount} uses</span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * SPEC §5.1. The `sources` list is the frontmatter counterpart to the
 * `[^id]` footnotes in the body: entries carrying an `id` get one, so a
 * footnote reference and this list describe the same material.
 */
export function SourcesList({ doc }: { doc: ConceptDoc }) {
  const className = useClassName('sources');
  if (doc.frontmatter.sources.length === 0) return null;
  return (
    <section className={className} aria-labelledby="okf-sources-heading">
      <h2 id="okf-sources-heading" className="okf-section-heading">
        Sources
      </h2>
      <ul className="okf-source-list">
        {doc.frontmatter.sources.map((source, index) => (
          <SourceItem key={source.id ?? `${source.resource}-${index}`} source={source} />
        ))}
      </ul>
    </section>
  );
}

/** Title, description, and every frontmatter signal worth showing above the body. */
export function ConceptHeader({ doc }: { doc: ConceptDoc }) {
  const className = useClassName('conceptHeader');
  const metaRow = useClassName('metaRow');
  const { frontmatter } = doc;

  return (
    <header className={className}>
      <div className={metaRow}>
        <TypeBadge type={frontmatter.type} />
        <TrustBadge frontmatter={frontmatter} />
      </div>
      <h1 className="okf-title">{doc.title}</h1>
      {frontmatter.description ? (
        <p className="okf-description">{frontmatter.description}</p>
      ) : null}
      {frontmatter.resource ? (
        <p className="okf-resource">
          <span className="okf-resource-label">Resource</span>
          {/^https?:\/\//i.test(frontmatter.resource) ? (
            <a
              className="okf-link okf-link--external"
              href={frontmatter.resource}
              target="_blank"
              rel="noreferrer noopener"
            >
              {frontmatter.resource}
            </a>
          ) : (
            <code>{frontmatter.resource}</code>
          )}
        </p>
      ) : null}
      <Tags tags={frontmatter.tags} />
      <StatusBanner frontmatter={frontmatter} />
      <StaleBanner frontmatter={frontmatter} />
    </header>
  );
}

/** Provenance shown after the body, where it informs rather than interrupts. */
export function ConceptFooter({ doc }: { doc: ConceptDoc }) {
  return (
    <div className="okf-concept-footer">
      <GeneratedLine frontmatter={doc.frontmatter} />
      <UsageWindowLine frontmatter={doc.frontmatter} />
    </div>
  );
}
