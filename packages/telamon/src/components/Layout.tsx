import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRoute } from '../router/context.js';
import { useClassName, useDoc, useNavTree, useOkfConfig } from './context.js';

const MAIN_ID = 'okf-main';
const SIDEBAR_ID = 'okf-sidebar';

/**
 * Move focus and scroll position on navigation.
 *
 * A client-side route change leaves both where they were, which strands
 * keyboard and screen-reader users partway down the previous page. The initial
 * render is skipped so landing on a deep link does not steal focus.
 */
function useNavigationEffects(target: React.RefObject<HTMLElement>) {
  const { route, fragment } = useRoute();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (!fragment) return;
    }
    if (fragment) {
      const element = document.getElementById(fragment);
      if (element) {
        element.scrollIntoView();
        return;
      }
    }
    window.scrollTo({ top: 0 });
    target.current?.focus({ preventScroll: true });
  }, [route, fragment, target]);
}

/** Chrome around the routed page: header, navigation, breadcrumbs, contents. */
export function Layout({ children }: { children: ReactNode }) {
  const { title, features, slots } = useOkfConfig();
  const rootClassName = useClassName('root');
  const bodyClassName = useClassName('body');
  const mainClassName = useClassName('main');
  const sidebarClassName = useClassName('sidebar');
  const footerClassName = useClassName('footer');

  const { route } = useRoute();
  const nodes = useNavTree();
  const doc = useDoc();
  const mainRef = useRef<HTMLElement>(null);

  // The narrow-screen nav closes on navigation. Storing the route the state
  // belongs to derives that during render, rather than costing an extra pass
  // through an effect.
  const [nav, setNav] = useState({ route, open: false });
  const navOpen = nav.route === route && nav.open;

  useNavigationEffects(mainRef);

  const showToc = features.toc && doc !== undefined && doc.headings.length > 1;

  return (
    <div className={rootClassName} data-okf-route={route} data-okf-nav-open={navOpen || undefined}>
      <a className="okf-skip-link" href={`#${MAIN_ID}`}>
        Skip to content
      </a>

      <div className="okf-header-bar">
        <button
          type="button"
          className="okf-nav-button"
          aria-expanded={navOpen}
          aria-controls={SIDEBAR_ID}
          onClick={() => setNav({ route, open: !navOpen })}
        >
          Contents
        </button>
        <slots.Header title={title} />
      </div>

      <div className={bodyClassName}>
        <aside id={SIDEBAR_ID} className={sidebarClassName}>
          <slots.Sidebar nodes={nodes} />
        </aside>

        <main id={MAIN_ID} className={mainClassName} ref={mainRef} tabIndex={-1}>
          <slots.Breadcrumbs route={route} />
          {children}
        </main>

        {showToc ? (
          <aside className="okf-aside">
            <slots.Toc doc={doc} />
          </aside>
        ) : null}
      </div>

      <footer className={footerClassName}>
        <slots.Footer />
      </footer>
    </div>
  );
}
