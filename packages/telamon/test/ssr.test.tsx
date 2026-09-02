import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OkfSite, createMemoryRouter, parseBundle } from '../src/index.js';
import { readFixture } from './helpers.js';

const bundle = parseBundle(readFixture('ga4'));

/**
 * The site must render without a browser: `useSyncExternalStore` needs a server
 * snapshot, and nothing may touch `window` during render.
 */
describe('server rendering', () => {
  it('renders a concept page to a string', () => {
    const html = renderToString(
      <OkfSite bundle={bundle} router={createMemoryRouter('/references/metrics/purchasers')} />,
    );

    expect(html).toContain('Purchasers Audience Metric');
    expect(html).toContain('COUNT(DISTINCT user_id)');
    expect(html).toContain('Referenced by');
    // Links are real hrefs, so the page is navigable before hydration.
    expect(html).toContain('href="/tables/events_"');
  });

  it('renders the bundle root with the default history router', () => {
    const html = renderToString(<OkfSite bundle={bundle} />);
    expect(html).toContain('Bundle contents');
  });
});
