const READER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
/** Keep correcting at least this long, so lists and panels that fill in late are covered. */
const MIN_SETTLE_MS = 1500;
/** After web fonts are ready, one more short window covers the reflow they cause. */
const AFTER_FONTS_MS = 400;
/** Never hold the page longer than this, even if a font never finishes loading. */
const MAX_SETTLE_MS = 6000;

/**
 * Scrolls so `target` sits at its scroll-margin-top below the top of the viewport,
 * then keeps it there while late layout above it settles. On a first visit the web
 * font swaps in after this scroll and shortens the cards above, which would otherwise
 * slide the opened title under the fixed header. Browser scroll anchoring does not
 * correct that font reflow. The correction stops as soon as the reader scrolls,
 * taps or types, or once fonts are ready and the layout has had time to settle.
 * Returns a function that stops the correction early.
 */
export function scrollToEntry(target: HTMLElement): () => void {
  const margin = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
  const startedAt = performance.now();
  let fontsReadyAt = document.fonts && document.fonts.status !== 'loaded' ? Number.POSITIVE_INFINITY : startedAt;
  let expected = window.scrollY;
  let frame = 0;
  let stopped = false;

  const align = () => {
    const top = Math.max(0, Math.round(window.scrollY + target.getBoundingClientRect().top - margin));
    if (Math.abs(top - window.scrollY) >= 1) window.scrollTo({ behavior: 'auto', top });
    expected = window.scrollY;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.cancelAnimationFrame(frame);
    for (const type of READER_INPUT) window.removeEventListener(type, stop, true);
  };
  const watch = () => {
    if (stopped) return;
    // Anything else moving the page (the reader, a link, the browser) takes over.
    if (!target.isConnected || Math.abs(window.scrollY - expected) > 1) return stop();
    align();
    const now = performance.now();
    const settled = now - startedAt >= MIN_SETTLE_MS && now - fontsReadyAt >= AFTER_FONTS_MS;
    if (settled || now - startedAt >= MAX_SETTLE_MS) return stop();
    frame = window.requestAnimationFrame(watch);
  };

  align();
  if (document.fonts && fontsReadyAt === Number.POSITIVE_INFINITY) {
    void document.fonts.ready.then(() => { fontsReadyAt = performance.now(); });
  }
  for (const type of READER_INPUT) window.addEventListener(type, stop, { capture: true, passive: true });
  frame = window.requestAnimationFrame(watch);
  return stop;
}
