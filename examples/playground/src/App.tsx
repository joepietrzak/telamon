import { useEffect, useMemo, useState } from 'react';
import { OkfSite, type BundleDiagnostic } from 'telamon';
import { BUNDLES, type BundleKey } from './bundles.js';

const THEMES = {
  default: 'Default tokens',
  dark: 'Dark',
  brand: 'Brand tokens',
} as const;

type ThemeKey = keyof typeof THEMES;

export function App() {
  const [bundleKey, setBundleKey] = useState<BundleKey>('demo');
  const [theme, setTheme] = useState<ThemeKey>('default');
  const [diagnostics, setDiagnostics] = useState<BundleDiagnostic[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // The token layer is just CSS custom properties, so swapping a look is a
  // matter of swapping which declarations are in scope.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.okfTheme = theme === 'dark' ? 'dark' : 'light';
    root.classList.toggle('theme-brand', theme === 'brand');
  }, [theme]);

  const files = BUNDLES[bundleKey].files;
  // Keyed so switching bundles remounts the site rather than mixing routes.
  const site = useMemo(
    () => (
      <OkfSite
        key={bundleKey}
        bundle={files}
        title={BUNDLES[bundleKey].label}
        onDiagnostics={setDiagnostics}
      />
    ),
    [bundleKey, files],
  );

  return (
    <div className="playground">
      <div className="playground-bar">
        <label>
          Bundle
          <select
            value={bundleKey}
            onChange={(event) => setBundleKey(event.target.value as BundleKey)}
          >
            {Object.entries(BUNDLES).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Theme
          <select value={theme} onChange={(event) => setTheme(event.target.value as ThemeKey)}>
            {Object.entries(THEMES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button type="button" onClick={() => setShowDiagnostics((open) => !open)}>
          {diagnostics.length} diagnostic{diagnostics.length === 1 ? '' : 's'}
        </button>
      </div>

      {showDiagnostics && diagnostics.length > 0 ? (
        <ul className="playground-diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <li key={index} data-severity={diagnostic.severity}>
              <code>{diagnostic.code}</code>
              <strong>{diagnostic.filePath}</strong>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {site}
    </div>
  );
}
