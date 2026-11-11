import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type View = 'trade' | 'borrow' | 'buy' | 'prices';
const VIEWS: readonly View[] = ['trade', 'borrow', 'buy', 'prices'];

function readView(): View {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (!h && new URLSearchParams(window.location.search).get('paid') === '1') return 'trade'; // back from the payment page
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

/**
 * A number that glides to its new value in about `ms` milliseconds, for display only.
 * The value it settles on is the one passed in; the frames in between are animation.
 */
export function useCountUp(target: number, ms = 600): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    const from = shownRef.current;
    const still =
      !Number.isFinite(target) ||
      !Number.isFinite(from) ||
      from === target ||
      document.hidden ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const v = k >= 1 ? target : from + (target - from) * (1 - Math.pow(1 - k, 3));
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Frames pause in a hidden tab; make sure the number still lands on its value.
    const settle = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      shownRef.current = target;
      setShown(target);
    }, ms + 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [target, ms]);
  return shown;
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
