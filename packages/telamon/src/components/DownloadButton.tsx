import { useCallback } from 'react';
import { archiveFileName, zipFiles } from '../bundle/archive.js';
import { useClassName, useOkfBundle, useOkfConfig } from './context.js';

/**
 * Hand the bundle's source files back as a ZIP.
 *
 * Nothing is fetched: the whole bundle is already in memory, so the archive is
 * built from `bundle.files` on click. That keeps the source of a rendered page
 * one click away -- the point of a knowledge bundle being plain markdown -- and
 * costs nothing until someone asks for it.
 */
export function DownloadButton() {
  const className = useClassName('download');
  const bundle = useOkfBundle();
  const { title } = useOkfConfig();

  const download = useCallback(() => {
    const blob = new Blob([zipFiles(bundle.files)], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = archiveFileName(title);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on the next tick: Safari reads the URL after `click` returns.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [bundle, title]);

  return (
    <button
      type="button"
      className={className}
      onClick={download}
      title={`Download ${archiveFileName(title)}`}
    >
      Download
    </button>
  );
}
