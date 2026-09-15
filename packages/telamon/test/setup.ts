import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';

// The suite runs several jsdom workers in parallel, often alongside a typecheck
// or a build, and some waits here do real work under the hood: resolving the
// graph's lazy chunk, or building the search index over the whole fixture on
// the first keystroke. The 1s default is comfortable on an idle machine and not
// otherwise, which showed up as failures that would not reproduce. This is a
// ceiling, not a delay -- a passing assertion still returns immediately.
configure({ asyncUtilTimeout: 5000 });

// The source, server, and database suites run under the node environment,
// where there is no DOM to patch and nothing below applies.
if (typeof window !== 'undefined') {
  // jsdom implements neither of these; the layout calls them on every navigation.
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};

  // Pointer capture is unimplemented in jsdom and is used by the graph's pan gesture.
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function setPointerCapture() {};
    Element.prototype.releasePointerCapture = function releasePointerCapture() {};
    Element.prototype.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
  }
}
