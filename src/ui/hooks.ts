import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type View = 'borrow' | 'buy' | 'prices';
const VIEWS: readonly View[] = ['borrow', 'buy', 'prices'];

function readView(): View {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (VIEWS as readonly string[]).includes(h) ? (h as View) : 'borrow';
}

/** The current view from the URL hash (#/borrow, #/buy, #/prices). */
export function useView(): View {
  const [view, setView] = useState<View>(readView);
  useEffect(() => {
    const onChange = () => {
      setView(readView());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return view;
}

/** Width of an element in CSS pixels, kept up to date, so SVG text stays the same size on a phone and a laptop. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
