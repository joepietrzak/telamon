import '@testing-library/jest-dom/vitest';

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
