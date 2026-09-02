import { toText } from '../markdown/pipeline.js';
import type { Bundle, OkfDoc } from './types.js';

export interface SearchHighlight {
  start: number;
  end: number;
}

export interface SearchSnippet {
  text: string;
  highlights: SearchHighlight[];
}

export interface SearchResult {
  route: string;
  title: string;
  type?: string;
  description?: string;
  score: number;
  snippet?: SearchSnippet;
}

export interface SearchIndex {
  search(query: string, limit?: number): SearchResult[];
  /** Number of indexed documents, exposed for diagnostics and tests. */
  readonly size: number;
}

/**
 * Field weights. Titles and descriptions are what a reader is usually
 * reaching for; body text still matches, just less loudly. Code inside fenced
 * blocks is part of the body on purpose — in a data bundle, the SQL is often
 * the thing worth finding.
 */
const WEIGHTS = { title: 8, description: 4, tags: 4, type: 3, heading: 2, body: 1 } as const;

const TOKEN_PATTERN = /[a-z0-9_]+/g;

/** Lowercase, split on punctuation, and additionally index the parts of `snake_case` words. */
export function tokenize(value: string): string[] {
  const tokens: string[] = [];
  for (const match of value.toLowerCase().matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    tokens.push(token);
    if (token.includes('_')) {
      for (const part of token.split('_')) if (part.length > 1) tokens.push(part);
    }
  }
  return tokens;
}

interface IndexedDoc {
  route: string;
  title: string;
  type?: string;
  description?: string;
  text: string;
  lowerText: string;
}

const CACHE = new WeakMap<Bundle, SearchIndex>();

/** Build (and memoize per bundle) the client-side search index. */
export function getSearchIndex(bundle: Bundle): SearchIndex {
  let index = CACHE.get(bundle);
  if (!index) {
    index = buildSearchIndex(bundle);
    CACHE.set(bundle, index);
  }
  return index;
}

export function buildSearchIndex(bundle: Bundle): SearchIndex {
  const documents: IndexedDoc[] = [];
  const postings = new Map<string, Map<number, number>>();

  const add = (docId: number, value: string | undefined, weight: number) => {
    if (!value) return;
    for (const token of tokenize(value)) {
      let byDoc = postings.get(token);
      if (!byDoc) {
        byDoc = new Map();
        postings.set(token, byDoc);
      }
      byDoc.set(docId, (byDoc.get(docId) ?? 0) + weight);
    }
  };

  const indexable: OkfDoc[] = [...bundle.byRoute.values()];
  for (const doc of indexable) {
    const text = toText(doc.hast).replace(/\s+/g, ' ').trim();
    const docId = documents.length;
    documents.push({
      route: doc.route,
      title: doc.title,
      ...(doc.frontmatter.type && { type: doc.frontmatter.type }),
      ...(doc.frontmatter.description && { description: doc.frontmatter.description }),
      text,
      lowerText: text.toLowerCase(),
    });

    add(docId, doc.title, WEIGHTS.title);
    add(docId, doc.frontmatter.description, WEIGHTS.description);
    add(docId, doc.frontmatter.type, WEIGHTS.type);
    add(docId, doc.frontmatter.tags.join(' '), WEIGHTS.tags);
    add(docId, doc.headings.map((heading) => heading.text).join(' '), WEIGHTS.heading);
    add(docId, text, WEIGHTS.body);
  }

  /** Exact hits at full weight, prefix hits at half — so `purch` still finds `purchasers`. */
  const scoreToken = (token: string): Map<number, number> => {
    const scores = new Map<number, number>();
    const merge = (byDoc: Map<number, number>, factor: number) => {
      for (const [docId, weight] of byDoc) {
        scores.set(docId, Math.max(scores.get(docId) ?? 0, weight * factor));
      }
    };
    const exact = postings.get(token);
    if (exact) merge(exact, 1);
    if (token.length >= 2) {
      for (const [candidate, byDoc] of postings) {
        if (candidate !== token && candidate.startsWith(token)) merge(byDoc, 0.5);
      }
    }
    return scores;
  };

  const buildSnippet = (doc: IndexedDoc, tokens: string[]): SearchSnippet | undefined => {
    if (doc.text === '') return undefined;
    const first = tokens
      .map((token) => doc.lowerText.indexOf(token))
      .filter((position) => position !== -1)
      .sort((a, b) => a - b)[0];
    if (first === undefined) return undefined;

    const start = Math.max(0, first - 60);
    const end = Math.min(doc.text.length, start + 180);
    const prefix = start > 0 ? '…' : '';
    const text = prefix + doc.text.slice(start, end) + (end < doc.text.length ? '…' : '');
    const lower = text.toLowerCase();

    const highlights: SearchHighlight[] = [];
    for (const token of tokens) {
      let position = lower.indexOf(token);
      while (position !== -1) {
        highlights.push({ start: position, end: position + token.length });
        position = lower.indexOf(token, position + token.length);
      }
    }
    highlights.sort((a, b) => a.start - b.start);

    // Collapse overlaps so the renderer can slice the string linearly.
    const merged: SearchHighlight[] = [];
    for (const highlight of highlights) {
      const last = merged[merged.length - 1];
      if (last && highlight.start <= last.end) last.end = Math.max(last.end, highlight.end);
      else merged.push({ ...highlight });
    }

    return { text, highlights: merged };
  };

  return {
    size: documents.length,
    search(query: string, limit = 20): SearchResult[] {
      const tokens = [...new Set(tokenize(query))];
      if (tokens.length === 0) return [];

      // Every query token must match somewhere in the document.
      let candidates: Map<number, number> | undefined;
      for (const token of tokens) {
        const scores = scoreToken(token);
        if (scores.size === 0) return [];
        if (candidates === undefined) {
          candidates = scores;
          continue;
        }
        const next = new Map<number, number>();
        for (const [docId, score] of candidates) {
          const additional = scores.get(docId);
          if (additional !== undefined) next.set(docId, score + additional);
        }
        candidates = next;
        if (candidates.size === 0) return [];
      }

      return [...(candidates ?? new Map<number, number>())]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, limit)
        .map(([docId, score]) => {
          const doc = documents[docId]!;
          const snippet = buildSnippet(doc, tokens);
          return {
            route: doc.route,
            title: doc.title,
            ...(doc.type && { type: doc.type }),
            ...(doc.description && { description: doc.description }),
            score,
            ...(snippet && { snippet }),
          };
        });
    },
  };
}
