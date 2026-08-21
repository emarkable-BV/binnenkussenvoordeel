import { Component } from "@theme/component";
import { getFocusableElements, throttle, isMobileBreakpoint, mediaQueryMobile } from "@theme/utilities";
import { Swiper, Navigation, Pagination, Mousewheel, Autoplay, EffectFade } from "@theme/swiper";
import { setupCounter } from "@theme/carousel-features/counter";
import {
  setupNavigationPosition,
  performNavigationPositionCalculation,
} from "@theme/carousel-features/navigation-position";
import { setupThumbnails, destroyThumbnailSwiper } from "@theme/carousel-features/thumbnails";
import { setupProgressbarAutoplay } from "@theme/carousel-features/progressbar-autoplay";

/** Breakpoint (px) for mobile/desktop - aligns with theme media query (width <= 767px) */
const MOBILE_DESKTOP_BREAKPOINT = 768;

export class CarouselComponent extends Component {
  /** @type {Swiper | null} */
  swiperInstance = null;
  /** @type {string} */
  counterFormat = "{current} / {total}";
  /** @type {Record<string, any> | null} */
  lastResolvedOptions = null;

  /**
   * Enforce a container ref for Swiper root.
   * @type {string[]}
   */
  requiredRefs = ["container"];
  /** @type {NodeListOf<HTMLElement> | null} */
  paginationItems = null;
  /** @type {NodeListOf<HTMLElement> | null} */
  progressBars = null;
  /** @type {HTMLElement | null} */
  combinedProgressBar = null;
  /** @type {HTMLElement | null} */
  combinedText = null;
  /** @type {Array<{text: string, id: string, index: number}> | null} */
  slideData = null;
  /** @type {boolean} */
  shouldUseCombined = false;
  /** @type {string | null} */
  #currentPaginationMode = null;
  /** @type {string | null} */
  get currentPaginationMode() {
    return this.#currentPaginationMode;
  }
  set currentPaginationMode(value) {
    this.#currentPaginationMode = value;
  }
  /** @type {number | null} */
  autoplayDelay = null;
  /** @type {(() => void) | null} */
  resizeCleanup = null;
  /** @type {boolean} */
  #isRecreating = false;
  /** @type {Swiper | null} */
  thumbnailSwiper = null;
  /** @type {NodeListOf<HTMLElement> | null} */
  thumbnailItems = null;
  /** @type {boolean} */
  thumbnailsEnabled = false;
  /** @type {IntersectionObserver | null} */
  navigationPositionObserver = null;
  /** @type {IntersectionObserver | null} */
  #accessibilityObserver = null;
  /** @type {boolean} */
  #accessibilitySetup = false;
  /** @type {number | null} */
  progressAnimationRafId = null;
  /** @type {boolean} */
  #isDestroyed = false;
  /** @type {Promise<any> | null} */
  #customPaginationModule = null;
  /** @type {string | null} */
  #currentBreakpoint = null;
  /** @type {Record<string, Function | null>} */
  #swiperEventListeners = {
    breakpoint: null,
    slideChange: null,
    slidesUpdated: null,
    slideChangeTransitionEnd: null,
  };
  /** @type {number | null} */
  #autoHeightUpdateTimeout = null;
  /** @type {number | null} */
  #lastAutoHeightActiveIndex = null;
  /** @type {number | null} */
  #autoHeightUpdateRafId = null;
  /** @type {boolean} */
  #isUpdatingAutoHeight = false;
  /** @type {boolean} */
  #isHandlingResize = false;
  /** @type {boolean} */
  #isHandlingBreakpointAutoHeight = false;

  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  static get observedAttributes() {
    return ["data-options"];
  }

  connectedCallback() {
    super.connectedCallback();
    this.#isDestroyed = false;
    this.#accessibilitySetup = false;
    if (this.swiperInstance) {
      this.#destroySwiper();
    }

    const rawOptions = this.#parseOptions();
    if (rawOptions["custom-pagination"]) {
      this.#loadCustomPaginationFeature().catch(() => {});
    }

    requestAnimationFrame(() => {
      this.#initSwiper();
    });
  }

  updatedCallback() {
    super.updatedCallback();
    requestAnimationFrame(() => {
      if (!this.refs?.container) return;
      if (this.swiperInstance && !this.swiperInstance.destroyed) {
        // Don't clean styles — preserve template inline styles (CSS custom properties)
        // that were restored by morph. The new Swiper instance will overwrite its own styles.
        this.#destroySwiper(true, false);
      }
      this.#initSwiper();
    });
  }

  disconnectedCallback() {
    this.#isDestroyed = true;
    this.thumbnailsEnabled = false;

    this.#cleanupSwiperEventListeners();

    if (this.#autoHeightUpdateTimeout) {
      clearTimeout(this.#autoHeightUpdateTimeout);
      this.#autoHeightUpdateTimeout = null;
    }
    if (this.#autoHeightUpdateRafId) {
      cancelAnimationFrame(this.#autoHeightUpdateRafId);
      this.#autoHeightUpdateRafId = null;
    }
    this.#lastAutoHeightActiveIndex = null;

    this.#destroySwiper();

    if (this.resizeCleanup) {
      this.resizeCleanup();
      this.resizeCleanup = null;
    }

    if (this.#accessibilityObserver) {
      this.#accessibilityObserver.disconnect();
      this.#accessibilityObserver = null;
    }
    this.#accessibilitySetup = false;

    if (this.navigationPositionObserver) {
      this.navigationPositionObserver.disconnect();
      this.navigationPositionObserver = null;
    }

    if (this.progressAnimationRafId !== null) {
      cancelAnimationFrame(this.progressAnimationRafId);
      this.progressAnimationRafId = null;
    }
  }

  attributeChangedCallback(name, _oldValue, _newValue) {
    if (name === "data-options") {
      this.#destroySwiper();
      requestAnimationFrame(() => {
        this.#initSwiper();
      });
    }
  }

  #initSwiper() {
    if (this.swiperInstance) return;

    const container = /** @type {HTMLElement | undefined} */ (this.refs.container);
    if (!container) return;

    this.#currentBreakpoint = isMobileBreakpoint() ? "mobile" : "desktop";

    const rawOptions = this.#parseOptions();
    const optionsWithElements = this.#resolveElementSelectors(rawOptions);
    const finalOptions = this.#resolveModules(optionsWithElements);
    this.finalOptions = finalOptions;

    this.#setupResizeHandler(finalOptions);

    const shouldDestroy = this.#shouldDestroyForViewport(finalOptions);

    if (shouldDestroy) {
      this.#destroySwiper();
      this.#setControlsHidden(true, finalOptions);
      return;
    }

    this.#setControlsHidden(false, finalOptions);
    this.#createSwiper(finalOptions).catch((error) => {
      if (!this.#isDestroyed) {
        console.error("CarouselComponent: failed to create Swiper", error);
      }
    });
  }

  get slideClass() {
    return this.finalOptions?.slideClass || "swiper-slide";
  }

  /** Properties that Swiper adds to slides — remove these, keep the rest (template styles). */
  static #SWIPER_SLIDE_PROPERTIES = new Set([
    "width",
    "height",
    "margin",
    "margin-left",
    "margin-right",
    "margin-top",
    "margin-bottom",
    "margin-inline-start",
    "margin-inline-end",
    "margin-block-start",
    "margin-block-end",
    "transform",
    "-webkit-transform",
    "-ms-transform",
  ]);

  /**
   * Remove only Swiper-added properties from style string; preserve template styles
   * (CSS vars, -webkit-mask-image, overflow, etc.).
   */
  #extractTemplateStyles(styleAttr) {
    if (!styleAttr || typeof styleAttr !== "string") return "";
    return styleAttr
      .split(";")
      .map((decl) => decl.trim())
      .filter((decl) => {
        const colonIndex = decl.indexOf(":");
        if (colonIndex <= 0) return false;
        const prop = decl.slice(0, colonIndex).trim().toLowerCase();
        return !CarouselComponent.#SWIPER_SLIDE_PROPERTIES.has(prop);
      })
      .join("; ")
      .trim();
  }

  #destroySwiper(keepOptions = false, cleanStyles = true, preserveTemplateStyles = false) {
    this.#cleanupSwiperEventListeners();

    if (this.swiperInstance) {
      const slideElements =
        cleanStyles && preserveTemplateStyles && this.swiperInstance.slides?.length
          ? Array.from(this.swiperInstance.slides)
          : [];
      const savedSlideStyles = slideElements.map((slide) => this.#extractTemplateStyles(slide.getAttribute("style")));

      // Clear inline height set by autoHeight so grid layout can flow naturally
      const wrapper = this.swiperInstance.wrapperEl;
      if (wrapper) {
        wrapper.style.height = "";
        wrapper.closest(".swiper")?.classList.remove("swiper-autoheight");
      }
      try {
        this.swiperInstance.destroy(true, cleanStyles);
      } catch (_e) {
        // Ignore
      }

      slideElements.forEach((slide, i) => {
        if (savedSlideStyles[i]) {
          slide.setAttribute("style", savedSlideStyles[i]);
        }
      });

      this.swiperInstance = null;
    }
    destroyThumbnailSwiper(this);
    this.lastResolvedOptions = null;
    if (!keepOptions) {
      this.finalOptions = null;
    }

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
  }

  async #loadCustomPaginationFeature() {
    if (this.#customPaginationModule) return this.#customPaginationModule;
    try {
      this.#customPaginationModule = import("@theme/carousel-features/custom-pagination");
      return this.#customPaginationModule;
    } catch (error) {
      console.error("CarouselComponent: failed to load custom-pagination feature", error);
      this.#customPaginationModule = Promise.reject(error);
      return this.#customPaginationModule;
    }
  }

  async #callCustomPaginationFunction(functionName, ...args) {
    if (this.#isDestroyed) return;
    try {
      const paginationModule = await this.#loadCustomPaginationFeature();
      if (this.#isDestroyed) return;
      const fn = await paginationModule[functionName];
      if (typeof fn === "function") {
        fn(this, ...args);
      }
    } catch (error) {
      // Silently fail - feature not available
    }
  }

  async #createSwiper(finalOptions) {
    const container = /** @type {HTMLElement | undefined} */ (this.refs.container);
    if (!container) return;

    const slides = container.querySelectorAll(`.${this.slideClass}`);
    if (slides.length === 0) {
      this.#setControlsHidden(true, finalOptions);
      return;
    }

    const swiperOptions = {
      ...finalOptions,
      preloadImages: false,
      lazy: false,
      watchSlidesProgress: finalOptions.watchSlidesProgress ?? false,
      watchSlidesVisibility: finalOptions.watchSlidesVisibility ?? false,
    };

    try {
      this.swiperInstance = new Swiper(container, swiperOptions);

      if (this.#isDestroyed) {
        this.swiperInstance.destroy();
        return;
      }

      this.lastResolvedOptions = swiperOptions;
      setupCounter(this, swiperOptions);

      if (swiperOptions["custom-pagination"]) {
        try {
          const paginationModule = await this.#loadCustomPaginationFeature();
          if (this.#isDestroyed) return;
          const { setupCustomPagination } = await paginationModule;
          setupCustomPagination(this, swiperOptions);
        } catch (error) {
          console.error("CarouselComponent: failed to setup custom pagination", error);
        }
      }

      if (swiperOptions.thumbnails?.enabled) {
        this.thumbnailsEnabled = true;
        setupThumbnails(this, swiperOptions.thumbnails);
      }

      setupNavigationPosition(this, swiperOptions);
      if (this.resizeCleanup) {
        this.resizeCleanup();
        this.resizeCleanup = null;
      }
      this.#setupResizeHandler(swiperOptions);
      this.#checkSlidesPerView(swiperOptions);
      this.#setupSwiperEventListeners(swiperOptions);

      if (swiperOptions.pagination?.type === "progressbar" && swiperOptions.autoplay) {
        setupProgressbarAutoplay(this, swiperOptions);
      }

      if (swiperOptions["custom-pagination"]) {
        const initialIndex = this.lastResolvedOptions?.loop
          ? (this.swiperInstance.realIndex ?? 0)
          : (this.swiperInstance.activeIndex ?? 0);
        this.#callCustomPaginationFunction("updateActivePagination", initialIndex);
      }

      this.#registerDesignModeEvents();
      this.#setupAccessibilityLazy();

      this.dispatchEvent(
        new CustomEvent("carousel:ready", {
          bubbles: false,
          detail: { swiperInstance: this.swiperInstance },
        })
      );
    } catch (error) {
      console.error("CarouselComponent: failed to initialize Swiper", error);
    }
  }

  /**
   * Sets up lazy initialization of accessibility features when carousel enters viewport.
   * This optimizes performance by deferring accessibility setup until needed.
   */
  #setupAccessibilityLazy() {
    if (this.#accessibilitySetup) return;

    // Check if IntersectionObserver is available
    if (!("IntersectionObserver" in window)) {
      // Fallback: setup immediately if IntersectionObserver is not available
      this.#setupAccessibility();
      return;
    }

    // Check if carousel is already in viewport
    const { container } = this.refs;
    const rect = container.getBoundingClientRect();
    const isInViewport =
      rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;

    if (isInViewport) {
      // Setup immediately if already in viewport
      this.#setupAccessibility();
      return;
    }

    // Setup IntersectionObserver to detect when carousel enters viewport
    this.#accessibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.#accessibilitySetup) {
            this.#setupAccessibility();
            // Cleanup observer after setup

            if (this.#accessibilityObserver) {
              this.#accessibilityObserver.disconnect();
              this.#accessibilityObserver = null;
            }
          }
        });
      },
      {
        // Start setup slightly before entering viewport for better UX
        rootMargin: "50px",
        threshold: 0.01,
      }
    );

    this.#accessibilityObserver.observe(container);
  }

  /**
   * Sets up accessibility features for keyboard navigation.
   * When a focusable element receives focus, the carousel scrolls to the slide containing that element.
   */
  #setupAccessibility() {
    if (this.#accessibilitySetup) return;
    this.#accessibilitySetup = true;

    const { container } = this.refs;
    const focusableEls = getFocusableElements(container);
    focusableEls &&
      focusableEls.forEach((el) => {
        el.addEventListener("focusin", () => {
          if (!el.matches(":focus-visible")) return;

          const slide = el.closest(`.${this.slideClass}`);
          if (!slide || !this.swiperInstance) return;

          const index = this.swiperInstance.slides.indexOf(slide);
          if (index !== -1 && index !== this.swiperInstance.activeIndex) {
            this.goToSlide(index, 0, false);
          }
        });
      });
  }

  #parseOptions() {
    const attr = this.getAttribute("data-options");
    if (attr) {
      try {
        return JSON.parse(attr);
      } catch (_e) {
        console.error("CarouselComponent: invalid JSON in data-options");
      }
    }

    const script = this.querySelector('script[ref="config"][type="application/json"]');
    if (script && script.textContent) {
      try {
        return JSON.parse(script.textContent);
      } catch (_e) {
        console.error('CarouselComponent: invalid JSON in <script ref="config"> content');
      }
    }

    return {};
  }

  #resolveModules(options) {
    const MODULE_MAP = {
      Navigation,
      Pagination,
      Mousewheel,
      Autoplay,
      EffectFade,
    };
    let moduleNames = Array.isArray(options.modules) ? options.modules : [];

    if (moduleNames.length === 0) {
      if (options.navigation) moduleNames.push("Navigation");
      if (options.pagination) moduleNames.push("Pagination");
      if (options.mousewheel) moduleNames.push("Mousewheel");
      if (options.autoplay) moduleNames.push("Autoplay");
      if (options.effect === "fade" || options.fadeEffect) moduleNames.push("EffectFade");
    }
    const modules = [];
    for (const name of moduleNames) {
      const mod = MODULE_MAP[name];
      if (mod && !modules.includes(mod)) modules.push(mod);
    }
    return { ...options, modules };
  }

  #resolveElementSelectors(options) {
    const resolved = { ...options };

    const resolve = (selectorOrEl) => {
      if (typeof selectorOrEl !== "string") return selectorOrEl;
      try {
        return this.querySelector(selectorOrEl);
      } catch (_e) {
        return selectorOrEl;
      }
    };

    const byRef = (name) => {
      const isMobile = isMobileBreakpoint();
      const targetBreakpoint = isMobile ? "mobile" : "desktop";
      const targetContainer = this.querySelector(`[data-controls-breakpoint="${targetBreakpoint}"]`);

      if (targetContainer) {
        const computedStyle = window.getComputedStyle(targetContainer);
        if (computedStyle.display !== "none" && computedStyle.visibility !== "hidden") {
          const el = targetContainer.querySelector(`[data-ref="${name}"]`);
          if (el) {
            el.setAttribute("ref", name);
            return /** @type {HTMLElement} */ (el);
          }
        }
      }

      const fallbackEl = this.querySelector(`[ref="${name}"]`);
      if (fallbackEl) {
        const parentContainer = fallbackEl.closest("[data-controls-breakpoint]");
        if (parentContainer) {
          const computedStyle = window.getComputedStyle(parentContainer);
          if (computedStyle.display === "none" || computedStyle.visibility === "hidden") {
            return null;
          }
        }
      }
      return /** @type {HTMLElement | null} */ (fallbackEl);
    };

    const paginationRef = byRef("pagination");
    if (resolved.pagination === true) {
      resolved.pagination = {};
    }
    if (!resolved.pagination && paginationRef) {
      resolved.pagination = { el: paginationRef };
    } else if (resolved.pagination && typeof resolved.pagination === "object") {
      const el = resolved.pagination.el ?? paginationRef;
      resolved.pagination = { ...resolved.pagination, el: resolve(el) };
    }

    if (resolved.navigation === true) {
      resolved.navigation = {};
    }
    if (resolved.navigation && typeof resolved.navigation === "object") {
      const next = resolved.navigation.nextEl ?? byRef("next");
      const prev = resolved.navigation.prevEl ?? byRef("prev");
      resolved.navigation = {
        ...resolved.navigation,
        nextEl: resolve(next),
        prevEl: resolve(prev),
      };
    } else {
      const next = byRef("next");
      const prev = byRef("prev");
      if (next || prev) {
        resolved.navigation = {
          nextEl: next ?? undefined,
          prevEl: prev ?? undefined,
        };
      }
    }

    if (resolved.scrollbar && typeof resolved.scrollbar === "object") {
      const el = resolved.scrollbar.el ?? byRef("scrollbar");
      resolved.scrollbar = { ...resolved.scrollbar, el: resolve(el) };
    }

    const counterRef = byRef("counter");
    const hasCounterOption = Object.prototype.hasOwnProperty.call(options, "counter");
    if (resolved.counter === true) {
      resolved.counter = {};
    }
    if (typeof resolved.counter === "string") {
      resolved.counter = { format: resolved.counter };
    }
    if (!hasCounterOption && counterRef) {
      resolved.counter = { el: counterRef, format: this.counterFormat };
    } else if (resolved.counter && typeof resolved.counter === "object") {
      const el = resolved.counter.el ?? counterRef;
      resolved.counter = {
        ...resolved.counter,
        el: resolve(el),
        format: typeof resolved.counter.format === "string" ? resolved.counter.format : this.counterFormat,
      };
    }

    if (resolved.navigationPosition && typeof resolved.navigationPosition === "object") {
      resolved.navigationPosition = {
        enabled: resolved.navigationPosition.enabled !== false,
        selector: resolved.navigationPosition.selector || "img",
        offset: Number(resolved.navigationPosition.offset) || 0,
        fallback: resolved.navigationPosition.fallback || "center",
        ...resolved.navigationPosition,
      };
    }

    return resolved;
  }

  #shouldDestroyForViewport(options) {
    const w = window.innerWidth || 0;
    const below = Number(options.destroyBelow);
    const above = Number(options.destroyAbove);
    const isMobile = isMobileBreakpoint();

    const useMediaQuery = (val) => val === MOBILE_DESKTOP_BREAKPOINT;
    const shouldDestroyBelow = !Number.isNaN(below) && (useMediaQuery(below) ? isMobile : w < below);
    const shouldDestroyAbove = !Number.isNaN(above) && (useMediaQuery(above) ? !isMobile : w >= above);
    return shouldDestroyBelow || shouldDestroyAbove;
  }

  #setControlsHidden(hidden, options) {
    const toggle = (el) => {
      if (!(el instanceof HTMLElement)) return;
      el.classList.toggle("hidden-control", hidden);
    };

    const hasResponsiveControls = this.querySelector("[data-controls-breakpoint]");

    if (!hasResponsiveControls) {
      const controlsEl = this.querySelector('[ref="controls"]');
      if (controlsEl instanceof HTMLElement) {
        controlsEl.classList.toggle("hidden", hidden);
      }

      const controlsWrapper = this.querySelector(".carousel__controls");
      if (controlsWrapper instanceof HTMLElement) {
        controlsWrapper.classList.toggle("hidden-control", hidden);
      }
    }

    // Pagination
    const pagEl = options?.pagination?.el || this.querySelector('[ref="pagination"]');
    if (options && Object.prototype.hasOwnProperty.call(options, "pagination")) {
      toggle(pagEl);
    }

    // Navigation
    const nextEl = options?.navigation?.nextEl || this.querySelector('[ref="next"]');
    const prevEl = options?.navigation?.prevEl || this.querySelector('[ref="prev"]');
    if (options && Object.prototype.hasOwnProperty.call(options, "navigation")) {
      toggle(nextEl);
      toggle(prevEl);
    }

    const counterEl = this.querySelector('[ref="counter"]');
    if (options && Object.prototype.hasOwnProperty.call(options, "counter")) {
      const shouldHide = hidden || !options.counter;
      if (counterEl instanceof HTMLElement) {
        counterEl.classList.toggle("hidden", shouldHide);
      }
    }

    // Thumbnails
    const thumbnailContainer = this.querySelector('[ref="thumbnails"]');
    if (thumbnailContainer && options?.thumbnails?.enabled) {
      thumbnailContainer.classList.toggle("hidden", hidden);
    }
  }

  #getCurrentSlidesPerView(options) {
    const windowWidth = window.innerWidth;

    if (options.breakpoints && typeof options.breakpoints === "object") {
      const matchingBreakpoint = this.#findMatchingBreakpoint(Object.keys(options.breakpoints), windowWidth);

      if (matchingBreakpoint !== null) {
        const breakpointConfig = options.breakpoints[matchingBreakpoint];
        const perView = breakpointConfig.slidesPerView;

        if (typeof perView === "number") {
          return perView;
        } else if (perView === "auto") {
          return this.swiperInstance?.params?.slidesPerView || 1;
        }
      }
    }

    const basePerView = options.slidesPerView;
    if (typeof basePerView === "number") {
      return basePerView;
    } else if (basePerView === "auto") {
      return this.swiperInstance?.params?.slidesPerView || 1;
    }

    return 1;
  }

  #findMatchingBreakpoint(breakpointKeys, windowWidth) {
    const availableBreakpoints = breakpointKeys
      .filter((key) => !isNaN(Number(key)))
      .map((key) => Number(key))
      .sort((a, b) => a - b);

    let matchingBreakpoint = null;
    for (const bp of availableBreakpoints) {
      if (windowWidth >= bp) {
        matchingBreakpoint = bp;
      } else {
        break;
      }
    }
    return matchingBreakpoint;
  }

  #checkSlidesPerView(options) {
    if (!this.swiperInstance) return;

    const slides = this.querySelectorAll(`.${this.slideClass}`);
    if (slides.length === 0) return;

    const controlsEl = this.querySelector('[ref="controls"]');
    if (!controlsEl) return;

    let minSlidesNeeded = this.swiperInstance.params?.slidesPerView;

    if (typeof minSlidesNeeded !== "number") {
      minSlidesNeeded = this.#getCurrentSlidesPerView(options);
    }
    minSlidesNeeded = typeof minSlidesNeeded === "number" ? minSlidesNeeded : parseFloat(minSlidesNeeded) || 1;

    const shouldShowControls = slides.length > minSlidesNeeded;

    if (shouldShowControls) {
      controlsEl.classList.remove("hidden-control");
    } else {
      controlsEl.classList.add("hidden-control");
    }
  }

  /**
   * Setup Swiper event listeners for breakpoint, autoHeight, and custom pagination
   * @param {Record<string, any>} options
   */
  #setupSwiperEventListeners(options) {
    this.#cleanupSwiperEventListeners();
    if (!this.swiperInstance) return;

    // breakpoint fires SYNCHRONOUSLY during Swiper's onResize() BEFORE slidesUpdated
    this.#swiperEventListeners.breakpoint = () => {
      if (this.#isRecreating || this.#isHandlingResize) return;

      this.#checkSlidesPerView(options);

      if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        this.swiperInstance.wrapperEl &&
        !this.swiperInstance.params?.autoHeight
      ) {
        if (this.#autoHeightUpdateTimeout) {
          clearTimeout(this.#autoHeightUpdateTimeout);
          this.#autoHeightUpdateTimeout = null;
        }
        if (this.#autoHeightUpdateRafId) {
          cancelAnimationFrame(this.#autoHeightUpdateRafId);
          this.#autoHeightUpdateRafId = null;
        }
        this.#isUpdatingAutoHeight = false;
        this.#isHandlingBreakpointAutoHeight = false;

        requestAnimationFrame(() => {
          if (this.swiperInstance && !this.#isDestroyed && !this.swiperInstance.params?.autoHeight) {
            this.swiperInstance.wrapperEl.style.height = "";
            this.swiperInstance.el.classList.remove("swiper-autoheight");
          }
        });
      } else if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        this.swiperInstance.params?.autoHeight &&
        !this.#isUpdatingAutoHeight &&
        !this.#isHandlingBreakpointAutoHeight
      ) {
        this.#isHandlingBreakpointAutoHeight = true;
        this.#lastAutoHeightActiveIndex = null;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (
              this.swiperInstance &&
              !this.#isDestroyed &&
              this.swiperInstance.params?.autoHeight &&
              !this.#isUpdatingAutoHeight
            ) {
              this.#debouncedUpdateAutoHeight();
            }
            this.#isHandlingBreakpointAutoHeight = false;
          });
        });
      }
    };
    this.swiperInstance.on("breakpoint", this.#swiperEventListeners.breakpoint);

    // slidesUpdated fires AFTER breakpoint during Swiper's onResize()
    this.#swiperEventListeners.slidesUpdated = () => {
      if (this.#isRecreating || this.#isHandlingResize) return;

      if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        this.swiperInstance.params?.autoHeight &&
        !this.swiperInstance.animating &&
        !this.#isUpdatingAutoHeight &&
        !this.#isHandlingBreakpointAutoHeight
      ) {
        this.#lastAutoHeightActiveIndex = null;
        this.#debouncedUpdateAutoHeight();
      } else if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        !this.swiperInstance.params?.autoHeight &&
        this.swiperInstance.wrapperEl
      ) {
        requestAnimationFrame(() => {
          if (this.swiperInstance && !this.#isDestroyed && !this.swiperInstance.params?.autoHeight) {
            this.swiperInstance.wrapperEl.style.height = "";
            this.swiperInstance.el.classList.remove("swiper-autoheight");
          }
        });
      }
    };
    this.swiperInstance.on("slidesUpdated", this.#swiperEventListeners.slidesUpdated);

    this.#swiperEventListeners.slideChangeTransitionEnd = () => {
      if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        this.swiperInstance.params?.autoHeight &&
        !this.#isUpdatingAutoHeight
      ) {
        const currentActiveIndex = this.swiperInstance.activeIndex;
        if (this.#lastAutoHeightActiveIndex !== currentActiveIndex) {
          this.#lastAutoHeightActiveIndex = currentActiveIndex;
          this.#debouncedUpdateAutoHeight();
        }
      }
    };
    this.swiperInstance.on("slideChangeTransitionEnd", this.#swiperEventListeners.slideChangeTransitionEnd);

    if (options["custom-pagination"]) {
      this.#swiperEventListeners.slideChange = () => {
        const currentIndex = this.lastResolvedOptions?.loop
          ? (this.swiperInstance.realIndex ?? 0)
          : (this.swiperInstance.activeIndex ?? 0);
        this.#callCustomPaginationFunction("updateActivePagination", currentIndex);
      };
      this.swiperInstance.on("slideChange", this.#swiperEventListeners.slideChange);
    }
  }

  /**
   * Cleanup Swiper event listeners
   */
  #cleanupSwiperEventListeners() {
    if (!this.swiperInstance) return;

    Object.entries(this.#swiperEventListeners).forEach(([event, handler]) => {
      if (handler) {
        this.swiperInstance.off(event, handler);
        this.#swiperEventListeners[event] = null;
      }
    });
  }

  #debouncedUpdateAutoHeight() {
    if (this.#isUpdatingAutoHeight) return;

    if (this.#autoHeightUpdateTimeout) {
      clearTimeout(this.#autoHeightUpdateTimeout);
      this.#autoHeightUpdateTimeout = null;
    }
    if (this.#autoHeightUpdateRafId) {
      cancelAnimationFrame(this.#autoHeightUpdateRafId);
      this.#autoHeightUpdateRafId = null;
    }

    this.#autoHeightUpdateTimeout = setTimeout(() => {
      this.#autoHeightUpdateRafId = requestAnimationFrame(() => {
        if (this.swiperInstance && !this.#isDestroyed && this.swiperInstance.params?.autoHeight) {
          this.#isUpdatingAutoHeight = true;
          try {
            this.swiperInstance.updateAutoHeight();
          } finally {
            this.#isUpdatingAutoHeight = false;
          }
        }
        this.#autoHeightUpdateTimeout = null;
        this.#autoHeightUpdateRafId = null;
      });
    }, 16);
  }

  #setupResizeHandler(options) {
    if (this.resizeCleanup) {
      this.resizeCleanup();
      this.resizeCleanup = null;
    }

    this.#currentBreakpoint = isMobileBreakpoint() ? "mobile" : "desktop";

    const runViewportCheck = async () => {
      if (this.#isDestroyed) return;
      if (this.#isHandlingResize) return;
      this.#isHandlingResize = true;

      try {
        const freshRawOptions = this.#parseOptions();
        const freshOptionsWithElements = this.#resolveElementSelectors(freshRawOptions);
        const freshFinalOptions = this.#resolveModules(freshOptionsWithElements);

        const shouldDestroy = this.#shouldDestroyForViewport(freshFinalOptions);
        const isActive = !!this.swiperInstance;

        if (shouldDestroy && isActive) {
          this.#destroySwiper(false, true, true); // Remove Swiper styles, restore template styles
          this.#setControlsHidden(true, freshFinalOptions);
          return;
        }

        if (!shouldDestroy && !isActive) {
          this.finalOptions = freshFinalOptions;
          this.#setControlsHidden(false, freshFinalOptions);

          if (!this.#isRecreating) {
            this.#isRecreating = true;
            try {
              await this.#createSwiper(freshFinalOptions).catch((error) => {
                if (!this.#isDestroyed) {
                  console.error("CarouselComponent: failed to recreate Swiper", error);
                }
              });
            } finally {
              this.#isRecreating = false;
            }
          }
          return;
        }

        const newBreakpoint = isMobileBreakpoint() ? "mobile" : "desktop";
        const breakpointChanged = this.#currentBreakpoint !== newBreakpoint;

        if (breakpointChanged) {
          this.#currentBreakpoint = newBreakpoint;
          const hasResponsiveControls = this.querySelector("[data-controls-breakpoint]");

          if (hasResponsiveControls && this.swiperInstance && !this.#isRecreating) {
            this.#isRecreating = true;

            try {
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              this.#destroySwiper(true, true, true); // Remove Swiper styles, restore template styles
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

              if (!this.finalOptions) {
                this.#isRecreating = false;
                return;
              }

              const optionsWithElements = this.#resolveElementSelectors(this.#parseOptions());
              const finalOptions = this.#resolveModules(optionsWithElements);
              this.finalOptions = finalOptions;
              await this.#createSwiper(finalOptions);
            } finally {
              this.#isRecreating = false;
            }
          }
        }

        if (this.swiperInstance && !this.#isRecreating) {
          this.#checkSlidesPerView(freshFinalOptions);

          if (freshFinalOptions?.navigationPosition?.enabled) {
            performNavigationPositionCalculation(this, freshFinalOptions);
          }

          if (this.slideData) {
            this.#callCustomPaginationFunction("updateCombinedPaginationState");
          }
        }
      } finally {
        this.#isHandlingResize = false;
      }
    };

    const handleResize = throttle(runViewportCheck, 150);
    window.addEventListener("resize", handleResize);

    const hasMobileDesktopBreakpoint =
      Number(options?.destroyAbove) === MOBILE_DESKTOP_BREAKPOINT ||
      Number(options?.destroyBelow) === MOBILE_DESKTOP_BREAKPOINT;
    const handleMediaQueryChange = () => {
      if (!this.#isDestroyed) runViewportCheck();
    };
    if (hasMobileDesktopBreakpoint) {
      mediaQueryMobile.addEventListener("change", handleMediaQueryChange);
    }

    this.resizeCleanup = () => {
      window.removeEventListener("resize", handleResize);
      handleResize.cancel?.();
      if (hasMobileDesktopBreakpoint) {
        mediaQueryMobile.removeEventListener("change", handleMediaQueryChange);
      }
    };
  }

  get sectionId() {
    return this.getAttribute("data-section-id");
  }

  #registerDesignModeEvents() {
    if (!this.finalOptions?.shopifyBlocks || !Shopify.designMode || !this.sectionId) return;

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;
    const isLoop = ["true", true].includes(this.swiperInstance.params?.loop);

    document.addEventListener(
      "shopify:block:select",
      (event) => {
        if (event.detail.sectionId != this.sectionId) return;

        const slideEl = event.target.closest(`.${this.slideClass}`);
        if (!slideEl) return;

        const index = isLoop
          ? Number(slideEl.dataset.swiperSlideIndex)
          : Array.from(slideEl.parentElement?.children ?? []).indexOf(slideEl);
        this.goToSlide(index);
      },
      { signal }
    );
  }

  /**
   * Navigates to a specific slide.
   * @param {number} index - The slide index to navigate to
   * @param {number} [speed] - Transition speed in ms. If not provided, uses Swiper's default speed
   * @param {boolean} [runCallbacks] - Whether to run transition callbacks. Defaults to true
   */
  goToSlide(index, speed, runCallbacks = true) {
    if (!this.swiperInstance || this.swiperInstance.destroyed) return;

    // Pause autoplay if running to prevent conflicts and delays
    if (this.swiperInstance.autoplay?.running) {
      this.swiperInstance.autoplay.pause();
    }

    if (this.lastResolvedOptions?.loop) {
      this.swiperInstance.slideToLoop(index, speed, runCallbacks);
    } else {
      this.swiperInstance.slideTo(index, speed, runCallbacks);
    }
  }
}

if (!customElements.get("carousel-slider")) {
  customElements.define("carousel-slider", CarouselComponent);
}

export { CarouselComponent as default };
