import type { OkfDoc } from '../bundle/types.js';
import { useClassName } from './context.js';

const MAX_DEPTH = 3;

/** On-page contents, derived from the same hast the body renders from. */
export function Toc({ doc }: { doc: OkfDoc }) {
  const className = useClassName('toc');
  const headings = doc.headings.filter((heading) => heading.depth <= MAX_DEPTH);
  if (headings.length < 2) return null;

  const minDepth = Math.min(...headings.map((heading) => heading.depth));

  return (
    <nav className={className} aria-labelledby="okf-toc-heading">
      <h2 id="okf-toc-heading" className="okf-toc-heading">
        On this page
      </h2>
      <ul className="okf-toc-list">
        {headings.map((heading) => (
          <li
            key={heading.id}
            className="okf-toc-item"
            data-okf-depth={heading.depth - minDepth}
          >
            <a className="okf-toc-link" href={`#${heading.id}`}>
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
