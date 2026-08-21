/**
 * Keeps float-mode badges fully inside the viewport **horizontally**.
 *
 * Merchant offsets (`--inset-inline-start`, `--inset-inline-start-mobile`) are
 * %-based (-10…110%) relative to the positioned parent. On narrow viewports (or
 * when the parent sits near a screen edge), extreme offsets push the badge off-screen.
 *
 * Fix: compute `--badge-clamp-min-inline` / `--badge-clamp-max-inline` (px) so that
 * CSS `clamp(min, merchantOffset%, max)` on `inset-inline-start` always keeps the
 * full badge box inside `[MARGIN, viewportWidth - MARGIN]`.
 *
 * Vertical axis is NOT clamped: badge moves with its absolute context during scroll,
 * and clamping `top` produced multi-thousand px corrections when the section was
 * off-screen.
 */

const CLAMP_MIN_VAR = "--badge-clamp-min-inline";
const CLAMP_MAX_VAR = "--badge-clamp-max-inline";
const VIEWPORT_MARGIN = 8;

export class BadgeFloat extends HTMLElement {
  /** @type {ResizeObserver | undefined} */
  #layoutObserver;

  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {number | undefined} */
  #outerRaf;

  /** @type {boolean} */
  #dirty = false;

  /** @type {Element | undefined} */
  #observedParent;

  connectedCallback() {
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    window.addEventListener("resize", this.#schedule, { passive: true, signal });
    window.addEventListener("orientationchange", this.#schedule, { signal });

    this.#layoutObserver = new ResizeObserver(() => this.#schedule());
    this.#layoutObserver.observe(this);
    this.#layoutObserver.observe(document.documentElement);

    this.#observeParent();

    if (window.Shopify?.designMode) {
      const section = this.closest(".shopify-section");
      section?.addEventListener(
        "shopify:section:load",
        () => {
          this.#observeParent();
          this.#schedule();
        },
        { signal },
      );
    }

    this.#schedule();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = undefined;
    this.#layoutObserver?.disconnect();
    this.#layoutObserver = undefined;
    this.#observedParent = undefined;
    if (this.#outerRaf != null) {
      cancelAnimationFrame(this.#outerRaf);
      this.#outerRaf = undefined;
    }
    this.#dirty = false;
    this.style.removeProperty(CLAMP_MIN_VAR);
    this.style.removeProperty(CLAMP_MAX_VAR);
  }

  #observeParent() {
    if (this.#observedParent && this.#layoutObserver) {
      this.#layoutObserver.unobserve(this.#observedParent);
      this.#observedParent = undefined;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.#layoutObserver) return;
        const p = this.offsetParent;
        if (p instanceof Element && p !== document.documentElement) {
          this.#layoutObserver.observe(p);
          this.#observedParent = p;
        }
      });
    });
  }

  #schedule = () => {
    this.#dirty = true;
    if (this.#outerRaf != null) return;
    this.#outerRaf = requestAnimationFrame(() => {
      this.#outerRaf = undefined;
      requestAnimationFrame(() => {
        if (!this.#dirty) return;
        this.#dirty = false;
        this.#computeClamp();
        if (this.#dirty) this.#schedule();
      });
    });
  };

  #computeClamp() {
    const parent = this.offsetParent;
    if (!(parent instanceof Element)) return;

    const parentRect = parent.getBoundingClientRect();
    const vw = window.innerWidth;

    if (parentRect.right <= 0 || parentRect.left >= vw) {
      this.style.removeProperty(CLAMP_MIN_VAR);
      this.style.removeProperty(CLAMP_MAX_VAR);
      return;
    }

    const badgeWidth = this.getBoundingClientRect().width;
    if (badgeWidth < 1) return;

    const isRtl = getComputedStyle(this).direction === "rtl";

    let min;
    let max;

    if (isRtl) {
      min = parentRect.right - vw + VIEWPORT_MARGIN;
      max = parentRect.right - VIEWPORT_MARGIN - badgeWidth;
    } else {
      min = VIEWPORT_MARGIN - parentRect.left;
      max = vw - VIEWPORT_MARGIN - parentRect.left - badgeWidth;
    }

    if (min > max) {
      const mid = (min + max) / 2;
      min = mid;
      max = mid;
    }

    const r = (n) => Math.round(n * 100) / 100;
    this.style.setProperty(CLAMP_MIN_VAR, `${r(min)}px`);
    this.style.setProperty(CLAMP_MAX_VAR, `${r(max)}px`);
  }
}

if (!customElements.get("badge-float")) {
  customElements.define("badge-float", BadgeFloat);
}
