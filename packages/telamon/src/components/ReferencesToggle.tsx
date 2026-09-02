import { useReferences, useClassName } from './context.js';

/**
 * Show or hide provenance-only reference concepts.
 *
 * In many bundles the `references/` tree exists to carry source provenance for
 * other concepts and holds nothing substantive on its own, which makes it
 * noise in the sidebar and in search. Hiding is presentational only: those
 * pages stay routable, and links from other concepts still resolve.
 */
export function ReferencesToggle() {
  const className = useClassName('referencesToggle');
  const { available, visible, setVisible } = useReferences();
  if (!available) return null;

  return (
    <label className={className}>
      <input
        type="checkbox"
        checked={visible}
        onChange={(event) => setVisible(event.target.checked)}
      />
      <span>Show references</span>
    </label>
  );
}
