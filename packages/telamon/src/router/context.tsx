import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { normalizeRoute } from '../bundle/paths.js';
import { splitRoute, type NavigateOptions, type RouterAdapter } from './types.js';

const RouterContext = createContext<RouterAdapter | null>(null);

export function RouterProvider({
  router,
  children,
}: {
  router: RouterAdapter;
  children: ReactNode;
}) {
  return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterAdapter {
  const router = useContext(RouterContext);
  if (!router) throw new Error('useRouter must be used inside <OkfSite> or <RouterProvider>.');
  return router;
}

/** Current route, its fragment, and a navigate function. */
export function useRoute() {
  const router = useRouter();
  const route = normalizeRoute(router.usePath());
  const fragment = router.useFragment?.() ?? '';
  const navigate = useCallback(
    (target: string, options?: NavigateOptions) => router.navigate(target, options),
    [router],
  );
  return useMemo(() => ({ route, fragment, navigate }), [route, fragment, navigate]);
}

export function useNavigate() {
  return useRoute().navigate;
}

/** True when the browser should be left to handle a click itself. */
function isModified(event: MouseEvent<HTMLAnchorElement>, target?: string): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (target !== undefined && target !== '_self')
  );
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Destination route, optionally with a `#fragment`. */
  to: string;
  replace?: boolean;
}

/**
 * An in-app anchor. Renders a real `href` so the link is copyable, opens in a
 * new tab on modifier-click, and works before hydration; only plain left
 * clicks are intercepted for client-side navigation.
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, replace, onClick, ...rest },
  ref,
) {
  const router = useRouter();
  const current = normalizeRoute(router.usePath());
  const { path } = splitRoute(to);
  const isCurrent = normalizeRoute(path) === current;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (isModified(event, rest.target)) return;
    event.preventDefault();
    router.navigate(to, { replace: replace ?? false });
  };

  return (
    <a
      {...rest}
      ref={ref}
      href={router.createHref(to)}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={handleClick}
    />
  );
});
