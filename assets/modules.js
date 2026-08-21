import { Component } from "@theme/component";
import { DialogCloseEvent } from "@theme/dialog";
import { ThemeEvents, MediaStartedPlayingEvent, ModelInteractionEvent } from "@theme/events";
import { isSafari, getSafariVersion } from "@theme/utilities";
import { imageCoordinator } from "@theme/image-coordinator";

class TabsComponent extends Component {
  /** @type {string[]} */
  requiredRefs = ["tab", "panel"];

  /** @type {number} */
  _activeIndex = 0;

  /** @type {WeakMap<Element, Animation>} */
  #animations = new WeakMap();

  /** @type {number} */
  #previousIndex = 0;

  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  connectedCallback() {
    super.connectedCallback();
    this.#registerDesignModeEvents();

    const initial = Number(this.getAttribute("active-index"));
    if (!Number.isNaN(initial)) this._activeIndex = this.#clampIndex(initial);

    this.#ensureIdsAndAria();
    this.#syncSelected(false);
  }

  disconnectedCallback() {
    // Clean up Theme Editor bindings
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();
  }

  #registerDesignModeEvents() {
    // Only in Theme Editor and when explicitly opted-in
    if (!(window.Shopify && Shopify.designMode)) return;

    // Recreate controller to drop old listeners if any
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (e) => {
        if (e.detail.sectionId != this.sectionId) return;

        const { target } = e;
        const panel = target.closest('[ref="panel[]"]');
        const index = panel.dataset.index;
        this.selectTab(index, true);
      },
      { signal }
    );
  }

  onTabClick(event) {
    event.preventDefault();

    const target = /** @type {HTMLElement} */ (event.target);
    if (!target) return;

    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    const index = tabs.indexOf(target);
    if (index === -1) return;

    this.selectTab(index, true);
  }

  onKeydown(event) {
    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    if (!tabs?.length) return;

    const currentIndex = tabs.indexOf(/** @type {HTMLElement} */ (event.target));
    if (currentIndex === -1) return;

    let next;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = currentIndex + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = currentIndex - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.selectTab(next, true);
  }

  selectTab(index, focus = false) {
    const next = this.#clampIndex(index);
    if (next === this._activeIndex) return;

    this.#previousIndex = this._activeIndex;
    this._activeIndex = next;
    this.setAttribute("active-index", String(next));
    this.#syncSelected(focus);
  }

  #loadPanelContent(panel) {
    if (panel.dataset.lazyLoading !== "true") return;
    if (panel.dataset.loaded === "true") return;

    const template = panel.querySelector("template");
    if (!template) {
      panel.dataset.loaded = "true";
      return;
    }

    const fragment = template.content.cloneNode(true);
    panel.appendChild(fragment);
    template.remove();

    const fallbacks = panel.querySelectorAll("noscript");
    fallbacks.forEach((fallback) => fallback.remove());

    panel.dataset.loaded = "true";
  }

  #syncSelected(focus) {
    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    const panels = /** @type {HTMLElement[]} */ (this.refs.panel);
    if (!tabs?.length || !panels?.length) return;

    for (let i = 0; i < tabs.length; i++) {
      const isActive = i === this._activeIndex;

      tabs[i].setAttribute("aria-selected", String(isActive));
      tabs[i].setAttribute("tabindex", isActive ? "0" : "-1");
      tabs[i].toggleAttribute("data-active", isActive);
    }

    const activePanel = panels[this._activeIndex];
    const previousPanel = panels[this.#previousIndex];

    this.#loadPanelContent(activePanel);

    // If same panel, ensure it's visible and bail
    if (this.#previousIndex === this._activeIndex) {
      if (activePanel) {
        this.#cancelAnimation(activePanel);
        activePanel.hidden = false;
        activePanel.style.willChange = "";
      }
    } else {
      // Immediately hide previous panel, animate only the next panel
      if (previousPanel) {
        this.#cancelAnimation(previousPanel);
        previousPanel.hidden = true;
        previousPanel.style.willChange = "";
      }
      if (activePanel) {
        this.#cancelAnimation(activePanel);
        activePanel.hidden = false;
        this.#animateIn(activePanel);
      }

      // Hide all other non-involved panels
      for (let i = 0; i < panels.length; i++) {
        if (i === this._activeIndex) continue;
        const panel = panels[i];
        if (!panel) continue;
        this.#cancelAnimation(panel);
        panel.hidden = true;
        panel.style.willChange = "";
      }
    }

    if (focus) tabs[this._activeIndex]?.focus();
  }

  #animateIn(panel) {
    // Respect reduced motion and provide graceful fallback
    const supportsWAAPI = typeof Element !== "undefined" && "animate" in Element.prototype;
    const prefersReduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (!supportsWAAPI || prefersReduce) {
      panel.hidden = false;
      return;
    }

    this.#cancelAnimation(panel);

    panel.hidden = false;
    panel.style.willChange = "opacity, transform";

    const styles = getComputedStyle(this);
    const translate = styles.getPropertyValue("--tabs-enter-translate").trim() || "12px";
    const durationStr = styles.getPropertyValue("--tabs-enter-duration").trim();
    const duration = Number(durationStr) || 220;
    const easing = styles.getPropertyValue("--ease-standard").trim() || "ease";

    const anim = panel.animate(
      [
        { opacity: 0, transform: `translateY(${translate})` },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration, easing }
    );

    this.#animations.set(panel, anim);

    const cleanup = () => {
      if (this.#animations.get(panel) === anim) {
        this.#animations.delete(panel);
        panel.style.willChange = "";
      }
    };

    anim.addEventListener("finish", cleanup, { once: true });
    anim.addEventListener("cancel", cleanup, { once: true });
  }

  #cancelAnimation(panel) {
    const anim = this.#animations.get(panel);
    if (anim) {
      anim.cancel();
      this.#animations.delete(panel);
    }
  }

  #ensureIdsAndAria() {
    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    const panels = /** @type {HTMLElement[]} */ (this.refs.panel);
    if (!tabs?.length || !panels?.length) return;

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const panel = panels[i];
      if (!panel) continue;

      const tabId = tab.id || `${this.sectionId}-${this.tagName.toLowerCase()}-tab-${i}`;
      const panelId = panel.id || `${this.sectionId}-${this.tagName.toLowerCase()}-panel-${i}`;

      tab.id = tabId;
      panel.id = panelId;

      tab.setAttribute("role", "tab");
      panel.setAttribute("role", "tabpanel");

      tab.setAttribute("aria-controls", panelId);
      panel.setAttribute("aria-labelledby", tabId);
    }
  }

  #clampIndex(index) {
    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    if (!tabs?.length) return 0;
    const len = tabs.length;
    return ((index % len) + len) % len;
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error("Section id missing");

    return sectionId;
  }
}

if (!customElements.get("tabs-component")) {
  customElements.define("tabs-component", TabsComponent);
}

export class AccordionComponent extends Component {
  /** @type {string[]} */
  requiredRefs = ["item", "summary", "content"];

  /** @type {WeakMap<Element, Animation>} */
  #animations = new WeakMap();

  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  connectedCallback() {
    super.connectedCallback();
    this.#registerDesignModeEvents();
  }

  disconnectedCallback() {
    // Clean up Theme Editor bindings
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();
  }

  #registerDesignModeEvents() {
    // Only in Theme Editor and when explicitly opted-in
    if (!(window.Shopify && Shopify.designMode)) return;

    // Recreate controller to drop old listeners if any
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (e) => {
        if (e.detail.sectionId != this.sectionId) return;

        const { target } = e;
        const item = target.closest("details");

        if (item && item.open != true) {
          const summary = item.querySelector("summary");
          const content = item.querySelector(".accordion__content");

          this.toggleOpen({ willOpen: true, item, summary, content });
        }
      },
      { signal }
    );
  }

  onSummaryClick(event) {
    event.preventDefault();

    const summary = /** @type {HTMLElement} */ (event.target);

    const summaries = /** @type {HTMLElement[] | HTMLElement | undefined} */ (this.refs.summary);
    const items = /** @type {HTMLElement[] | HTMLElement | undefined} */ (this.refs.item);
    const contents = /** @type {HTMLElement[] | HTMLElement | undefined} */ (this.refs.content);

    let idx = -1;
    if (Array.isArray(summaries)) idx = summaries.indexOf(summary);

    /** @type {HTMLElement | undefined} */
    let item;
    /** @type {HTMLElement | undefined} */
    let content;

    if (idx >= 0) {
      item = Array.isArray(items) ? items[idx] : /** @type {HTMLElement} */ (items);
      content = Array.isArray(contents) ? contents[idx] : /** @type {HTMLElement} */ (contents);
    } else {
      // Fallback an toàn nếu chưa dùng refs mảng
      item = summary.closest("details") ?? undefined;
      if (item) content = this.#getContent(item);
    }

    if (!item || !content) return;

    this.toggleOpen({
      willOpen: !item.open,
      item,
      summary,
      content,
      shouldScroll: true,
    });
  }

  toggleOpen(settings) {
    const { willOpen, item, summary, content, shouldScroll = false } = settings;

    if (willOpen) {
      item.classList.add("is-open");
      if (this.dataset.singleOpen === "true") this.#closeOthers(item);
      item.open = true;
      item.querySelector("summary")?.setAttribute("aria-expanded", "true");
      this.#animateOpen(content, shouldScroll ? () => this.#scrollIntoViewIfOut(summary) : undefined);
    } else {
      if (this.#isAtLeastOneItemOpen()) {
        const { item } = this.refs;
        let numberItemOpened = 0;

        for (const detail of item) {
          if (detail.classList.contains("is-open")) {
            numberItemOpened++;
          }
        }

        if (numberItemOpened <= 1) {
          return;
        }
      }

      item.classList.remove("is-open");
      this.#animateClose(item, content);
    }
  }

  #isAtLeastOneItemOpen() {
    return this.dataset.atLeastOneItemOpen === "true";
  }

  #closeOthers(except) {
    const items = /** @type {HTMLElement[]} */ (this.refs.item);
    for (const it of items) {
      if (it === except || !it.open) continue;
      it.classList.remove("is-open");
      const content = this.#getContent(it);
      if (content) this.#animateClose(it, content);
    }
  }

  #getContent(item) {
    const ref = /** @type {HTMLElement | HTMLElement[] | undefined} */ (this.refs.content);
    if (Array.isArray(ref)) {
      const found = ref.find((el) => item.contains(el));
      if (found) return found;
    } else if (ref instanceof HTMLElement) {
      if (item.contains(ref)) return ref;
    }

    const summary = item.querySelector("summary");
    if (!summary) return null;
    let node = summary.nextElementSibling;
    while (node && node.tagName.toLowerCase() === "summary") node = node.nextElementSibling;
    return /** @type {HTMLElement|null} */ (node);
  }

  #animateOpen(content, onFinish) {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    this.#cancel(content);

    content.style.overflow = "hidden";
    content.hidden = false;

    if (reduce) {
      content.style.height = "";
      content.style.opacity = "";
      content.style.overflow = "";
      if (typeof onFinish === "function") onFinish();
      return;
    }

    // Start from collapsed state
    content.style.height = "0px";

    const duration = this.#duration();
    const easing = this.#easing();

    const start = () => {
      const inner = content.querySelector(".accordion__inner");
      const target = inner instanceof HTMLElement ? inner.scrollHeight : content.scrollHeight;
      const anim = content.animate(
        [
          { height: "0px", opacity: 0 },
          { height: `${target}px`, opacity: 1 },
        ],
        { duration, easing, fill: "forwards" }
      );

      this.#animations.set(content, anim);

      const cleanup = () => {
        if (this.#animations.get(content) === anim) {
          this.#animations.delete(content);
          // Cancel animation to clear all applied styles
          anim.cancel();
          // Clear all animation styles to allow natural height
          content.style.height = "";
          content.style.opacity = "";
          content.style.overflow = "";
          if (typeof onFinish === "function") onFinish();
        }
      };

      anim.addEventListener("finish", cleanup, { once: true });
      anim.addEventListener("cancel", cleanup, { once: true });
    };

    if (typeof requestAnimationFrame === "function") requestAnimationFrame(start);
    else start();
  }

  #animateClose(item, content) {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    this.#cancel(content);

    // Measure current height (border-box) and freeze it
    const visualHeight = content.getBoundingClientRect().height || content.scrollHeight;
    const heightFrom = visualHeight;
    if (reduce) {
      item.open = false;
      return;
    }

    content.style.overflow = "hidden";
    // Freeze current layout as starting values
    content.style.height = `${heightFrom}px`;

    const duration = this.#duration();
    const easing = this.#easing();

    const start = () => {
      const anim = content.animate(
        [
          { height: `${heightFrom}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration, easing, fill: "forwards" }
      );

      this.#animations.set(content, anim);

      const cleanup = () => {
        if (this.#animations.get(content) === anim) {
          this.#animations.delete(content);
          // Cancel animation to clear all applied styles
          anim.cancel();
          item.open = false;
          item.querySelector("summary")?.setAttribute("aria-expanded", "false");
          content.style.height = "";
          content.style.opacity = "";
          content.style.overflow = "";
        }
      };

      anim.addEventListener("finish", cleanup, { once: true });
      anim.addEventListener("cancel", cleanup, { once: true });
    };

    // Ensure style application before animation starts
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(start);
    else start();
  }

  #cancel(content) {
    const a = this.#animations.get(content);
    if (a) {
      a.cancel();
      this.#animations.delete(content);
    }
  }

  #duration() {
    const d = getComputedStyle(this).getPropertyValue("--accordion-duration").trim();
    return Number(d) || 260;
  }

  #easing() {
    return getComputedStyle(this).getPropertyValue("--accordion-easing").trim() || "cubic-bezier(0.22, 1, 0.36, 1)";
  }

  // Smoothly scroll the clicked summary into view only if it's outside the viewport
  #scrollIntoViewIfOut(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 16; // breathing space
    const topVisible = rect.top >= margin;
    const bottomVisible = rect.bottom <= window.innerHeight - margin;
    if (topVisible && bottomVisible) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const targetTop = Math.max(0, window.scrollY + rect.top - margin);
    window.scrollTo({ top: targetTop, behavior: reduce ? "auto" : "smooth" });
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    return sectionId;
  }
}
if (!customElements.get("accordion-component")) {
  customElements.define("accordion-component", AccordionComponent);
}

/**
 * ResponsiveImage - Custom element for responsive lazy-loaded images
 *
 * Modes: liquid (src pre-rendered) | js (lazy hydrate)
 * Safari < 16: Force reload to fix blur from DOMParser elements
 */
// ---------------------------------------------------------------------------
// Shared IntersectionObserver for image-zoom-reveal "in-view" detection.
// One observer for all images — unobserves after first trigger (one-time reveal).
// ---------------------------------------------------------------------------
let _revealObserver = null;

function getRevealObserver() {
  if (!_revealObserver) {
    _revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            _revealObserver.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -50px 0px", threshold: 0.01 }
    );
  }
  return _revealObserver;
}

// Batch reveal checks: collect wrappers, flush in a single rAF to avoid
// interleaved getBoundingClientRect + classList writes when many images load at once.
let _revealQueue = [];
let _revealRafId = null;

function queueRevealCheck(wrapper) {
  _revealQueue.push(wrapper);
  if (!_revealRafId) {
    _revealRafId = requestAnimationFrame(flushRevealQueue);
  }
}

function flushRevealQueue() {
  _revealRafId = null;
  const wrappers = _revealQueue;
  _revealQueue = [];

  const viewportHeight = window.innerHeight;
  const toReveal = [];
  const toObserve = [];

  // Batch READ
  for (const wrapper of wrappers) {
    if (wrapper.classList.contains("in-view")) continue;
    const rect = wrapper.getBoundingClientRect();
    if (rect.top < viewportHeight - 50 && rect.bottom > 0) {
      toReveal.push(wrapper);
    } else {
      toObserve.push(wrapper);
    }
  }

  // Batch WRITE
  for (const wrapper of toReveal) {
    wrapper.classList.add("in-view");
  }

  if (toObserve.length) {
    const observer = getRevealObserver();
    for (const wrapper of toObserve) {
      observer.observe(wrapper);
    }
  }
}

class ResponsiveImage extends HTMLImageElement {
  #observer = null; // Cleanup function from imageCoordinator (was IntersectionObserver)
  #resizeObserver = null; // Cleanup function from imageCoordinator (was ResizeObserver)
  #detailsToggleCleanup = null; // Cleanup for details[open] re-measure (mega-menu, etc.)
  #rafId = null; // Pending rAF from #setupLazyLoad (cancel on cleanup to avoid stale callbacks)
  #readyPromise = null;
  #resolveReady = null;
  #pollId = null;
  #cachedSizesConfig = null;
  #lastSrc = null;

  get ready() {
    return this.#readyPromise;
  }

  get isReady() {
    return this.classList.contains("loaded");
  }

  connectedCallback() {
    this.#init();
  }

  disconnectedCallback() {
    this.#cleanup();
  }

  updatedCallback() {
    const currentSrc = this.src || this.dataset.src;
    if (currentSrc === this.#lastSrc) {
      // Morph may have stripped JS-added attributes/classes — restore them
      this.#restoreAfterMorph();
      return;
    }
    this.#lastSrc = currentSrc;
    this.#cleanup();
    this.classList.remove("loaded", "loading");
    this.wrapper?.classList.remove("loaded", "loading", "error");
    this.#init();
  }

  /**
   * Restore state after morph when src hasn't changed.
   * morphSection copies attributes from server HTML, stripping JS-added:
   * - src, srcset, sizes (hydrated by JS in js-mode)
   * - loaded/loading/in-view classes on img and wrapper
   */
  #restoreAfterMorph() {
    // Re-query wrapper (morph may have replaced the DOM node)
    this.wrapper = this.closest(".media");

    // JS mode: restore hydrated src/srcset/sizes if morph stripped them
    if (this._hydrated) {
      this.#hydrateSources();
      this.#hydrateImage();

      // Restore sizes if stripped
      if (!this.sizes?.trim()) {
        this.#setSizesFromWrapper();
        if (!this.sizes?.trim()) this.#applyFallbackSizes();
      }
    }

    // Re-apply loaded state (morph strips JS-added classes)
    if (this.complete && this.naturalWidth > 0) {
      this.#markLoaded();
    } else if (this._hydrated) {
      // src restored but image not yet cached — re-load
      this.#loadImage();
    } else if (this.wrapper) {
      // Liquid mode: restore wrapper classes
      if (this.classList.contains("loading")) {
        this.wrapper.classList.add("loading");
      }
    }
  }

  #init() {
    this.wrapper = this.closest(".media");
    this.#lastSrc = this.src || this.dataset.src;

    // Resolve old promise to unblock any pending waitForMediaReady() consumers
    this.#resolveReady?.();
    this.#readyPromise = new Promise((r) => (this.#resolveReady = r));

    const isLiquid = this.dataset.mode === "liquid";
    const isSafariOld = getSafariVersion()?.major < 16;

    // Check if already loaded BEFORE cleaning up classes
    // This happens when section re-renders with cached/completed images
    const wasAlreadyLoaded = this.classList.contains("loaded");
    const isComplete = this.complete && this.naturalWidth > 0;

    // Clean up any existing loading/loaded states
    // This prevents double classes when section re-renders
    this.classList.remove("loading", "loaded");
    this.wrapper?.classList.remove("loading", "loaded", "error");

    // If was already loaded or complete, mark as loaded and skip re-initialization
    if (wasAlreadyLoaded || isComplete) {
      this.#markLoaded();
      return;
    }

    // JS mode: lazy load
    if (!isLiquid) {
      this.#applyFallbackSizes();
      this.#setupLazyLoad();
      return;
    }

    // Liquid mode: wait for load
    // Safari < 16: force reload by re-assigning src
    if (isSafariOld && this.src) {
      const src = this.src;
      const srcset = this.srcset;
      this.removeAttribute("src");
      if (srcset) this.removeAttribute("srcset");
      queueMicrotask(() => {
        if (!this.isConnected) return;
        if (srcset) this.srcset = srcset;
        this.src = src;
        this.#waitForLoad(true);
      });
    } else {
      this.#waitForLoad(isSafariOld);
    }
  }

  #waitForLoad(usePoll = false) {
    // Ensure clean state before adding loading
    this.classList.remove("loaded");
    this.wrapper?.classList.remove("loaded", "error");

    this.classList.add("loading");
    this.wrapper?.classList.add("loading");

    const done = () => {
      this.removeEventListener("load", done);
      this.removeEventListener("error", done);
      this.#stopPoll();
      this.#markLoaded();
    };

    this.addEventListener("load", done, { once: true });
    this.addEventListener("error", done, { once: true });

    // Polling fallback for Safari < 16
    if (usePoll) {
      this.#pollId = setInterval(() => {
        if (!this.isConnected) return this.#stopPoll();
        if (this.naturalWidth > 0) done();
      }, 50);
      setTimeout(() => {
        if (this.#pollId && !this.isReady) {
          this.#stopPoll();
          this.#markLoaded();
        }
      }, 2000);
    }
  }

  #stopPoll() {
    if (this.#pollId) {
      clearInterval(this.#pollId);
      this.#pollId = null;
    }
  }

  // ============================================================================
  // JS MODE: Lazy load with IntersectionObserver (coordinated)
  // ============================================================================

  #setupLazyLoad() {
    // Setup ResizeObserver for dynamic sizes (coordinated)
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = null;
      if (!this.isConnected) return;
      this.#setSizesFromWrapper();
      this.#observeResize();
      this.#setupDetailsRecheck();

      // Immediate hydration for elements already in viewport
      // Handles elements that enter the DOM visible (e.g. after morph/section-rendering)
      // Check actual DOM state (srcset missing) instead of _hydrated flag
      // which persists across reinits and causes false negatives
      if (!this.srcset && this.dataset.srcset) {
        const rect = this.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0 && rect.width > 0) {
          if (typeof this.#observer === "function") {
            this.#observer(); // cleanup IO registration
            this.#observer = null;
          }
          this.#hydrateSources();
          this.#hydrateImage();
          this.#loadImage();
          return;
        }
      }
    });

    // Use shared IntersectionObserver for lazy loading
    // Replaces individual observer with coordinated approach
    this.#observer = imageCoordinator.registerLazyLoad(this, {
      onIntersect: () => {
        this.#hydrateSources();
        this.#hydrateImage();
        this.#loadImage();
      },
    });
  }

  #applyFallbackSizes() {
    // Early return if sizes already set
    if (this.sizes?.trim()) return;

    const defaultSizes = this.dataset.defaultSizes;
    if (defaultSizes?.trim()) {
      this.sizes = defaultSizes;
      return;
    }

    const config = this.#getSizesConfig();
    if (config.unit === "vw") {
      this.sizes = "100vw";
      return;
    }

    const widthAttr = parseInt(this.getAttribute("width") || "0", 10);
    if (widthAttr > 0) {
      this.sizes = `${widthAttr}px`;
      return;
    }

    this.sizes = "100vw";
  }

  #getSizesConfig() {
    if (this.#cachedSizesConfig) return this.#cachedSizesConfig;

    this.#cachedSizesConfig = {
      unit: (this.dataset.sizesUnit || "").toLowerCase(),
      mult: parseFloat(this.dataset.sizesMult || "1"),
      targetDpr: parseFloat(this.dataset.targetDpr || "0"),
      safety: parseFloat(this.dataset.sizesSafety || "1.0"),
    };

    return this.#cachedSizesConfig;
  }

  #calculateSizes(width) {
    if (width <= 0) return null;

    const config = this.#getSizesConfig();

    if (config.unit === "vw") {
      const vw = Math.max(1, window.innerWidth || width);
      const percent = Math.max(1, Math.min(100, Math.round((width / vw) * 100)));
      return `${percent}vw`;
    }

    let factor = isNaN(config.mult) ? 1 : config.mult;
    if (!isNaN(config.targetDpr) && config.targetDpr > 0) {
      const dpr = window.devicePixelRatio || 1;
      factor = (config.targetDpr / dpr) * (isNaN(config.safety) ? 1 : config.safety);
    }
    return `${Math.ceil(width * factor)}px`;
  }

  #setSizesFromWrapper() {
    const target = this.wrapper || this;
    if (!target) return;

    const w = target.offsetWidth;
    if (w > 0) {
      const sizes = this.#calculateSizes(w);
      if (sizes) this.sizes = sizes;
    }
  }

  #observeResize() {
    const target = this.wrapper || this;
    if (!target) return;

    // Use shared ResizeObserver (coordinated)
    // Replaces individual observer with coordinated approach
    this.#resizeObserver = imageCoordinator.registerResize(target, this, (width) => {
      const sizes = this.#calculateSizes(width);
      if (sizes && sizes !== this.sizes) this.sizes = sizes;
    });
  }

  /**
   * Re-measure sizes when details opens (e.g. mega-menu).
   * When content is inside closed details, initial offsetWidth can be wrong.
   */
  #setupDetailsRecheck() {
    this.#detailsToggleCleanup?.();
    this.#detailsToggleCleanup = null;

    const details = this.closest("details");
    if (!details || details.open) return;

    const onToggle = () => {
      if (!details.open) return;
      details.removeEventListener("toggle", onToggle);
      this.#detailsToggleCleanup = null;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (this.isConnected) this.#setSizesFromWrapper();
        });
      });
    };

    details.addEventListener("toggle", onToggle);
    this.#detailsToggleCleanup = () => {
      details.removeEventListener("toggle", onToggle);
      this.#detailsToggleCleanup = null;
    };
  }

  #hydrateSources() {
    const picture = this.closest("picture");
    if (!picture) return;
    const sources = picture.querySelectorAll("source[data-srcset]:not([srcset])");
    for (const s of sources) {
      s.srcset = s.dataset.srcset;
    }
  }

  #hydrateImage() {
    if (!this.srcset && this.dataset.srcset) {
      this.srcset = this.dataset.srcset;
    }
    if (!this.src && this.dataset.src) {
      this.src = this.dataset.src;
    }
    this._hydrated = true;
  }

  #loadImage() {
    if (this.classList.contains("loaded")) return;

    // Already complete after hydration
    if (this.complete && this.naturalWidth > 0) {
      this.#handleImageReady();
      return;
    }

    // Set loading state (loaded class already absent per guard above)
    this.classList.add("loading");
    this.wrapper?.classList.remove("error");
    this.wrapper?.classList.add("loading");

    this.addEventListener("load", this.#onLoad, { once: true });
    this.addEventListener("error", this.#onError, { once: true });
  }

  #onLoad = () => {
    this.#handleImageReady();
  };

  #onError = () => {
    this.#markError();
  };

  // ============================================================================
  // SHARED: Image ready handling
  // ============================================================================

  async #handleImageReady() {
    // Use decode() to prevent progressive JPEG artifacts
    if (typeof this.decode === "function") {
      const isSVG = this.src?.includes(".svg");
      if (!isSVG) {
        try {
          const timeout = isSafari() ? 150 : 100;
          await Promise.race([this.decode(), new Promise((r) => setTimeout(r, timeout))]);
        } catch {
          // decode() may fail, continue anyway
        }
      }
    }

    this.#markLoaded();
  }

  #markLoaded() {
    if (this.classList.contains("loaded")) return;

    this.classList.remove("loading");
    this.classList.add("loaded");
    this.wrapper?.classList.remove("loading");
    this.wrapper?.classList.add("loaded");

    // Trigger in-view check for zoom reveal
    this.#revealInView();

    // Resolve ready promise
    this.#resolveReady?.();
    this.#resolveReady = null;

    // Dispatch event for consumers
    this.dispatchEvent(
      new CustomEvent("image:ready", {
        bubbles: true,
        composed: true,
        detail: { image: this },
      })
    );
  }

  /**
   * Check if wrapper needs zoom-reveal in-view tracking.
   * For JS-mode lazy images, .loaded coincides with viewport entry → add .in-view immediately.
   * For liquid-mode images that load early, defer .in-view until the element scrolls into view.
   */
  #revealInView() {
    const wrapper = this.wrapper;
    if (!wrapper || !wrapper.classList.contains("image-zoom-reveal") || wrapper.classList.contains("in-view")) return;

    // Sync: if already in viewport, add .in-view immediately (no rAF delay)
    const rect = wrapper.getBoundingClientRect();
    if (rect.top < window.innerHeight - 50 && rect.bottom > 0) {
      wrapper.classList.add("in-view");
      return;
    }

    queueRevealCheck(wrapper);
  }

  #markError() {
    this.classList.remove("loading");
    this.wrapper?.classList.remove("loading");
    this.wrapper?.classList.add("error");

    // Still resolve ready promise to unblock consumers
    this.#resolveReady?.();
    this.#resolveReady = null;
  }

  #cleanup() {
    this.#stopPoll();

    this.#detailsToggleCleanup?.();
    this.#detailsToggleCleanup = null;

    // Cancel pending rAF from #setupLazyLoad to prevent stale callbacks
    // after rapid morph sequences (e.g. quick filter → clear → filter)
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }

    // Invalidate cache so #getSizesConfig recomputes after morph (dataset may have changed)
    this.#cachedSizesConfig = null;

    // Remove pending load/error listeners to prevent stale callbacks
    // (JS mode uses stable arrow-function refs, safe to call even if not registered)
    this.removeEventListener("load", this.#onLoad);
    this.removeEventListener("error", this.#onError);

    // Reset hydration flag for clean state on reinit
    this._hydrated = false;

    // Unobserve reveal observer if wrapper was registered
    if (this.wrapper && _revealObserver) {
      _revealObserver.unobserve(this.wrapper);
    }

    // Call cleanup functions returned by imageCoordinator
    // These handle unobserving and internal cleanup
    if (typeof this.#observer === "function") {
      this.#observer(); // Call cleanup function
    }
    this.#observer = null;

    if (typeof this.#resizeObserver === "function") {
      this.#resizeObserver(); // Call cleanup function
    }
    this.#resizeObserver = null;
  }
}

if (!customElements.get("responsive-image")) {
  customElements.define("responsive-image", ResponsiveImage, { extends: "img" });
}
class DeferredMedia extends Component {
  /** @type {boolean} */
  isPlaying = false;

  /** @type {AbortController} */
  #abortController = new AbortController();

  /** @type {IntersectionObserver} */
  #intersectionObserver = null;

  /** @type {boolean} */
  #isIntersecting = false;

  /** @type {Object} */
  #player = null;

  /** @type {boolean} */
  #isLoading = false;

  /** @type {boolean} */
  #isPreloaded = false;

  /** @type {string} */
  #mediaType = "";

  /** @type {string|null} */
  #originalVideoSrc = null;

  static get observedAttributes() {
    return ["data-media-loaded", "data-media-type", "data-autoplay"];
  }

  constructor() {
    super();
    this.#mediaType = this.getAttribute("data-media-type") || this.detectMediaType();
  }

  connectedCallback() {
    super.connectedCallback();
    const signal = this.#abortController.signal;

    // Find parent media-gallery
    const mediaGallery = this.#getMediaGalleryParent();

    // Listen to scoped event from parent media-gallery if exists
    if (mediaGallery) {
      mediaGallery.addEventListener(
        ThemeEvents.mediaStartedPlaying,
        (event) => {
          // Only pause if not this media itself
          if (event.detail.resource !== this) {
            this.pauseMedia();
          }
        },
        { signal }
      );
    }

    // Global coordination: pause non-autoplay standalone media on user-initiated play
    document.addEventListener(
      ThemeEvents.mediaStartedPlaying,
      (event) => {
        if (event.detail.resource === this) return;

        // Autoplay videos are controlled only by viewport (IntersectionObserver)
        if (this.hasAttribute("data-autoplay")) return;

        // Non-autoplay standalone: pause only on user-initiated play
        if (!mediaGallery && !event.detail.isAutoplay) {
          this.pauseMedia();
        }
      },
      { signal }
    );

    window.addEventListener(DialogCloseEvent.eventName, this.pauseMedia.bind(this), { signal });

    // Setup intersection observer for lazy loading
    this.#setupIntersectionObserver();

    // If content is already present (pre-rendered) ensure player is initialized
    this.#initializeFromExistingContent();

    // Handle autoplay if specified
    if (this.hasAttribute("data-autoplay")) {
      this.#handleAutoplay();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
    this.#cleanupIntersectionObserver();
    this.#cleanupPlayer();
  }

  /**
   * Detect media type from content or attributes
   */
  detectMediaType() {
    const template = this.querySelector("template");
    if (!template) return "";

    const content = template.content.firstElementChild;
    if (!content) return "";

    if (content.tagName === "VIDEO") return "video";
    if (content.tagName === "IFRAME") {
      const src = content.src || content.dataset.src;
      if (src?.includes("youtube")) return "youtube";
      if (src?.includes("vimeo")) return "vimeo";
      return "iframe";
    }
    if (content.tagName === "MODEL-VIEWER") return "model";

    return "unknown";
  }

  /**
   * Get parent media-gallery if exists
   * @returns {HTMLElement|null}
   */
  #getMediaGalleryParent() {
    return this.closest("media-gallery");
  }

  /**
   * Pause all other media in the same gallery (direct pause to avoid race condition)
   */
  #pauseOtherMediaInGallery() {
    const mediaGallery = this.#getMediaGalleryParent();
    if (!mediaGallery) return;

    const allMedia = mediaGallery.querySelectorAll("deferred-media");
    allMedia.forEach((media) => {
      if (media !== this) {
        media.pauseMedia();
      }
    });
  }

  /**
   * Dispatch media started event for coordination
   */
  #dispatchMediaStartedEvent() {
    const mediaGallery = this.#getMediaGalleryParent();
    const isAutoplay = this.hasAttribute("data-autoplay");
    const event = new MediaStartedPlayingEvent(this, isAutoplay);

    if (mediaGallery) {
      // Dispatch to gallery (bubbles to document for global coordination)
      mediaGallery.dispatchEvent(event);
    } else {
      // Standalone: dispatch to document for global coordination
      document.dispatchEvent(event);
    }
  }

  /**
   * Setup intersection observer for lazy loading
   */
  #setupIntersectionObserver() {
    if (!("IntersectionObserver" in window)) return;

    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.#isIntersecting = entry.isIntersecting;
          const isLoaded = this.getAttribute("data-media-loaded");

          if (entry.isIntersecting) {
            if (this.hasAttribute("data-autoplay") && !this.hasAttribute("data-autoplay-blocked")) {
              if (!isLoaded) {
                this.showDeferredMedia();
              } else {
                this.playMedia();
              }
            } else if (!isLoaded) {
              // Preload APIs/resources to reduce user-perceived latency on click
              this.#preloadContent();
            }
          } else {
            // Pause when leaving the viewport (idempotent)
            this.pauseMedia();
          }
        });
      },
      {
        rootMargin: "0px",
        threshold: 0.1,
      }
    );

    this.#intersectionObserver.observe(this);
  }

  /**
   * Cleanup intersection observer
   */
  #cleanupIntersectionObserver() {
    if (this.#intersectionObserver) {
      this.#intersectionObserver.disconnect();
      this.#intersectionObserver = null;
    }
  }

  /**
   * Handle autoplay functionality
   */
  #handleAutoplay() {
    if (this.#mediaType !== "video") return;

    // Check if autoplay is allowed
    const canAutoplay = this.#checkAutoplaySupport();

    if (!canAutoplay) {
      this.setAttribute("data-autoplay-blocked", "");
      return;
    }
  }

  /**
   * Check if autoplay is supported
   */
  #checkAutoplaySupport() {
    // Check for mobile devices
    // if (window.matchMedia("(max-width: 1023px)").matches) {
    //   return false;
    // }

    // Check for reduced motion preference
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return false;
    }

    return true;
  }

  /**
   * Preload resources (APIs) without inserting media elements
   */
  async #preloadContent() {
    if (this.#isLoading || this.#isPreloaded || this.getAttribute("data-media-loaded")) return;

    this.#isLoading = true;
    this.setAttribute("data-loading", "");
    try {
      // Determine media type from template without inserting DOM
      const type = this.#mediaType || this.detectMediaType();
      switch (type) {
        case "youtube":
          await this.#loadYouTubeAPI();
          break;
        case "vimeo":
          await this.#loadVimeoAPI();
          break;
        case "model":
          if (window.Shopify?.loadFeatures) {
            await new Promise((resolve) =>
              Shopify.loadFeatures([
                {
                  name: "model-viewer-ui",
                  version: "1.0",
                  onLoad: () => resolve(),
                },
              ])
            );
          }
          break;
        default:
          // For HTML5 video we cannot preload without creating an element; skip
          break;
      }
      this.#isPreloaded = true;
    } catch (error) {
      console.error("Failed to preload resources:", error);
      this.setAttribute("data-error", "");
    } finally {
      this.removeAttribute("data-loading");
      this.#isLoading = false;
    }
  }

  /**
   * Updates the visual hint for play/pause state
   */
  updatePlayPauseHint(isPlaying) {
    const toggleMediaButton = this.refs.toggleMediaButton;

    if (toggleMediaButton instanceof HTMLElement) {
      toggleMediaButton.classList.remove("hidden");
      const playIcon = toggleMediaButton.querySelector(".icon-play");
      if (playIcon) playIcon.classList.toggle("hidden", isPlaying);
      const pauseIcon = toggleMediaButton.querySelector(".icon-pause");
      if (pauseIcon) pauseIcon.classList.toggle("hidden", !isPlaying);
    }
  }

  /**
   * Check if parent carousel is currently dragging
   * @returns {boolean}
   */
  #isCarouselDragging() {
    const carousel = this.closest("carousel-slider, slideshow-component, lookbook-carousel");
    if (!carousel) return false;

    const swiper = carousel.swiperInstance;
    if (!swiper || swiper.destroyed) return false;

    return (
      swiper.touching === true ||
      (swiper.touchEventsData && swiper.touchEventsData.isTouched === true) ||
      swiper.animating === true
    );
  }

  /**
   * Whether playback should be attempted now (avoids play during carousel drag/fade).
   * @returns {boolean}
   */
  #canAttemptPlayback() {
    if (this.#isCarouselDragging()) {
      return false;
    }

    if (this.hasAttribute("data-autoplay") && this.#intersectionObserver && !this.#isIntersecting) {
      return false;
    }

    return true;
  }

  /**
   * Resolve a playable URL from a video element (supports Shopify <source> tags).
   * @param {HTMLVideoElement} videoElement
   * @returns {string|null}
   */
  #getVideoSourceFromElement(videoElement) {
    if (videoElement.currentSrc && !this.#isVideoSrcCorrupted(videoElement.currentSrc)) {
      return videoElement.currentSrc;
    }

    const src = videoElement.getAttribute("src");
    if (src && !this.#isVideoSrcCorrupted(src)) {
      return src;
    }

    const sourceEl = videoElement.querySelector("source[src]");
    if (sourceEl?.src && !this.#isVideoSrcCorrupted(sourceEl.src)) {
      return sourceEl.src;
    }

    return null;
  }

  /**
   * @param {HTMLVideoElement} videoElement
   * @returns {boolean}
   */
  #hasPlayableVideoSources(videoElement) {
    return Boolean(this.#getVideoSourceFromElement(videoElement));
  }

  /**
   * Shows the deferred media content
   */
  showDeferredMedia = async () => {
    if (this.#isLoading) return;

    // Skip if carousel is currently dragging (but allow autoplay to proceed)
    // Only prevent user-initiated clicks, not autoplay behavior
    if (this.#isCarouselDragging() && !this.hasAttribute("data-autoplay")) return;

    try {
      this.setAttribute("data-loading", "");
      await this.loadContent(false);
      // When controls are disabled we rely on our own UI; ensure playback starts on click
      if (this.hasAttribute("data-disable-controls") || this.hasAttribute("data-autoplay")) {
        await this.playMedia();
      }
      this.dispatchEvent(new CustomEvent("deferred-media:play", { bubbles: true }));
    } catch (error) {
      console.error("Failed to show deferred media:", error);
      this.handleError(error);
    }
  };

  /**
   * Loads the content with enhanced error handling
   */
  async loadContent(focus = true) {
    if (this.getAttribute("data-media-loaded")) return;

    // Pause other media in gallery BEFORE loading (prevents race condition)
    this.#pauseOtherMediaInGallery();

    // Dispatch event when starting to load
    this.#dispatchMediaStartedEvent();

    const template = this.querySelector("template");
    if (!template) {
      throw new Error("No template content found");
    }

    const content = template.content.firstElementChild?.cloneNode(true);
    if (!content) {
      throw new Error("No content found in template");
    }

    this.setAttribute("data-media-loaded", "true");
    this.appendChild(content);

    if (focus && content instanceof HTMLElement) {
      if (!content.hasAttribute("tabindex") && content.tabIndex < 0) {
        content.tabIndex = -1;
      }
      content.focus();
    }

    this.refs.deferredMediaPlayButton?.classList.add("deferred-media__playing");
    this.refs.deferredMediaPlayButton?.setAttribute("tabindex", "-1");

    // Initialize player based on media type
    await this.#initializePlayer(content);

    return content;
  }

  /**
   * Initialize player based on media type
   */
  async #initializePlayer(content) {
    switch (this.#mediaType) {
      case "video":
        await this.#initializeVideoPlayer(content);
        break;
      case "youtube":
        await this.#initializeYouTubePlayer(content);
        break;
      case "vimeo":
        await this.#initializeVimeoPlayer(content);
        break;
      default:
        // Handle other media types
        break;
    }
  }

  /**
   * Initialize player if content was pre-rendered (data-media-loaded already set)
   */
  #initializeFromExistingContent() {
    if (!this.hasAttribute("data-media-loaded") || this.#player) return;

    // Find first playable element that is not inside <template>
    let content = null;
    for (const child of this.children) {
      if (child.tagName === "TEMPLATE" || child.tagName === "BUTTON") {
        continue;
      }
      if (child.tagName === "VIDEO" || child.tagName === "IFRAME" || child.tagName === "MODEL-VIEWER") {
        content = child;
        break;
      }
    }

    if (!content) return;

    // Adjust media type if needed based on element
    if (!this.#mediaType || this.#mediaType === "unknown") {
      if (content.tagName === "VIDEO") this.#mediaType = "video";
      else if (content.tagName === "IFRAME") {
        const src = /** @type {HTMLIFrameElement} */ (content).src;
        if (src?.includes("youtube")) this.#mediaType = "youtube";
        else if (src?.includes("vimeo")) this.#mediaType = "vimeo";
        else this.#mediaType = "iframe";
      } else if (content.tagName === "MODEL-VIEWER") {
        this.#mediaType = "model";
      }
    }

    // Initialize the player for this content
    void this.#initializePlayer(/** @type {any} */ (content));

    // Content is already present in DOM, ensure loading state is cleared
    this.removeAttribute("data-loading");
  }

  /**
   * Update volume button state
   * @param {HTMLVideoElement|Object} player - Video element, player object, or object with muted property
   */
  async updateVolumeButton(player) {
    const { toggleVolumeButton } = this.refs;
    if (!toggleVolumeButton) return;

    const muteIcon = toggleVolumeButton.querySelector(".icon-mute");
    const unMuteIcon = toggleVolumeButton.querySelector(".icon-unmute");

    let isMuted = false;

    // Handle different player types
    if (player instanceof HTMLVideoElement) {
      // HTML5 video
      isMuted = player.muted;
    } else if (player && typeof player === "object" && "muted" in player) {
      // Direct muted state (for optimistic updates)
      isMuted = player.muted;
    } else if (this.#mediaType === "youtube" && this.#player) {
      // YouTube player
      try {
        isMuted = await this.#player.isMuted?.();
      } catch (error) {
        console.warn("Failed to get YouTube muted state:", error);
        isMuted = false;
      }
    } else if (this.#mediaType === "vimeo" && this.#player) {
      // Vimeo player
      try {
        isMuted = await this.#player.getMuted?.();
      } catch (error) {
        console.warn("Failed to get Vimeo muted state:", error);
        isMuted = false;
      }
    }

    // Show mute icon when muted (current state)
    // Show unmute icon when not muted (current state)
    muteIcon && muteIcon.classList.toggle("hidden", !isMuted);
    unMuteIcon && unMuteIcon.classList.toggle("hidden", isMuted);
  }

  /**
   * Initialize HTML5 video player
   */
  async #initializeVideoPlayer(videoElement) {
    if (!(videoElement instanceof HTMLVideoElement)) return;

    const video = videoElement;
    const { toggleVolumeButton } = this.refs;

    if (toggleVolumeButton) {
      await this.updateVolumeButton(video);

      toggleVolumeButton.addEventListener(
        "click",
        async () => {
          video.muted = !video.muted;
          await this.updateVolumeButton(video);
        },
        {
          signal: this.#abortController.signal,
        }
      );
    }

    // Set up video event listeners
    video.addEventListener("play", () => {
      this.isPlaying = true;
      this.setAttribute("data-playing", "");
      this.updatePlayPauseHint(true);
      this.removeAttribute("data-suspended");

      // Coordinate: pause other media (handles native controls / external play triggers)
      this.#pauseOtherMediaInGallery();
      this.#dispatchMediaStartedEvent();

      setTimeout(() => {
        this.removeAttribute("data-loading");
      }, 2000); // Delay to wait video full rendered
    });

    video.addEventListener("pause", () => {
      this.#clearPlaybackState();
    });

    video.addEventListener("ended", () => {
      this.#clearPlaybackState();
    });

    video.addEventListener("error", (error) => {
      this.handleError(error);
    });

    // Handle autoplay restrictions with suspended state
    if (video.hasAttribute("autoplay")) {
      try {
        await video.play();
      } catch (error) {
        if (error.name === "NotAllowedError") {
          this.setAttribute("data-suspended", "");
          this.setAttribute("data-autoplay-blocked", "");
          video.controls = true;

          // Set poster from previous element if available
          const replacementImageSrc = video.previousElementSibling?.currentSrc;
          if (replacementImageSrc) {
            video.poster = replacementImageSrc;
          }
        }
      }
    }

    this.#player = video;

    // Store original src for corruption detection
    this.#originalVideoSrc = this.#getVideoSourceFromElement(video);
  }

  /**
   * Initialize YouTube player
   */
  async #initializeYouTubePlayer(iframeElement) {
    if (!(iframeElement instanceof HTMLIFrameElement)) return;

    // Load YouTube API if not already loaded
    if (!window.YT || !window.YT.Player) {
      await this.#loadYouTubeAPI();
    }

    const player = new YT.Player(iframeElement, {
      events: {
        onReady: async () => {
          this.#player = player;

          // Setup volume button for YouTube - await to ensure state is initialized
          await this.#setupYouTubeVolumeButton();

          // Attempt autoplay when ready and visible
          if (
            this.hasAttribute("data-autoplay") &&
            !this.hasAttribute("data-autoplay-blocked") &&
            this.#isIntersecting
          ) {
            try {
              this.#player.playVideo?.();
            } catch (_) {
              /* noop */
            }
          }
        },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.PLAYING) {
            this.isPlaying = true;
            this.setAttribute("data-playing", "");
            this.updatePlayPauseHint(true);
            this.removeAttribute("data-loading");

            this.#pauseOtherMediaInGallery();
            this.#dispatchMediaStartedEvent();
          } else if (event.data === YT.PlayerState.ENDED || event.data === YT.PlayerState.PAUSED) {
            this.isPlaying = false;
            this.removeAttribute("data-playing");
            this.updatePlayPauseHint(false);
          }
        },
        onError: (error) => {
          this.handleError(error);
        },
      },
    });
  }

  /**
   * Initialize Vimeo player
   */
  async #initializeVimeoPlayer(iframeElement) {
    if (!(iframeElement instanceof HTMLIFrameElement)) return;

    // Load Vimeo API if not already loaded
    if (!window.Vimeo || !window.Vimeo.Player) {
      await this.#loadVimeoAPI();
    }

    const player = new Vimeo.Player(iframeElement);

    player.on("loaded", async () => {
      this.#player = player;

      // Setup volume button for Vimeo - await to ensure state is initialized
      await this.#setupVimeoVolumeButton();

      if (this.hasAttribute("data-autoplay") && !this.hasAttribute("data-autoplay-blocked") && this.#isIntersecting) {
        try {
          await this.#player.play?.();
        } catch (_) {
          /* noop */
        }
      }
    });

    player.on("play", () => {
      this.isPlaying = true;
      this.setAttribute("data-playing", "");
      this.updatePlayPauseHint(true);
      this.removeAttribute("data-loading");

      this.#pauseOtherMediaInGallery();
      this.#dispatchMediaStartedEvent();
    });

    player.on("pause", () => {
      this.isPlaying = false;
      this.removeAttribute("data-playing");
      this.updatePlayPauseHint(false);
    });

    player.on("ended", () => {
      this.isPlaying = false;
      this.removeAttribute("data-playing");
      this.updatePlayPauseHint(false);
    });

    player.on("error", (error) => {
      this.handleError(error);
    });

    this.#player = player;
  }

  /**
   * Load YouTube API
   */
  async #loadYouTubeAPI() {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }

      // Reuse a single pending promise across instances
      const pendingKey = "__ytApiPending__";
      if (window[pendingKey]) {
        window[pendingKey].then(resolve, reject);
        return;
      }

      const p = new Promise((res, rej) => {
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (typeof previous === "function") previous();
          res();
        };

        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onload = () => {
          // wait for onYouTubeIframeAPIReady to fire
        };
        script.onerror = rej;
        document.head.appendChild(script);
      });

      window[pendingKey] = p.finally(() => {
        delete window[pendingKey];
      });

      window[pendingKey].then(resolve, reject);
    });
  }

  /**
   * Load Vimeo API
   */
  async #loadVimeoAPI() {
    return new Promise((resolve, reject) => {
      if (window.Vimeo && window.Vimeo.Player) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://player.vimeo.com/api/player.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Setup volume button for YouTube player
   */
  async #setupYouTubeVolumeButton() {
    const { toggleVolumeButton } = this.refs;
    if (!toggleVolumeButton || !this.#player) return;

    // Update button state initially - await to ensure state is set
    await this.updateVolumeButton(this.#player);

    // Add click handler
    toggleVolumeButton.addEventListener(
      "click",
      async () => {
        try {
          const isMuted = await this.#player.isMuted?.();
          const newMutedState = !isMuted;

          if (isMuted) {
            this.#player.unMute?.();
          } else {
            this.#player.mute?.();
          }

          // Update button immediately with new state (optimistic update)
          // Then verify after a short delay
          await this.updateVolumeButton({ muted: newMutedState });

          // Verify state after a short delay to ensure sync
          setTimeout(async () => {
            await this.updateVolumeButton(this.#player);
          }, 150);
        } catch (error) {
          console.warn("Failed to toggle YouTube volume:", error);
        }
      },
      {
        signal: this.#abortController.signal,
      }
    );
  }

  /**
   * Setup volume button for Vimeo player
   */
  async #setupVimeoVolumeButton() {
    const { toggleVolumeButton } = this.refs;
    if (!toggleVolumeButton || !this.#player) return;

    // Update button state initially - await to ensure state is set
    await this.updateVolumeButton(this.#player);

    // Add click handler
    toggleVolumeButton.addEventListener(
      "click",
      async () => {
        try {
          const isMuted = await this.#player.getMuted?.();
          const newMutedState = !isMuted;

          await this.#player.setMuted?.(newMutedState);

          // Update button immediately with new state (optimistic update)
          // Then verify after a short delay
          await this.updateVolumeButton({ muted: newMutedState });

          // Verify state after a short delay to ensure sync
          setTimeout(async () => {
            await this.updateVolumeButton(this.#player);
          }, 150);
        } catch (error) {
          console.warn("Failed to toggle Vimeo volume:", error);
        }
      },
      {
        signal: this.#abortController.signal,
      }
    );
  }

  /**
   * Toggle play/pause state of the media
   */
  toggleMedia() {
    // Skip if carousel is currently dragging
    if (this.#isCarouselDragging()) return;

    // If content hasn't been loaded yet, load (and play if applicable)
    if (!this.getAttribute("data-media-loaded")) {
      this.showDeferredMedia();
      return;
    }

    if (this.isPlaying) {
      this.pauseMedia();
    } else {
      this.playMedia();
    }
  }

  /**
   * Check if video src has been corrupted by comparing with original
   */
  #hasVideoSrcChanged(currentSrc) {
    if (!currentSrc || !this.#originalVideoSrc) return false;

    // Simple comparison: if current src differs from original, it's potentially corrupted
    return currentSrc !== this.#originalVideoSrc;
  }

  /**
   * Check if video src is corrupted (optimized)
   */
  #isVideoSrcCorrupted(src) {
    if (!src) return false;

    try {
      const url = new URL(src);

      // Quick check: page query params = corrupted
      if (url.searchParams.has("variant") || url.searchParams.has("section_id")) {
        return true;
      }

      const path = url.pathname.toLowerCase();
      const host = url.hostname;

      // Quick check: CDN or video file extension = valid
      if (host.includes("cdn") || /\.(mp4|webm|ogg|avi|mov)/.test(path)) {
        return false;
      }

      // Quick check: page paths = corrupted
      return /\/(products|collections|pages|blogs)\//.test(path);
    } catch {
      return false;
    }
  }

  /**
   * Recover video with valid src (unified recovery method)
   */
  #recoverVideoSrc(videoElement) {
    const bestSrc = this.#getBestVideoSrc(videoElement);
    if (bestSrc && videoElement.src !== bestSrc) {
      videoElement.src = bestSrc;
      videoElement.load();
      return true;
    }
    return false;
  }

  /**
   * Get the best available video src (fallback chain)
   */
  #getBestVideoSrc(videoElement) {
    // Check if stored original src is corrupted and clear it
    if (this.#originalVideoSrc && this.#isVideoSrcCorrupted(this.#originalVideoSrc)) {
      this.#originalVideoSrc = null;
    }

    // Priority: originalVideoSrc > currentSrc > template src > remove src
    if (this.#originalVideoSrc) {
      return this.#originalVideoSrc;
    }

    // If no original src stored yet, use currentSrc if it looks valid
    if (videoElement.currentSrc && !this.#isVideoSrcCorrupted(videoElement.currentSrc)) {
      // Store this as original if we don't have one yet and it's not corrupted
      if (!this.#originalVideoSrc) {
        this.#originalVideoSrc = videoElement.currentSrc;
      }
      return videoElement.currentSrc;
    }

    const fromElement = this.#getVideoSourceFromElement(videoElement);
    if (fromElement) {
      if (!this.#originalVideoSrc) {
        this.#originalVideoSrc = fromElement;
      }
      return fromElement;
    }

    // Try template as last resort
    const template = this.querySelector("template");
    if (template) {
      const templateVideo = template.content.querySelector("video");
      if (templateVideo) {
        const templateSrc = this.#getVideoSourceFromElement(templateVideo);
        if (templateSrc) {
          if (!this.#originalVideoSrc) {
            this.#originalVideoSrc = templateSrc;
          }
          return templateSrc;
        }
      }
    }

    return null;
  }

  /**
   * Play media with enhanced error handling
   */
  async playMedia() {
    if (this.#isLoading) return;

    // If media not loaded yet, trigger load first
    if (!this.getAttribute("data-media-loaded")) {
      this.showDeferredMedia();
      return;
    }

    if (!this.#canAttemptPlayback()) {
      return;
    }

    // CRITICAL: Pause other media DIRECTLY before playing (prevents race condition)
    // This is especially important when multiple media return to viewport simultaneously
    this.#pauseOtherMediaInGallery();

    // Dispatch event for other listeners (defensive)
    this.#dispatchMediaStartedEvent();

    try {
      switch (this.#mediaType) {
        case "video":
          if (this.#player instanceof HTMLVideoElement) {
            // Check if video src has changed or is corrupted and restore if needed
            const srcCorrupted =
              this.#hasVideoSrcChanged(this.#player.src) || this.#isVideoSrcCorrupted(this.#player.src);

            if (srcCorrupted) {
              if (!this.#recoverVideoSrc(this.#player) && !this.#hasPlayableVideoSources(this.#player)) {
                this.#player.removeAttribute("src");
              }
            }

            if (!this.#hasPlayableVideoSources(this.#player)) {
              this.#recoverVideoSrc(this.#player);
            }

            if (!this.#hasPlayableVideoSources(this.#player)) {
              return;
            }

            await this.#player.play();
          } else {
            // Try to find existing video element and reinitialize
            const existingVideo = this.querySelector("video");
            if (existingVideo) {
              // Ensure we have a valid src before proceeding
              this.#recoverVideoSrc(existingVideo);

              if (!this.#hasPlayableVideoSources(existingVideo)) {
                return;
              }

              await this.#initializeVideoPlayer(existingVideo);
              if (this.#player) {
                await this.#player.play();
              }
            }
          }
          break;
        case "youtube":
          if (this.#player && this.#player.playVideo) {
            this.#player.playVideo();
          }
          break;
        case "vimeo":
          if (this.#player && this.#player.play) {
            await this.#player.play();
          }
          break;
        default:
          // Handle other media types
          break;
      }

      this.isPlaying = true;
      this.updatePlayPauseHint(this.isPlaying);
    } catch (error) {
      console.error("Failed to play media:", error);
      this.handleError(error);
    }
  }

  /**
   * React to attribute changes
   */
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "data-media-type") {
      this.#mediaType = this.getAttribute("data-media-type") || this.#mediaType;
    }

    if (
      name === "data-autoplay" &&
      this.isConnected &&
      this.#isIntersecting &&
      this.getAttribute("data-media-loaded") &&
      !this.hasAttribute("data-autoplay-blocked")
    ) {
      // Pause other media before playing (same as playMedia)
      this.#pauseOtherMediaInGallery();
      this.#dispatchMediaStartedEvent();
      this.playMedia();
    }
  }

  /**
   * Pause media
   */
  pauseMedia() {
    try {
      switch (this.#mediaType) {
        case "video":
          if (this.#player instanceof HTMLVideoElement) {
            this.#player.pause();
          }
          break;
        case "youtube":
          if (this.#player && this.#player.pauseVideo) {
            this.#player.pauseVideo();
          }
          break;
        case "vimeo":
          if (this.#player && this.#player.pause) {
            this.#player.pause();
          }
          break;
        default:
          // Handle other media types
          break;
      }
    } catch (error) {
      console.error("Failed to pause media:", error);
    }

    this.#clearPlaybackState();
  }

  /**
   * Handle errors gracefully
   */
  handleError(error) {
    // Provide user-friendly error logging
    const errorType = error?.name || error?.constructor?.name || "Unknown";
    const errorMessage = error?.message || "Media playback issue";

    // Only log actual problematic errors, not expected browser behaviors
    if (this.#shouldLogError(error)) {
      console.warn(`Media ${errorType}: ${errorMessage}`, {
        mediaType: this.#mediaType,
        hasPlayer: !!this.#player,
        isPlaying: this.isPlaying,
      });
    }

    this.setAttribute("data-error", "");
    this.removeAttribute("data-loading");

    // Dispatch error event
    this.dispatchEvent(
      new CustomEvent("deferred-media:error", {
        bubbles: true,
        detail: { error },
      })
    );
  }

  /**
   * Determine if error should be logged (filter out expected errors)
   */
  #shouldLogError(error) {
    const errorName = error?.name || "";
    const errorMessage = error?.message || "";

    // Filter out expected/harmless errors
    const expectedErrors = [
      "AbortError", // Normal when switching slides quickly
      "NotAllowedError", // Expected autoplay restriction
      "NotSupportedError", // Often during carousel fade / slide not ready to play
    ];

    // Filter out DOM events that aren't actual errors
    if (error instanceof Event && error.type === "error") {
      // These are often normal browser events during slide transitions
      return false;
    }

    // Don't log expected error types
    if (expectedErrors.includes(errorName)) {
      return false;
    }

    // Don't log errors during normal operation transitions
    if (errorMessage.includes("interrupted by a new load request")) {
      return false;
    }

    return true;
  }

  /**
   * Cleanup player resources
   */
  #cleanupPlayer() {
    if (this.#player) {
      // Cleanup based on player type
      if (this.#player instanceof HTMLVideoElement) {
        this.#player.pause();
        this.#player.src = "";
        this.#player.load();
      } else if (this.#player && typeof this.#player.destroy === "function") {
        this.#player.destroy();
      }
      this.#player = null;
    }
  }

  /**
   * Reset UI/state when media is not playing (do not rely on the pause event — it may not fire).
   */
  #clearPlaybackState() {
    const { deferredMediaPlayButton: button } = this.refs;
    this.isPlaying = false;
    this.removeAttribute("data-playing");
    button?.classList.remove("deferred-media__playing");
    button?.removeAttribute("tabindex");
    this.updatePlayPauseHint(false);
  }

  /**
   * Get current player state
   */
  getPlayerState() {
    return {
      isPlaying: this.isPlaying,
      isLoading: this.#isLoading,
      mediaType: this.#mediaType,
      hasError: this.hasAttribute("data-error"),
      isLoaded: this.hasAttribute("data-media-loaded"),
    };
  }
}

if (!customElements.get("deferred-media")) {
  customElements.define("deferred-media", DeferredMedia);
}

/**
 * Enhanced product model component that extends DeferredMedia
 * for Shopify's 3D model viewer functionality
 */
class ProductModel extends DeferredMedia {
  /** @type {AbortController} */
  #abortController = new AbortController();

  /** @type {any} */
  modelViewerUI = null;

  /** @type {Function|null} */
  #originalModelViewerPlay = null;

  /** @type {Function|null} */
  #originalModelViewerPause = null;

  async loadContent(focus = true) {
    const content = await super.loadContent(focus);

    // Load Shopify model viewer UI
    if (window.Shopify?.loadFeatures) {
      Shopify.loadFeatures([
        {
          name: "model-viewer-ui",
          version: "1.0",
          onLoad: this.setupModelViewerUI.bind(this),
        },
      ]);
    }

    return content;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();

    // Cleanup model viewer UI
    if (this.modelViewerUI && typeof this.modelViewerUI.destroy === "function") {
      this.modelViewerUI.destroy();
      this.modelViewerUI = null;
    }

    // Clear wrapped methods to prevent calling destroyed methods
    this.#originalModelViewerPlay = null;
    this.#originalModelViewerPause = null;
  }

  pauseMedia() {
    super.pauseMedia();
    // Use original pause method to avoid infinite loop
    // Never call this.modelViewerUI.pause() directly as it's wrapped to call pauseMedia()
    if (typeof this.#originalModelViewerPause === "function" && this.modelViewerUI) {
      try {
        // Check if modelViewerUI still has pause method (not destroyed)
        if (typeof this.modelViewerUI.pause === "function") {
          this.#originalModelViewerPause();
        }
      } catch (error) {
        // If original method fails, silently handle (modelViewerUI might be destroyed)
        // Only log if it's not a common destroy-related error
        if (!error.message?.includes("is not a function") && !error.message?.includes("destroyed")) {
          console.warn("Failed to call original pause method:", error);
        }
      }
    }
    // Only call modelViewerUI.pause() if it hasn't been wrapped yet (original method not stored)
    else if (this.modelViewerUI && typeof this.modelViewerUI.pause === "function" && !this.#originalModelViewerPause) {
      try {
        this.modelViewerUI.pause();
      } catch (error) {
        // Silently handle if modelViewerUI is destroyed
        if (!error.message?.includes("is not a function") && !error.message?.includes("destroyed")) {
          console.warn("Failed to pause model viewer:", error);
        }
      }
    }
    this.setAttribute("data-playing", "false");

    // Dispatch model interaction event - paused
    const target = this.closest(".shopify-section") || document;
    target.dispatchEvent(new ModelInteractionEvent(this, false));
  }

  async playMedia() {
    await super.playMedia();
    // Use original play method to avoid infinite loop
    // Never call this.modelViewerUI.play() directly as it's wrapped to call playMedia()
    if (typeof this.#originalModelViewerPlay === "function" && this.modelViewerUI) {
      try {
        // Check if modelViewerUI still has play method (not destroyed)
        if (typeof this.modelViewerUI.play === "function") {
          this.#originalModelViewerPlay();
        }
      } catch (error) {
        // If original method fails, silently handle (modelViewerUI might be destroyed)
        // Only log if it's not a common destroy-related error
        if (!error.message?.includes("is not a function") && !error.message?.includes("destroyed")) {
          console.warn("Failed to call original play method:", error);
        }
      }
    }
    // Only call modelViewerUI.play() if it hasn't been wrapped yet (original method not stored)
    else if (this.modelViewerUI && typeof this.modelViewerUI.play === "function" && !this.#originalModelViewerPlay) {
      try {
        this.modelViewerUI.play();
      } catch (error) {
        // Silently handle if modelViewerUI is destroyed
        if (!error.message?.includes("is not a function") && !error.message?.includes("destroyed")) {
          console.warn("Failed to play model viewer:", error);
        }
      }
    }
    this.setAttribute("data-playing", "true");

    // Dispatch model interaction event - playing
    const target = this.closest(".shopify-section") || document;
    target.dispatchEvent(new ModelInteractionEvent(this, true));
  }

  /**
   * Setup Shopify Model Viewer UI with enhanced error handling
   * @param {Error[]} errors
   */
  async setupModelViewerUI(errors) {
    if (errors) {
      console.error("Model viewer UI load errors:", errors);
      return;
    }

    if (!Shopify.ModelViewerUI) {
      await this.#waitForModelViewerUI();
    }

    if (!Shopify.ModelViewerUI) {
      console.warn("Shopify.ModelViewerUI not available after waiting");
      return;
    }

    const element = this.querySelector("model-viewer");
    if (!element) {
      console.warn("No model-viewer element found");
      return;
    }

    const signal = this.#abortController.signal;

    try {
      this.modelViewerUI = new Shopify.ModelViewerUI(element);
      if (!this.modelViewerUI) {
        console.warn("Failed to create ModelViewerUI instance");
        return;
      }

      // Wrap modelViewerUI.play() to ensure it goes through playMedia() method
      // This ensures other media in gallery are paused when model plays
      // Store original methods to avoid infinite loop
      if (this.modelViewerUI.play) {
        this.#originalModelViewerPlay = this.modelViewerUI.play.bind(this.modelViewerUI);
        this.modelViewerUI.play = () => {
          // Call playMedia() which will pause other media and dispatch event
          this.playMedia();
        };
      }

      // Wrap modelViewerUI.pause() to ensure it goes through pauseMedia() method
      if (this.modelViewerUI.pause) {
        this.#originalModelViewerPause = this.modelViewerUI.pause.bind(this.modelViewerUI);
        this.modelViewerUI.pause = () => {
          // Call pauseMedia() for consistency
          this.pauseMedia();
        };
      }

      // Start playback if model is ready
      this.playMedia();

      // Setup interaction handlers for tap detection
      this.#setupModelInteractions(element, signal);
    } catch (error) {
      console.error("Error setting up model viewer UI:", error);
      this.handleError(error);
    }
  }

  /**
   * Setup model viewer interaction handlers
   * @param {HTMLElement} element
   * @param {AbortSignal} signal
   */
  #setupModelInteractions(element, signal) {
    // Track pointer for drag vs tap detection
    let pointerStartX = 0;
    let pointerStartY = 0;

    element.addEventListener(
      "pointerdown",
      (/** @type {PointerEvent} */ event) => {
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
      },
      { signal }
    );

    element.addEventListener(
      "click",
      (/** @type {PointerEvent} */ event) => {
        const distanceX = Math.abs(event.clientX - pointerStartX);
        const distanceY = Math.abs(event.clientY - pointerStartY);
        const totalDistance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

        // Higher threshold to accommodate UI changes (was 10, now 50)
        if (totalDistance < 10) {
          const isCurrentlyPlaying = this.getAttribute("data-playing") === "true";

          if (isCurrentlyPlaying) {
            // Model is playing, so pause it
            this.pauseMedia();
          } else {
            // Model is paused, so play it
            this.playMedia();
          }
        }
        // If totalDistance >= 10, it's a drag - don't toggle
      },
      { signal }
    );
  }

  /**
   * Wait for Shopify.ModelViewerUI to be available
   * Necessary for Safari where ModelViewerUI may not be immediately available
   * @returns {Promise<void>}
   */
  async #waitForModelViewerUI() {
    const maxAttempts = 10;
    const interval = 50; // 50ms intervals

    for (let i = 0; i < maxAttempts; i++) {
      if (Shopify.ModelViewerUI) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /**
   * Get enhanced player state including model viewer info
   */
  getPlayerState() {
    const baseState = super.getPlayerState();
    return {
      ...baseState,
      hasModelViewerUI: !!this.modelViewerUI,
      modelViewerReady: !!this.modelViewerUI && !!this.querySelector("model-viewer"),
    };
  }
}

if (!customElements.get("product-model")) {
  customElements.define("product-model", ProductModel);
}
