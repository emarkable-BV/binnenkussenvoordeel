import { Component } from "@theme/component";
import {
  isMobileBreakpoint,
  isDesktopBreakpoint,
  mediaBreakpointMobile,
  mediaBreakpointTablet,
  mediaQueryLarge,
  mediaQueryDesktop,
  getLenis,
  fetchConfig,
  formatCurrency,
  mediaQueryMobile,
  debounce,
  prefersReducedMotion,
  isTouch,
  CookieManager,
  getLocalStorage,
  setLocalStorage,
  hasLocalStorage,
  isRTL,
  mediaHoverFine,
  waitForEvent,
  removeScrollLockClass,
  onDocumentReady,
  getFocusableElements,
} from "@theme/utilities";
import { inView, animate, scroll } from "@theme/animation";
import { ResizeNotifier } from "@theme/critical";
import { CarouselComponent } from "@theme/carousel";
import { DialogCloseEvent, acquireThemeScrollLock, releaseThemeScrollLock } from "@theme/dialog";
import { AccordionComponent } from "@theme/modules";
import { morph } from "@theme/morph";
import {
  ThemeEvents,
  VariantUpdateEvent,
  CartGroupedSections,
  CartAddEvent,
  CartErrorEvent,
  CartUpdateEvent,
} from "@theme/events";
import "@theme/badge-float";

class BasicHeader extends HTMLElement {
  constructor() {
    super();
  }

  get headerSection() {
    return document.querySelector(".header-section");
  }

  get enableTransparent() {
    return this.dataset.enableTransparent === "true";
  }

  connectedCallback() {
    this.#init();

    new ResizeNotifier(this.#setHeight.bind(this)).observe(this);

    if (Shopify.designMode) {
      const section = this.closest(".shopify-section");
      section.addEventListener("shopify:section:load", this.#init.bind(this));
      section.addEventListener("shopify:section:unload", this.#init.bind(this));
      section.addEventListener("shopify:section:reorder", this.#init.bind(this));
    }
  }

  #init() {
    this.#setHeight();

    if (this.enableTransparent) {
      this.headerSection.classList.add("header-transparent");
    }
  }

  #setHeight() {
    // Defer ALL layout reads to next frame to avoid force reflow on page load
    requestAnimationFrame(() => {
      // Batch reads and writes together in the same frame
      const offsetHeight = Math.round(this.offsetHeight);
      document.documentElement.style.setProperty("--header-height", `${offsetHeight}px`);
    });
  }
}
customElements.define("basic-header", BasicHeader, { extends: "header" });

class StickyHeader extends BasicHeader {
  // Private fields for cleanup
  #boundHandleScroll = null;
  #resizeObserver = null;

  constructor() {
    super();

    this.classes = {
      pinned: "header-pinned",
      headerScrolled: "header-scrolled",
      headerSticky: "header-sticky",
    };

    this.currentScrollTop = 0;
    this.scrollThreshold = 200;
    this.scrollDirection = "none";
    this.scrollDistance = 0;
    this.lenis = null; // Lenis instance for smooth scrolling
    this.hasScrolledPastThreshold = false; // Track if user has scrolled past threshold
    this._isPinned = false;
    this._isScrolled = false;
  }

  get isAlwaysSticky() {
    return this.dataset.stickyType === "always";
  }

  connectedCallback() {
    super.connectedCallback();

    this.#cacheInitialHeaderPosition();
    this.#initStickyHeader();
    this.#checkInitialScrollState();

    // Re-cache header position on resize (header height might change)
    if (!this.#resizeObserver) {
      this.#resizeObserver = new ResizeObserver(() => {
        this.#cacheInitialHeaderPosition();
      });
      this.#resizeObserver.observe(this.headerSection);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();

    if (this.#boundHandleScroll) {
      if (this.lenis) {
        // Remove Lenis scroll listener
        this.lenis.off("scroll", this.#boundHandleScroll);
      } else {
        // Remove native scroll listener
        window.removeEventListener("scroll", this.#boundHandleScroll);
      }
      this.#boundHandleScroll = null;
    }

    if (this.#resizeObserver) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }
  }

  #cacheInitialHeaderPosition() {
    // Defer layout measurements to next frame to avoid force reflow on page load
    requestAnimationFrame(() => {
      const headerElement = this.headerSection?.querySelector(".header");
      const headerBounds = headerElement?.getBoundingClientRect() || this.headerSection.getBoundingClientRect();
      // Use Lenis scroll position if available, otherwise fallback to native scroll
      const scrollY = this.lenis ? this.lenis.scroll : window.scrollY;

      this.initialHeaderTop = headerBounds.top + scrollY;
      this.initialHeaderHeight = headerBounds.height;

      // Calculate scroll threshold: if header has offset from top (e.g., top: 3rem),
      // stick when scroll reaches that offset. Otherwise, stick when scroll passes header bottom.
      const headerOffsetFromTop = headerBounds.top;

      if (headerOffsetFromTop > 0) {
        this.stickThreshold = headerOffsetFromTop;
      } else {
        this.stickThreshold = this.initialHeaderTop + this.initialHeaderHeight;
      }

      // Ensure stickThreshold is valid
      if (this.stickThreshold <= 0 || !this.initialHeaderHeight) {
        this.stickThreshold = Math.max(this.initialHeaderHeight || 0, 1);
      }
    });
  }

  #initStickyHeader() {
    this.headerSection.classList.add(this.classes.headerSticky);
    this.headerSection.dataset.stickyType = this.dataset.stickyType;
    this.#boundHandleScroll = this.#handleScroll.bind(this);

    // Use Lenis smooth scroll if available, otherwise fallback to native scroll
    this.lenis = getLenis();

    if (this.lenis) {
      // Listen to Lenis scroll events (shared instance with other sections)
      this.lenis.on("scroll", this.#boundHandleScroll);
    } else {
      // Fallback to native scroll if Lenis not available yet
      window.addEventListener("scroll", this.#boundHandleScroll, { passive: true });
    }
  }

  #checkInitialScrollState() {
    requestAnimationFrame(() => {
      const scrollTop = this.lenis ? this.lenis.scroll : window.scrollY;

      if (!this.stickThreshold || this.stickThreshold <= 0) {
        this.#cacheInitialHeaderPosition();
      }

      const shouldStick = scrollTop >= this.stickThreshold;

      if (shouldStick) {
        this.hasScrolledPastThreshold = true;
        if (!this._isScrolled) {
          this._isScrolled = true;
          this.headerSection.classList.add(this.classes.headerScrolled);
        }
        if (!this._isPinned) {
          this._isPinned = true;
          document.body.classList.add(this.classes.pinned);
        }
      } else {
        this.hasScrolledPastThreshold = false;
        if (this._isScrolled) {
          this._isScrolled = false;
          this.headerSection.classList.remove(this.classes.headerScrolled);
        }
        if (this._isPinned) {
          this._isPinned = false;
          document.body.classList.remove(this.classes.pinned);
        }
      }

      this.currentScrollTop = scrollTop;
    });
  }

  #handleScroll() {
    if (!this.lenis) {
      const retryLenis = getLenis();
      if (retryLenis) {
        this.lenis = retryLenis;
        window.removeEventListener("scroll", this.#boundHandleScroll);
        this.lenis.on("scroll", this.#boundHandleScroll);
      }
    }

    const scrollTop = this.lenis ? this.lenis.scroll : window.scrollY;

    if (!this.stickThreshold || this.stickThreshold <= 0) {
      this.#cacheInitialHeaderPosition();
    }

    const shouldStick = scrollTop >= this.stickThreshold;
    const headerBoundsBottom = this.initialHeaderTop + (this.initialHeaderHeight || 0);

    this.#updateScrollMetrics(scrollTop);

    if (shouldStick) {
      this.#handleScrolledPastHeader(scrollTop, headerBoundsBottom);
    } else if (this.isAlwaysSticky && this.hasScrolledPastThreshold) {
      if (scrollTop < 1) {
        this.#handleScrolledBeforeHeader();
      }
    } else {
      this.#handleScrolledBeforeHeader();
    }

    this.currentScrollTop = scrollTop;
  }

  #updateScrollMetrics(scrollTop) {
    const newDirection = scrollTop > this.currentScrollTop ? "down" : "up";

    if (newDirection !== this.scrollDirection) {
      this.scrollDistance = 0;
      this.scrollDirection = newDirection;
    } else {
      this.scrollDistance += Math.abs(scrollTop - this.currentScrollTop);
    }
  }

  #handleScrolledPastHeader(scrollTop, headerBoundsBottom) {
    this.hasScrolledPastThreshold = true;

    if (!this._isScrolled) {
      this._isScrolled = true;
      this.headerSection.classList.add(this.classes.headerScrolled);
    }

    if (this.isAlwaysSticky) {
      if (!this._isPinned) {
        this._isPinned = true;
        document.body.classList.add(this.classes.pinned);
      }
    } else {
      const isScrollingUp = this.scrollDirection === "up";
      const isNearHeader = scrollTop < headerBoundsBottom + 100;
      const hasScrolledEnough = this.scrollDistance >= this.scrollThreshold;

      if (isScrollingUp || isNearHeader) {
        if (!this._isPinned) {
          this._isPinned = true;
          document.body.classList.add(this.classes.pinned);
        }
      } else if (hasScrolledEnough) {
        if (this._isPinned) {
          this._isPinned = false;
          document.body.classList.remove(this.classes.pinned);
        }
      }
    }
  }

  #handleScrolledBeforeHeader() {
    if (this.isAlwaysSticky && this.hasScrolledPastThreshold) {
      const scrollTop = this.lenis ? this.lenis.scroll : window.scrollY;
      if (scrollTop < 1) {
        this.hasScrolledPastThreshold = false;
        if (this._isScrolled) {
          this._isScrolled = false;
          this.headerSection.classList.remove(this.classes.headerScrolled);
        }
        if (this._isPinned) {
          this._isPinned = false;
          document.body.classList.remove(this.classes.pinned);
        }
      }
    } else {
      this.hasScrolledPastThreshold = false;
      if (this._isScrolled) {
        this._isScrolled = false;
        this.headerSection.classList.remove(this.classes.headerScrolled);
      }
      if (this._isPinned) {
        this._isPinned = false;
        document.body.classList.remove(this.classes.pinned);
      }
    }
  }
}
customElements.define("sticky-header", StickyHeader, { extends: "header" });

const lockDropdownCount = new WeakMap();
// Animation timing constants
const ANIMATION_TIMING = {
  hoverEnterDelay: 100,
  hoverLeaveDelay: 150,
  contentOpenDelay: 100,
  hoverIntentGrace: 400,
};

class DetailsDropdown extends HTMLDetailsElement {
  constructor() {
    super();
    // Initialize properties
    this.classes = { bodyClass: "has-dropdown-menu" };
    this.events = {
      handleAfterHide: "menu:handleAfterHide",
      handleAfterShow: "menu:handleAfterShow",
    };

    // Reference to first and last child elements
    this.summaryElement = this.firstElementChild;
    this.contentElement = this.lastElementChild;

    // Initial state based on attributes
    this._open = this.hasAttribute("open");

    // Setup hover detection with debouncing
    this.hoverEnterTimer = null;
    this.hoverLeaveTimer = null;
    this.hoverIntentTimer = null;
    this.isHoveringItem = false;
    this.isHoveringContent = false;

    // Last two pointer samples, used to detect movement direction toward the menu
    this._prevPoint = null;
    this._lastPoint = null;

    // Cache for performance optimization
    this._cachedTrigger = null;
    this._cachedTranslateY = null;

    // Binding methods to ensure 'this' context is correct when they are called
    this.handleSummaryClick = this.handleSummaryClick.bind(this);
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    this.handleEscKeyPress = this.handleEscKeyPress.bind(this);
    this.handleFocusOut = this.handleFocusOut.bind(this);
    this.handleMouseEnter = this.handleMouseEnter.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);
    this.handleContentMouseEnter = this.handleContentMouseEnter.bind(this);
    this.handleContentMouseLeave = this.handleContentMouseLeave.bind(this);
  }

  connectedCallback() {
    // Event listeners for summary element
    this.summaryElement.addEventListener("click", this.handleSummaryClick);

    if (this.trigger === "hover") {
      this.summaryElement.addEventListener("focusin", this.#handleFocusIn);
      this.summaryElement.addEventListener("focusout", this.#handleFocusOutInternal);

      // Setup hover detection on dropdown content to prevent closing when moving to dropdown
      this.contentElement.addEventListener("mouseenter", this.handleContentMouseEnter);
      this.contentElement.addEventListener("mouseleave", this.handleContentMouseLeave);

      // Track pointer direction so a diagonal move toward the menu keeps the hover intent
      this.addEventListener("mousemove", this.#trackPointer);
    }

    // Setup hover detection with debouncing
    this.addEventListener("mouseenter", this.handleMouseEnter);
    this.addEventListener("mouseleave", this.handleMouseLeave);
  }

  disconnectedCallback() {
    // Cleanup timers first to prevent any pending callbacks
    this.#clearHoverTimers();

    // Remove event listeners
    this.summaryElement.removeEventListener("click", this.handleSummaryClick);
    if (this.trigger === "hover") {
      this.summaryElement.removeEventListener("focusin", this.#handleFocusIn);
      this.summaryElement.removeEventListener("focusout", this.#handleFocusOutInternal);
      this.contentElement.removeEventListener("mouseenter", this.handleContentMouseEnter);
      this.contentElement.removeEventListener("mouseleave", this.handleContentMouseLeave);
      this.removeEventListener("mousemove", this.#trackPointer);
    }
    this.removeEventListener("mouseenter", this.handleMouseEnter);
    this.removeEventListener("mouseleave", this.handleMouseLeave);

    // Cleanup document-level listeners (prevent memory leak)
    // These might have been added in #setupOpenState
    document.removeEventListener("click", this.handleOutsideClick);
    document.removeEventListener("keydown", this.handleEscKeyPress);
    document.removeEventListener("focusout", this.handleFocusOut);

    // Clear cached values
    this._cachedTrigger = null;
    this._cachedTranslateY = null;
    this._cachedChildEl = null;
  }

  #handleFocusIn = (event) => {
    if (event.target === this.summaryElement) {
      this.open = true;
    }
  };

  #handleFocusOutInternal = (event) => {
    if (!this.contentElement.contains(event.relatedTarget)) {
      this.open = false;
    }
  };

  #trackPointer = (event) => {
    this._prevPoint = this._lastPoint;
    this._lastPoint = { x: event.clientX, y: event.clientY };
  };

  handleMouseEnter() {
    this.isHoveringItem = true;
    this.#clearHoverTimer("leave");
    this.#clearHoverIntent();
    this.hoverEnterTimer = setTimeout(() => {
      this.detectHover({ type: "mouseenter" });
    }, ANIMATION_TIMING.hoverEnterDelay);
  }

  handleMouseLeave(event) {
    this.isHoveringItem = false;

    // Leaving downward across the header padding toward the (full-width) menu:
    // keep the open/opening intent alive so a large padding gap doesn't drop the hover.
    if (this.trigger === "hover" && this.#isHeadingToMenu(event)) {
      this.#clearHoverTimer("leave");
      this.#armHoverIntent();
      return;
    }

    this.#clearHoverTimer("enter");

    // Only start close timer if menu is open and not hovering over dropdown content
    if (this.open && !this.isHoveringContent) {
      this.hoverLeaveTimer = setTimeout(() => {
        // Double-check menu is still open before closing (prevent race condition)
        if (this.open) {
          this.detectHover({ type: "mouseleave" });
        }
      }, ANIMATION_TIMING.hoverLeaveDelay);
    }
  }

  handleContentMouseEnter() {
    this.isHoveringContent = true;
    // Cancel close timer when entering dropdown content
    this.#clearHoverTimer("leave");
    this.#clearHoverIntent();
  }

  // Whether the pointer is moving toward the menu that opens below the trigger.
  // The menu is full-width, so any downward movement counts as heading to it —
  // we only bail if another top-level trigger sits below (e.g. a wrapped 2nd row)
  // or the pointer has left the header.
  #isHeadingToMenu(event) {
    const rect = this.getBoundingClientRect();

    const dy = this._prevPoint && this._lastPoint ? this._lastPoint.y - this._prevPoint.y : 0;
    const headingDown = dy > 0 || event.clientY >= rect.bottom - 2;
    if (!headingDown) return false;

    const header = this.closest(".header");
    if (!header) return false;

    const startY = Math.max(event.clientY, rect.bottom) + 2;
    for (const offset of [0, 8, 20]) {
      const el = document.elementFromPoint(event.clientX, startY + offset);
      if (!el) continue;
      if (this.contains(el)) return true; // already over this menu's own content
      if (!header.contains(el)) return false; // moved out of the header
      if (el.closest('details[is="details-mega"], details[is="details-dropdown"][level="top"]')) {
        return false; // another top-level menu sits below (e.g. wrapped 2nd row)
      }
    }
    return true;
  }

  #armHoverIntent() {
    this.#clearHoverIntent();
    this.hoverIntentTimer = setTimeout(() => {
      this.hoverIntentTimer = null;
      // If the pointer never reached the content or returned to the item, close/cancel.
      if (!this.isHoveringContent && !this.isHoveringItem) {
        this.#clearHoverTimer("enter");
        if (this.open) {
          this.detectHover({ type: "mouseleave" });
        }
      }
    }, ANIMATION_TIMING.hoverIntentGrace);
  }

  #clearHoverIntent() {
    if (this.hoverIntentTimer) {
      clearTimeout(this.hoverIntentTimer);
      this.hoverIntentTimer = null;
    }
  }

  handleContentMouseLeave() {
    this.isHoveringContent = false;
    // Only start close timer if menu is open and not hovering over item
    if (this.open && !this.isHoveringItem) {
      this.hoverLeaveTimer = setTimeout(() => {
        // Double-check menu is still open before closing (prevent race condition)
        if (this.open) {
          this.detectHover({ type: "mouseleave" });
        }
      }, ANIMATION_TIMING.hoverLeaveDelay);
    }
  }

  #clearHoverTimer(type) {
    const timer = type === "enter" ? this.hoverEnterTimer : this.hoverLeaveTimer;
    if (timer) {
      clearTimeout(timer);
      if (type === "enter") {
        this.hoverEnterTimer = null;
      } else {
        this.hoverLeaveTimer = null;
      }
    }
  }

  #clearHoverTimers() {
    if (this.hoverEnterTimer) {
      clearTimeout(this.hoverEnterTimer);
      this.hoverEnterTimer = null;
    }
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
    this.#clearHoverIntent();
  }

  set open(value) {
    // Check if the new value is different from the current value
    if (value !== this._open) {
      // Update the internal state
      this._open = value;

      // Perform actions based on whether the element is connected to the DOM
      if (this.isConnected) {
        // If connected, perform a transition
        this.transition(value);
      } else {
        // If not connected, directly manipulate the 'open' attribute
        if (value) {
          this.setAttribute("open", "");
        } else {
          this.removeAttribute("open");
        }
      }
    }
  }

  get open() {
    return this._open;
  }

  get trigger() {
    // Cache trigger value to avoid repeated media queries and DOM reads
    if (this._cachedTrigger === null) {
      // For touch devices, always use click events
      if (!mediaHoverFine()) {
        this._cachedTrigger = "click";
      } else {
        // For non-touch devices, check for custom trigger attribute
        this._cachedTrigger = this.getAttribute("trigger") || "click";
      }
    }
    return this._cachedTrigger;
  }

  handleSummaryClick(event) {
    // Prevent the default action of the event
    event.preventDefault();

    // Check if the device is not touch-enabled and the trigger type is 'hover'
    if (mediaHoverFine() && this.trigger === "hover" && this.summaryElement.hasAttribute("data-link")) {
      // If conditions are met, navigate to the URL specified in 'data-link'
      window.location.href = this.summaryElement.getAttribute("data-link");
    } else {
      // Otherwise, toggle the 'open' state
      this.open = !this.open;
    }
  }

  beforeOpen() {}

  beforeClose() {}

  get level() {
    return this.hasAttribute("level") ? this.getAttribute("level") : "top";
  }

  async transition(value) {
    if (value) {
      this.beforeOpen();
      this.#incrementDropdownCount();
      this.#setupOpenState();
      await this.showWithTransition();
      this.needsReverse();
      return waitForEvent(this, this.events.handleAfterShow);
    } else {
      this.beforeClose();
      this.#decrementDropdownCount();
      this.#cleanupOpenState();
      await this.hideWithTransition();
      if (!this.open) {
        this.removeAttribute("open");
      }
      return waitForEvent(this, this.events.handleAfterHide);
    }
  }

  #incrementDropdownCount() {
    lockDropdownCount.set(DetailsDropdown, (lockDropdownCount.get(DetailsDropdown) || 0) + 1);
  }

  #decrementDropdownCount() {
    const count = (lockDropdownCount.get(DetailsDropdown) || 0) - 1;
    lockDropdownCount.set(DetailsDropdown, count);

    if (count > 0) {
      document.body.classList.add(this.classes.bodyClass);
    } else {
      // Use helper with callback to check count (prevents race condition)
      removeScrollLockClass(document.body, this.classes.bodyClass, () => {
        // Only remove if no other dropdowns are open
        return (lockDropdownCount.get(DetailsDropdown) || 0) === 0;
      });
    }
  }

  #setupOpenState() {
    document.body.classList.add(this.classes.bodyClass);
    if (document.body.classList.contains("search-open")) {
      document.body.classList.remove("search-open");
    }
    this.setAttribute("open", "");
    this.summaryElement.setAttribute("open", "");
    setTimeout(() => {
      this.contentElement.setAttribute("open", "");
    }, ANIMATION_TIMING.contentOpenDelay);
    document.addEventListener("click", this.handleOutsideClick);
    document.addEventListener("keydown", this.handleEscKeyPress);
    document.addEventListener("focusout", this.handleFocusOut);
  }

  #cleanupOpenState() {
    this.summaryElement.removeAttribute("open");
    this.contentElement.removeAttribute("open");
    // Clear any pending hover timers when closing
    this.#clearHoverTimers();
    document.removeEventListener("click", this.handleOutsideClick);
    document.removeEventListener("keydown", this.handleEscKeyPress);
    document.removeEventListener("focusout", this.handleFocusOut);
  }

  get parentEl() {
    return this.contentElement;
  }

  get childEl() {
    // Cache child element reference
    if (!this._cachedChildEl) {
      this._cachedChildEl = this.parentEl.firstElementChild;
    }
    return this._cachedChildEl;
  }

  #getTranslateY() {
    // Cache translateY calculation to avoid repeated level checks
    if (this._cachedTranslateY === null) {
      this._cachedTranslateY = this.level === "top" ? "-3rem" : "2rem";
    }
    return this._cachedTranslateY;
  }

  async showWithTransition() {
    const reducedMotion = prefersReducedMotion();
    animate(
      this.parentEl,
      { opacity: [0, 1], visibility: "visible" },
      { duration: reducedMotion ? 0 : 0.3, easing: "ease-in-out" },
      { delay: reducedMotion ? 0 : 0.2 }
    );
    const translateY = this.#getTranslateY();
    return animate(
      this.childEl,
      { transform: [`translateY(${translateY})`, "translateY(0)"] },
      { duration: reducedMotion ? 0 : 0.6, easing: [0.3, 1, 0.3, 1] }
    ).finished;
  }

  async hideWithTransition() {
    const reducedMotion = prefersReducedMotion();
    animate(
      this.parentEl,
      { opacity: 0, visibility: "hidden" },
      { duration: reducedMotion ? 0 : 0.2, easing: "ease-in-out" }
    );
    const translateY = this.#getTranslateY();
    return animate(
      this.childEl,
      { transform: `translateY(${translateY})` },
      { duration: reducedMotion ? 0 : 0.6, easing: [0.3, 1, 0.3, 1] }
    ).finished;
  }

  handleOutsideClick(event) {
    const isClickInside = this.contains(event.target);
    const isClickOnDetailsDropdown = event.target.closest("details") instanceof DetailsDropdown;

    if (!isClickInside && !isClickOnDetailsDropdown) {
      this.open = false;
    }
  }

  handleEscKeyPress(event) {
    if (event.code === "Escape") {
      const targetMenu = event.target.closest("details[open]");
      if (targetMenu) {
        targetMenu.open = false;
      } else if (this.open) {
        this.open = false;
      }
    }
  }

  handleFocusOut(event) {
    if (event.relatedTarget && !this.contains(event.relatedTarget)) {
      this.open = false;
    }
  }

  detectHover(event) {
    // Only process hover events if trigger is hover and element is still connected
    if (this.trigger === "hover" && this.isConnected) {
      const shouldOpen = event.type === "mouseenter";
      // Only update if state actually changes (prevent unnecessary transitions)
      if (this.open !== shouldOpen) {
        this.open = shouldOpen;
      }
    }
  }

  needsReverse() {
    // Called after 'await showWithTransition()' - animation already finished
    // Layout is stable, no rAF needed
    if (!this.contentElement || this.contentElement.clientWidth === 0) {
      return;
    }

    // Batch all layout reads first
    const clientWidth = this.contentElement.clientWidth;
    const offsetLeft = this.contentElement.offsetLeft;
    const windowWidth = window.innerWidth;

    // Calculate
    const totalWidth = offsetLeft + clientWidth * 2;

    // Then write
    if (totalWidth > windowWidth) {
      this.contentElement.classList.add("needs-reverse");
    } else {
      // Remove class if no longer needed (handle window resize)
      this.contentElement.classList.remove("needs-reverse");
    }
  }
}
customElements.define("details-dropdown", DetailsDropdown, { extends: "details" });
lockDropdownCount.set(DetailsDropdown, 0);

const lockMegaCount = new WeakMap();
let megaMenuZIndexCounter = 1;

class DetailsMega extends DetailsDropdown {
  constructor() {
    super();

    if (Shopify.designMode) {
      this.addEventListener("shopify:block:select", () => {
        this.open = true;
      });

      this.addEventListener("shopify:block:deselect", () => {
        this.open = false;
      });
    }
  }

  get additionalBodyClass() {
    return "has-mega-menu";
  }

  #incrementMegaCount() {
    lockMegaCount.set(DetailsMega, (lockMegaCount.get(DetailsMega) || 0) + 1);
  }

  #decrementMegaCount() {
    const count = Math.max((lockMegaCount.get(DetailsMega) || 0) - 1, 0);
    lockMegaCount.set(DetailsMega, count);
    return count;
  }

  async showWithTransition() {
    this.#incrementMegaCount();
    document.body.classList.remove("mega-menu-closing");
    document.body.classList.add(this.additionalBodyClass);

    // Set higher z-index for opening menu to ensure it appears above closing ones
    megaMenuZIndexCounter += 1;
    this.contentElement.style.zIndex = megaMenuZIndexCounter.toString();

    const reducedMotion = prefersReducedMotion();
    return animate(
      this.childEl,
      { visibility: "visible", transform: ["translateY(-100%)", "translateY(0)"] },
      { duration: reducedMotion ? 0 : 0.6, easing: [0.7, 0, 0.2, 1] }
    ).finished;
  }

  async hideWithTransition() {
    const reducedMotion = prefersReducedMotion();
    const animationDuration = reducedMotion ? 0 : 0.6;

    document.documentElement.style.setProperty("--mega-menu-close-delay", reducedMotion ? "0s" : "0.6s");

    // CSS variables apply immediately, single rAF is sufficient for class addition
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        document.body.classList.add("mega-menu-closing");
        resolve();
      });
    });

    // Set lower z-index immediately so opening menu appears above
    this.contentElement.style.zIndex = "0";

    // Decrement count and only remove class if no other mega menus are open
    this.#decrementMegaCount();

    // Use helper with callback to check count (prevents race condition)
    removeScrollLockClass(document.body, this.additionalBodyClass, () => {
      // Only remove if no other mega menus are open
      return lockMegaCount.get(DetailsMega) === 0;
    });

    const animation = animate(
      this.childEl,
      { visibility: "hidden", transform: "translateY(-100%)" },
      { duration: animationDuration, easing: [0.7, 0, 0.2, 1] }
    );
    await animation.finished;
    // Remove closing class after animation completes
    document.body.classList.remove("mega-menu-closing");
  }
}
customElements.define("details-mega", DetailsMega, { extends: "details" });
lockMegaCount.set(DetailsMega, 0);

class MenuSidebar extends HTMLElement {
  #intersectionObserver = null;

  constructor() {
    super();

    this.classes = {
      visible: "is-visible",
    };

    this.handleSidenavMenuToggle = this.handleSidenavMenuToggle.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.updateHeight = this.updateHeight.bind(this);
  }

  get summarys() {
    return this.querySelectorAll("summary");
  }

  get containerEl() {
    return (this._containerEl = this._containerEl || this.closest(".mega-menu__wrapper"));
  }

  connectedCallback() {
    this.#setupAriaAttributes();

    onDocumentReady(this.setInitialMinHeight.bind(this));

    this.summarys.forEach((summary) => {
      summary.addEventListener("mouseenter", this.handleSidenavMenuToggle);
      summary.addEventListener("keydown", this.handleKeyDown);
      summary.addEventListener("click", (e) => {
        // Prevent default for mouse clicks to avoid toggling details element
        // Keyboard activation (Enter/Space) is handled in handleKeyDown
        e.preventDefault();

        const summaryEl = e.target.closest("summary");
        this.#goToLink(summaryEl);
      });
    });

    this.setupIntersectionObserver();
  }

  setInitialMinHeight() {
    requestAnimationFrame(() => {
      this.setPromotionsHeight();
    });
  }

  setPromotionsHeight() {
    if (!this.containerEl) return;

    const promotionsEl = this.containerEl.querySelector(".mega-menu__promotions");
    if (!promotionsEl) return;

    const promotionsHeight = promotionsEl.offsetHeight;
    this.containerEl.style.setProperty("--promotions-height", `${promotionsHeight}px`);
  }

  #setupAriaAttributes() {
    this.summarys.forEach((summary, index) => {
      const contentEl = summary.nextElementSibling;
      if (!contentEl) return;

      const summaryId = summary.id || `menu-sidebar-item-${index}`;
      const contentId = contentEl.id || `menu-sidebar-content-${index}`;

      summary.id = summaryId;
      contentEl.id = contentId;

      summary.setAttribute("role", "menuitem");
      summary.setAttribute("aria-controls", contentId);
      summary.setAttribute("aria-expanded", "false");
      contentEl.setAttribute("role", "menu");
      contentEl.setAttribute("aria-labelledby", summaryId);
    });
  }

  setupIntersectionObserver() {
    this.#intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            this.updateHeight();
            this.setPromotionsHeight();
          }, 100);
        }
      });
    });

    this.#intersectionObserver.observe(this);
  }

  updateHeight() {
    const activeSummary = this.querySelector(`.${this.classes.visible}`);
    if (!activeSummary) return;

    const contentEl = activeSummary.nextElementSibling;

    if (!this.containerEl || !contentEl) return;

    // Called from IntersectionObserver + setTimeout(100ms), layout is stable
    // No rAF needed - 50-100ms reflow timing is acceptable
    const contentHeight = contentEl.offsetHeight;
    this.containerEl.style.setProperty("--sidebar-height", `${contentHeight}px`);
  }

  setActiveItem(summaryEl, isUpdateHeight = true) {
    const lastSidenavEl = this.querySelector(`.${this.classes.visible}`);
    if (lastSidenavEl) {
      lastSidenavEl.classList.remove(this.classes.visible);
      lastSidenavEl.setAttribute("aria-expanded", "false");
    }

    summaryEl.classList.add(this.classes.visible);
    summaryEl.setAttribute("aria-expanded", "true");

    isUpdateHeight && this.updateHeight();
  }

  handleSidenavMenuToggle(event) {
    const summaryEl = event.target.closest("summary");
    if (summaryEl) {
      this.setActiveItem(summaryEl);
    }
  }

  handleKeyDown(event) {
    const summaryEl = event.target.closest("summary");
    if (!summaryEl) return;

    const summaries = Array.from(this.summarys);
    const currentIndex = summaries.indexOf(summaryEl);
    if (currentIndex === -1) return;

    const key = event.key;
    let targetIndex = currentIndex;

    switch (key) {
      case "ArrowDown":
        event.preventDefault();
        targetIndex = currentIndex + 1;
        if (targetIndex >= summaries.length) targetIndex = 0;
        summaries[targetIndex].focus();
        this.setActiveItem(summaries[targetIndex]);
        break;

      case "ArrowUp":
        event.preventDefault();
        targetIndex = currentIndex - 1;
        if (targetIndex < 0) targetIndex = summaries.length - 1;
        summaries[targetIndex].focus();
        this.setActiveItem(summaries[targetIndex]);
        break;

      case "Home":
        event.preventDefault();
        summaries[0].focus();
        this.setActiveItem(summaries[0]);
        break;

      case "End":
        event.preventDefault();
        summaries[summaries.length - 1].focus();
        this.setActiveItem(summaries[summaries.length - 1]);
        break;

      case "Enter":
        event.preventDefault();
        this.setActiveItem(summaryEl);
        this.#goToLink(summaryEl);
        break;

      case " ":
        event.preventDefault();
        this.setActiveItem(summaryEl);
        break;

      default:
        return;
    }
  }

  #goToLink(summaryEl) {
    const linkUrl = summaryEl.dataset.linkUrl;
    if (linkUrl) {
      window.location.href = linkUrl;
    }
  }

  disconnectedCallback() {
    this.summarys.forEach((el) => {
      el.removeEventListener("mouseenter", this.handleSidenavMenuToggle);
      el.removeEventListener("keydown", this.handleKeyDown);
    });

    if (this.#intersectionObserver) {
      this.#intersectionObserver.disconnect();
      this.#intersectionObserver = null;
    }
  }
}
customElements.define("menu-sidebar", MenuSidebar);

class MenuDrawerDetails extends HTMLDetailsElement {
  #abortController = new AbortController();
  #animationFrameId = null;
  #boundHandleKeyDown = null;
  #boundHandleToggle = null;
  /** @type {Array<{ element: HTMLDetailsElement; tabindex: string | null }>} */
  #detailsOutsideRestore = [];
  /** @type {HTMLElement[]} - focusable inside .menu-drawer__submenu, filled in #setDetailsTabindex, used in #setupFocusTrap */
  #focusableElements = [];
  /** @type {((event: KeyboardEvent) => void) | null} */
  #focusTrapHandler = null;

  constructor() {
    super();

    this.onSummaryClick = this.onSummaryClick.bind(this);
    this.onCloseButtonClick = this.onCloseButtonClick.bind(this);
    this.onOpenSubmenuButtonClick = this.onOpenSubmenuButtonClick.bind(this);
    this.#boundHandleKeyDown = this.#handleKeyDown.bind(this);
    this.#boundHandleToggle = this.#handleToggle.bind(this);
  }

  get parent() {
    return this.closest("[data-parent]");
  }

  get summary() {
    return this.querySelector("summary");
  }

  get closeButton() {
    return this.querySelector(".menu-drawer__item-link-back");
  }

  get openSubmenuButton() {
    return this.querySelector(".menu-drawer__item-link-arrow");
  }

  connectedCallback() {
    const summary = this.summary;
    const closeButton = this.closeButton;
    const openSubmenuButton = this.openSubmenuButton;
    const { signal } = this.#abortController;

    if (summary) {
      summary.addEventListener("click", this.onSummaryClick, { signal });
      this.#setupAriaAttributes();
    }

    if (openSubmenuButton) {
      openSubmenuButton.addEventListener("click", this.onOpenSubmenuButtonClick, { signal });
    }

    if (closeButton) {
      closeButton.addEventListener("click", this.onCloseButtonClick, { signal });
    }

    // Handle Escape key to close drawer
    document.addEventListener("keydown", this.#boundHandleKeyDown);

    this.addEventListener("toggle", this.#boundHandleToggle, { signal });

    // Sync aria-expanded with open attribute
    this.#syncAriaExpanded();
  }

  disconnectedCallback() {
    this.#abortController.abort();

    document.removeEventListener("keydown", this.#boundHandleKeyDown);

    this.#removeFocusTrap();
    this.#restoreDetailsTabindex();

    // Cancel any pending animation
    if (this.#animationFrameId) {
      window.cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }
  }

  #handleToggle() {
    if (this.open) {
      this.#setDetailsTabindex();
      this.#setupFocusTrap();
    } else {
      this.#removeFocusTrap();
      this.#restoreDetailsTabindex();
    }
  }

  #setupFocusTrap() {
    if (this.#focusableElements.length === 0) return;

    const firstElement = this.#focusableElements[0];
    const lastElement = this.#focusableElements[this.#focusableElements.length - 1];

    const handleTabKey = (event) => {
      if (event.key !== "Tab") return;

      const activeElement = document.activeElement;
      const isFocusInDrawer = this.#focusableElements.includes(activeElement);

      if (event.shiftKey) {
        if (activeElement === firstElement || !isFocusInDrawer) {
          event.preventDefault();
          event.stopPropagation();
          lastElement.focus();
        }
      } else {
        if (activeElement === lastElement || !isFocusInDrawer) {
          event.preventDefault();
          event.stopPropagation();
          firstElement.focus();
        }
      }
    };

    this.closeButton && this.closeButton.focus();
    this.addEventListener("keydown", handleTabKey, true);
    this.#focusTrapHandler = handleTabKey;
  }

  #removeFocusTrap() {
    if (this.#focusTrapHandler) {
      this.removeEventListener("keydown", this.#focusTrapHandler, true);
      this.#focusTrapHandler = null;
    }
    this.#focusableElements = [];
  }

  #setDetailsTabindex() {
    this.#restoreDetailsTabindex();

    const dialog = this.closest(".dialog");
    const dialogHeader = dialog?.querySelector(".dialog__header");
    const submenu = this.querySelector(".menu-drawer__submenu");
    const focusableElements = getFocusableElements(dialog);

    this.#focusableElements = [];

    focusableElements.forEach((el) => {
      if (submenu?.contains(el) || dialogHeader?.contains(el)) {
        this.#focusableElements.push(el);
        return;
      }

      const tabindex = el.getAttribute("tabindex");
      this.#detailsOutsideRestore.push({ element: el, tabindex });
      el.setAttribute("tabindex", "-1");
    });
  }

  #restoreDetailsTabindex() {
    for (const { element, tabindex } of this.#detailsOutsideRestore) {
      if (tabindex === null) {
        element.removeAttribute("tabindex");
      } else {
        element.setAttribute("tabindex", tabindex);
      }
    }
    this.#detailsOutsideRestore.length = 0;
  }

  #setupAriaAttributes() {
    const summary = this.summary;
    if (!summary) return;

    const contentId = summary.id || `${this.tagName.toLowerCase()}-content`;
    summary.id = summary.id || contentId;

    summary.setAttribute("aria-expanded", this.hasAttribute("open") ? "true" : "false");
  }

  #syncAriaExpanded() {
    const summary = this.summary;
    if (!summary) return;

    summary.setAttribute("aria-expanded", this.hasAttribute("open") ? "true" : "false");
  }

  #handleKeyDown(event) {
    if (event.key !== "Escape" || !this.hasAttribute("open")) return;

    // Only close if the event target is within this component
    const closestDrawer = event.target.closest("menu-drawer-details");
    if (!closestDrawer || closestDrawer !== this) return;

    event.preventDefault();
    this.onCloseButtonClick();
  }

  onSummaryClick(event) {
    const summary = this.summary;
    const href = summary.dataset.linkUrl;

    if (href) {
      event.preventDefault();
      window.location.href = href;

      return;
    }
  }

  onOpenSubmenuButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const parent = this.parent;
    const summary = this.summary;

    setTimeout(() => {
      if (!parent || !summary) return;

      if (!this.open) {
        this.open = true;
      }
      parent.classList.add("active");
      this.classList.add("active");
      this.#syncAriaExpanded();
    }, 100);
  }

  onCloseButtonClick() {
    const parent = this.parent;
    const summary = this.summary;

    if (!parent || !summary) return;

    parent.classList.remove("active");
    this.classList.remove("active");
    this.#syncAriaExpanded();

    this.#closeAnimation();
  }

  #closeAnimation() {
    // Cancel any existing animation
    if (this.#animationFrameId) {
      window.cancelAnimationFrame(this.#animationFrameId);
    }

    let animationStart;

    const handleAnimation = (time) => {
      if (animationStart === undefined) {
        animationStart = time;
      }

      const elapsedTime = time - animationStart;

      if (elapsedTime < 400) {
        this.#animationFrameId = window.requestAnimationFrame(handleAnimation);
      } else {
        this.removeAttribute("open");
        this.#animationFrameId = null;
        this.#syncAriaExpanded();
      }
    };

    this.#animationFrameId = window.requestAnimationFrame(handleAnimation);
  }
}
customElements.define("menu-drawer-details", MenuDrawerDetails, { extends: "details" });

class MenuDrawerSubmenu extends AccordionComponent {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
  }

  onSummaryClick(event) {
    event.preventDefault();

    const { target } = event;
    const summary = target.closest("summary");

    if (summary) {
      const href = summary.dataset.linkUrl;

      if (href) {
        window.location.href = href;
        return;
      }
    }
  }

  onArrowClick(event) {
    event.preventDefault();
    event.stopPropagation();

    super.onSummaryClick(event);
  }
}
customElements.define("menu-drawer-submenu", MenuDrawerSubmenu);

/**
 * @typedef {Object} ShowMoreRefs
 * @property {HTMLElement} showMoreButton - The button to toggle visibility of the items
 * @property {HTMLElement[]} showMoreItems - The hidden items to show and hide
 * @property {HTMLElement} showMoreContent - The content container to measure and animate
 */

/**
 * A custom element that manages the showing and hiding excess content items
 *
 * @extends {Component<ShowMoreRefs>}
 */

class ShowMoreComponent extends Component {
  requiredRefs = ["showMoreButton", "showMoreItems", "showMoreContent"];

  /**
   * @type {boolean}
   */
  #expanded = false;

  /**
   * @type {boolean}
   */
  #disableOnDesktop = false;

  /**
   * @type {number}
   */
  #collapsedHeight = 0;

  /**
   * @type {'mobile:hidden' | 'hidden'}
   */
  #disabledClass = "hidden";

  /**
   * @type {'MOBILE' | 'DESKTOP'}
   */
  get #currentBreakpoint() {
    return isMobileBreakpoint() ? "MOBILE" : "DESKTOP";
  }

  /**
   * @type {Animation | undefined}
   */
  #animation;

  /**
   * @constant {number}
   */
  #animationSpeed = 300;

  connectedCallback() {
    super.connectedCallback();
    this.#updateBreakpointState();
  }

  /**
   * Updates the current breakpoint and apprpropriate disabled class
   */
  #updateBreakpointState = () => {
    this.#disableOnDesktop = this.dataset.disableOnDesktop === "true";
    this.#disabledClass = this.#disableOnDesktop ? "mobile:hidden" : "hidden";
  };

  /**
   * Handles expanding the content
   * @returns {{startHeight: number, endHeight: number}}
   */
  #expand = () => {
    const { showMoreItems, showMoreContent } = this.refs;

    this.#collapsedHeight = showMoreContent.offsetHeight;
    const startHeight = this.#collapsedHeight;

    showMoreItems?.forEach((item) => item.classList.remove(this.#disabledClass));

    return {
      startHeight,
      endHeight: showMoreContent.scrollHeight,
    };
  };

  /**
   * Handles collapsing the content
   * @returns {{startHeight: number, endHeight: number}}
   */
  #collapse = () => {
    const { showMoreContent } = this.refs;
    const startHeight = showMoreContent.offsetHeight;
    const endHeight = this.#collapsedHeight;

    return { startHeight, endHeight };
  };

  /**
   * Initializes a height transition
   * @param {number} startHeight
   * @param {number} endHeight
   */
  #animateHeight = (startHeight, endHeight) => {
    const { showMoreContent } = this.refs;

    showMoreContent.style.overflow = "hidden";
    this.#animation?.cancel();

    this.#animation = showMoreContent.animate(
      {
        height: [`${startHeight}px`, `${endHeight}px`],
      },
      {
        duration: this.#animationSpeed,
        easing: "ease-in-out",
      }
    );

    this.#animation.onfinish = () => this.#onAnimationFinish();
  };

  /**
   * Handles the animation finish event.
   */
  #onAnimationFinish() {
    const { showMoreContent, showMoreItems } = this.refs;

    if (this.#expanded) {
      showMoreItems.forEach((item) => item.classList.add(this.#disabledClass));
    }

    showMoreContent.style.removeProperty("height");
    showMoreContent.style.overflow = "";
    this.#expanded = !this.#expanded;
  }

  /**
   * Toggles the expansion state of the content.
   *
   * @param {Event} event - The click event
   */
  toggle = (event) => {
    event.preventDefault();

    this.toggleOpen({ willOpen: !this.#expanded });
  };

  toggleOpen(settings) {
    const { willOpen } = settings;

    this.#updateBreakpointState();

    if (this.#currentBreakpoint === "DESKTOP" && this.#disableOnDesktop) return;

    const { startHeight, endHeight } = willOpen ? this.#expand() : this.#collapse();

    this.dataset.expanded = willOpen ? "true" : "false";
    this.refs.showMoreButton.setAttribute("aria-expanded", this.dataset.expanded);

    this.#animateHeight(startHeight, endHeight);
  }
}

if (!customElements.get("show-more-component")) {
  customElements.define("show-more-component", ShowMoreComponent);
}

class HighlightText extends HTMLElement {
  constructor() {
    super();
    this.hasAnimated = false;
  }

  connectedCallback() {
    this.#bindInView();
  }

  #bindInView() {
    inView(
      this,
      async () => {
        if (!this.hasAnimated) {
          this.hasAnimated = true;
          await this.#enter();
        }
      },
      { rootMargin: "0px 0px -50px 0px" }
    );
  }

  #enter() {
    this.classList.add("animate");
  }
}

if (!customElements.get("highlight-text")) {
  customElements.define("highlight-text", HighlightText, { extends: "em" });
}

class ReadMore extends Component {
  /** @type {string[]} */
  requiredRefs = ["readMoreButton", "readMoreButtonText", "readMoreContent"];

  constructor() {
    super();

    this.classes = {
      isDisabled: "is-disabled",
      isCollapsed: "is-collapsed",
    };

    this.toggleClass = this.dataset.toggleClass;
    this.showText = this.dataset.showText;
    this.hideText = this.dataset.hideText;
    this.lineClamp = parseInt(this.dataset.lineClamp);
  }

  connectedCallback() {
    super.connectedCallback();

    this.init();
  }

  init() {
    const { readMoreButton: button, readMoreContent: content } = this.refs;

    const lineHeight = parseFloat(window.getComputedStyle(content).lineHeight);
    const contentHeight = content.scrollHeight;
    const maxHeight = lineHeight * this.lineClamp;

    if (contentHeight <= maxHeight) {
      button.style.display = "none";
      return;
    }

    this.classList.remove(this.classes.isDisabled);
    content.classList.remove(this.toggleClass);
    this.showLess();
  }

  showMore() {
    const { readMoreContent: content, readMoreButtonText: buttonText } = this.refs;

    this.classList.remove(this.classes.isCollapsed);
    content.classList.remove(this.toggleClass);
    buttonText.textContent = this.hideText;
    this.resetHeight();
  }

  showLess() {
    const { readMoreContent: content, readMoreButtonText: buttonText } = this.refs;

    this.classList.add(this.classes.isCollapsed);
    content.classList.add(this.toggleClass);
    buttonText.textContent = this.showText;
    this.setHeight();
  }

  setHeight() {
    const { readMoreContent: content } = this.refs;

    const contentStyle = window.getComputedStyle(content);

    const lineHeight = parseFloat(contentStyle.lineHeight);
    const lines = parseInt(contentStyle.getPropertyValue("--line-clamp"));
    const maxHeight = lineHeight * lines;
    content.style.setProperty("max-height", maxHeight + "px");
  }

  resetHeight() {
    const { readMoreContent: content } = this.refs;

    content.style.removeProperty("max-height");
  }

  onToggleClick(event) {
    event.preventDefault();

    const { readMoreContent: content } = this.refs;

    if (content.classList.contains(this.toggleClass)) {
      this.showMore();
    } else {
      this.showLess();
    }
  }
}

if (!customElements.get("read-more")) {
  customElements.define("read-more", ReadMore);
}

class SwipeComponent extends HTMLDivElement {
  /** @type {AbortController | null} */
  #abortController = null;
  #resizer = null;
  #mutationObserver = null;
  #previousActiveElement = null;
  #isActive = false;

  constructor() {
    super();

    this.swipeEl = null;
    this.swipeInner = null;

    this.scrollHandler = this.updateScrollClasses.bind(this);
    this.classes = {
      active: "is--active",
      begin: "is--beginning",
      end: "is--end",
    };
  }

  connectedCallback() {
    this.swipeEl = this.querySelector(".swipe__element");
    if (!this.swipeEl) return;

    this.swipeInner = this.swipeEl.querySelector(".swipe__inner");

    this.#abortController = new AbortController();

    this.init();

    this.swipeEl.addEventListener("scroll", this.scrollHandler, {
      passive: true,
      signal: this.#abortController.signal,
    });
    if (this.swipeEl.offsetParent !== null) {
      this.updateScrollClasses();
    }

    this.#resizer = new ResizeNotifier(() => {
      // Check if element is visible and measurable
      this.swipeEl.offsetParent !== null && this.updateScrollClasses();
    });
    this.#resizer.observe(this.swipeEl);

    if (this.#isActive) {
      this.#startObservingActiveChanges();
    }
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;
    this.#resizer?.disconnect();
    this.#resizer = null;
    this.#mutationObserver?.disconnect();
    this.#mutationObserver = null;
  }

  #startObservingActiveChanges() {
    if (!this.swipeInner || this.#mutationObserver) return;

    const observedAttributes = ["aria-current", "aria-selected"];

    this.#mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Handle attribute changes on direct children
        if (mutation.type === "attributes") {
          const target = /** @type {HTMLElement} */ (mutation.target);
          const attributeName = mutation.attributeName;

          if (observedAttributes.includes(attributeName) && target.getAttribute(attributeName) === "true") {
            this.#scrollToActiveElement(target);
          }
        }

        // Handle new children being added
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.#mutationObserver.observe(node, {
                attributes: true,
                attributeFilter: observedAttributes,
              });
            }
          }
        }
      }
    });

    // Observe .swipe__inner for child list changes and observe all existing direct children
    this.#mutationObserver.observe(this.swipeInner, {
      childList: true,
    });

    // Observe all existing direct children for aria-current and aria-selected changes
    const children = Array.from(this.swipeInner.children);
    for (const child of children) {
      this.#mutationObserver.observe(child, {
        attributes: true,
        attributeFilter: observedAttributes,
      });
    }
  }

  #stopObservingActiveChanges() {
    if (this.#mutationObserver) {
      this.#mutationObserver.disconnect();
      this.#mutationObserver = null;
    }
  }

  #scrollToActiveElement(activeElement) {
    if (!this.swipeEl || !activeElement || !this.swipeInner) return;

    // Skip if the same element is already active (prevents duplicate scrolls)
    if (this.#previousActiveElement === activeElement) return;

    const scrollRect = activeElement.getBoundingClientRect();
    const boxRect = this.swipeEl.getBoundingClientRect();
    const scrollLeft = this.swipeEl.scrollLeft;
    const containerGap = 16;

    // Determine scroll direction by comparing indices
    const children = Array.from(this.swipeInner.children);
    const currentIndex = children.indexOf(activeElement);
    const previousIndex = this.#previousActiveElement ? children.indexOf(this.#previousActiveElement) : -1;

    let scrollOffset;

    // If scrolling right
    if (previousIndex < currentIndex) {
      scrollOffset = scrollRect.x + scrollLeft - boxRect.x - containerGap;
    } else {
      // Scrolling left
      scrollOffset = scrollRect.x + scrollLeft - boxRect.x - boxRect.width + scrollRect.width + containerGap;
    }

    this.#previousActiveElement = activeElement;

    this.swipeEl.scrollTo({
      left: scrollOffset,
      behavior: "smooth",
    });
  }

  init() {
    if (this.swipeEl.classList.contains("swipe-all")) {
      this.setActive(true);
      return;
    }

    const setupResponsive = (className, mediaQuery) => {
      if (!this.swipeEl.classList.contains(className)) return;
      const mql = window.matchMedia(mediaQuery);
      const update = () => this.setActive(mql.matches);
      update();
      mql.addEventListener("change", update, { signal: this.#abortController.signal });
    };

    setupResponsive("swipe-mobile", mediaBreakpointMobile);
    setupResponsive("swipe-tablet", mediaBreakpointTablet);
  }

  setActive(isActive = true) {
    this.#isActive = isActive;
    this.classList.toggle(this.classes.active, isActive);

    if (isActive) {
      this.#startObservingActiveChanges();
    } else {
      this.#stopObservingActiveChanges();
    }
  }

  updateScrollClasses() {
    const scrollLeft = this.swipeEl.scrollLeft;
    const clientWidth = this.swipeEl.clientWidth;
    const scrollWidth = this.swipeEl.scrollWidth;

    const atStart = scrollLeft <= 0;
    const atEnd = Math.ceil(scrollLeft + clientWidth) >= scrollWidth;

    if (this._wasAtStart !== atStart) {
      this._wasAtStart = atStart;
      this.classList.toggle(this.classes.begin, atStart);
    }
    if (this._wasAtEnd !== atEnd) {
      this._wasAtEnd = atEnd;
      this.classList.toggle(this.classes.end, atEnd);
    }
  }
}
customElements.define("swipe-component", SwipeComponent, { extends: "div" });

export class NewsletterForm extends Component {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    this.init();
  }

  /**
   * Show message when user re-subscribe with exists email.
   */
  init() {
    const { input, messageDialog } = this.refs;
    const messageDialogRefs = messageDialog?.refs ?? {};
    const { alert, messageErrorSubscribed } = messageDialogRefs;

    const liveUrl = window.location.href;
    const result = liveUrl.includes("form_type=customer");
    const isSubscribed = result && input.value.length != 0;

    if (isSubscribed && messageErrorSubscribed && !alert) {
      messageErrorSubscribed.classList.remove("hidden");
    }

    if (isSubscribed || alert) {
      if (!window.isMessageDialogShow) {
        messageDialog && messageDialog.showDialog();
        window.isMessageDialogShow = true;
      }
    }
  }
}

if (!customElements.get("newsletter-form")) {
  customElements.define("newsletter-form", NewsletterForm);
}

class SlideshowComponent extends CarouselComponent {
  #resizeObserver;
  /** @type {number | null} */
  #lastSyncedMediaIndex = null;

  constructor() {
    super();
    this.selectedIndex = this.selectedIndex;
  }

  get sectionId() {
    return this.getAttribute("data-section-id");
  }

  get controlType() {
    return this.getAttribute("data-control-type");
  }

  static get observedAttributes() {
    return ["selected-index"];
  }

  get selectedIndex() {
    return parseInt(this.getAttribute("selected-index")) || 0;
  }

  set selectedIndex(index) {
    this.setAttribute("selected-index", `${index}`);
  }

  connectedCallback() {
    super.connectedCallback();

    // Wait for parent CarouselComponent to finish Swiper initialization
    // Check if already initialized (in case event fired before our connectedCallback)
    if (this.swiperInstance) {
      this.#initAfterSwiperReady();
    } else {
      // Listen for carousel:ready event
      this.addEventListener(
        "carousel:ready",
        () => {
          this.#initAfterSwiperReady();
        },
        { once: true }
      );
    }
  }

  #initAfterSwiperReady() {
    this.#init();
    const activeSlide = this.refs.slides?.[0] ?? this.swiperInstance?.slides?.[this.swiperInstance.activeIndex];
    if (activeSlide) this.#updateControlsScheme(activeSlide);
    if (!this.refs.controls) return;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() => this.#updateControlHeight());
    this.#resizeObserver.observe(this.refs.controls);
  }

  updatedCallback() {
    this.addEventListener("carousel:ready", () => this.#initAfterSwiperReady(), { once: true });
    super.updatedCallback?.();
    if (this.swiperInstance && this.refs.controls) {
      this.#resizeObserver?.disconnect();
      this.#resizeObserver = new ResizeObserver(() => this.#updateControlHeight());
      this.#resizeObserver.observe(this.refs.controls);
      const activeSlide = this.refs.slides?.[0] ?? this.swiperInstance?.slides?.[this.swiperInstance.activeIndex];
      if (activeSlide) this.#updateControlsScheme(activeSlide);
    }
  }

  disconnectedCallback() {
    this.#resizeObserver?.disconnect();
    this.#detachSwiperMediaListeners();
    super.disconnectedCallback();
  }

  #detachSwiperMediaListeners() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) return;
    swiper.off("realIndexChange", this.#handleChange);
    swiper.off("slideChangeTransitionEnd", this.#handleSlideTransitionEnd);
  }

  #pauseSlideMedia(index) {
    this.querySelectorAll(`[data-swiper-slide-index="${index}"]`).forEach((slide) => {
      slide.querySelector("deferred-media")?.pauseMedia();
    });
  }

  #playActiveSlideMedia() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) return;

    const activeSlide = swiper.slides[swiper.activeIndex];
    if (!activeSlide) return;

    const deferredMedia = activeSlide.querySelector("deferred-media");
    if (deferredMedia) deferredMedia.playMedia();

    if (!document.body.hasAttribute("data-motion-disabled")) {
      activeSlide.querySelectorAll("motion-component").forEach((el) => {
        el.replay();
      });
    }
  }

  #init() {
    if (typeof this.swiperInstance !== "object") return;
    const { slides, activeIndex } = this.swiperInstance;

    const runMotionReplay = () => {
      if (slides[activeIndex]) {
        const motionEls = slides[activeIndex].querySelectorAll("motion-component[data-motion-hold]");
        motionEls?.forEach((el) => el.replay());
      }
    };

    // When page transitions enabled: start motion slightly before overlay ends for smoother handoff
    const PAGE_TRANSITION_DURATION_MS = 500;
    const MOTION_OVERLAP_MS = 200; // motion starts this many ms before page transition ends

    if (document.body.classList.contains("page-transitions-enabled")) {
      const pageTransition = document.querySelector("page-transition");
      if (pageTransition && !pageTransition.hidden) {
        const startDelay = Math.max(0, PAGE_TRANSITION_DURATION_MS - MOTION_OVERLAP_MS);
        let done = false;
        const runOnce = () => {
          if (done) return;
          done = true;
          runMotionReplay();
        };
        document.addEventListener(ThemeEvents.pageTransitionEnd, runOnce, { once: true });
        setTimeout(runOnce, startDelay);
      } else {
        runMotionReplay();
      }
    } else {
      runMotionReplay();
    }

    this.#detachSwiperMediaListeners();
    this.#lastSyncedMediaIndex = this.swiperInstance.realIndex;
    this.swiperInstance.on("realIndexChange", this.#handleChange);
    this.swiperInstance.on("slideChangeTransitionEnd", this.#handleSlideTransitionEnd);
  }

  #handleChange = (swiper) => {
    const { slides, realIndex, activeIndex } = swiper;
    const previousIndex = this.#lastSyncedMediaIndex ?? this.selectedIndex;

    if (previousIndex !== realIndex) {
      this.#pauseSlideMedia(previousIndex);
    }

    this.selectedIndex = realIndex;
    this.#lastSyncedMediaIndex = realIndex;
    this.#updateControlsScheme(slides[activeIndex]);
  };

  #handleSlideTransitionEnd = () => {
    this.#playActiveSlideMedia();
  };

  #updateControlsScheme(activeSlide) {
    if (!this.refs.controls || !activeSlide) return;
    const classesToRemove = Array.from(this.refs.controls.classList).filter((className) =>
      className.startsWith("color-")
    );
    classesToRemove.forEach((className) => this.refs.controls.classList.remove(className));
    const colorScheme = activeSlide.dataset?.colorScheme;
    if (colorScheme) this.refs.controls.classList.add(colorScheme);
  }

  #updateControlHeight() {
    // Batch read and write to avoid force reflow
    // Safe in ResizeObserver callback but also ensures proper batching
    const height = this.refs.controls.offsetHeight;
    this.style.setProperty("--control-height", `${height}px`);
  }
}

if (!customElements.get("slideshow-component")) {
  customElements.define("slideshow-component", SlideshowComponent);
}

class CollectionHighlight extends Component {
  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  connectedCallback() {
    super.connectedCallback();

    this.#registerDesignModeEvents();
  }

  disconnectedCallback() {
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

        const titleEl = this.getBlockEl(e);
        const index = Number(titleEl.dataset.index);

        this.setActiveTab(index);
      },
      { signal }
    );
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

  isActive(el) {
    return el.getAttribute("aria-current") === "true";
  }

  getBlockEl(event) {
    const { target } = event;

    return target.closest(".collection-highlight__part");
  }

  getTitleEl(event) {
    const { target } = event;

    return target.closest(".collection-highlight__part-title");
  }

  handleNavigationKeys(event) {
    const { key } = event;
    const { titles } = this.refs;

    if (!titles?.length) return;

    const titleEl = this.getTitleEl(event);
    if (!titleEl) return;

    const currentIndex = titles.indexOf(titleEl);
    if (currentIndex === -1) return;

    // Handle Enter/Space to navigate to link
    if (key === "Enter" || key === " ") {
      const linkUrl = titleEl.dataset.linkUrl;
      if (linkUrl) {
        event.preventDefault();
        window.location.href = linkUrl;
      }
      return;
    }

    // Handle navigation keys
    let nextIndex = currentIndex;
    switch (key) {
      case "ArrowDown":
        nextIndex = currentIndex + 1;
        break;
      case "ArrowUp":
        nextIndex = currentIndex - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = titles.length - 1;
        break;
      default:
        return;
    }

    // Clamp index to valid range
    nextIndex = Math.max(0, Math.min(nextIndex, titles.length - 1));

    if (nextIndex !== currentIndex) {
      event.preventDefault();
      titles[nextIndex]?.focus();
    }
  }
}

class CollectionHighlightWithImageCard extends CollectionHighlight {
  #abortController = new AbortController();
  #hoverTracker = null;
  #preventClick = false;
  #initialPreviewHeight = false;
  #currentActiveIndex = 0;

  connectedCallback() {
    super.connectedCallback();

    const { titles, preview } = this.refs;
    const { signal } = this.#abortController;

    if (titles) {
      requestAnimationFrame(() => {
        this.setActiveTab(0);
        requestAnimationFrame(() => {
          if (!this.isConnected) return;
          this.setPreviewHeight();
        });
      });

      this.onTouchChangeHandler = this.onTouchChange.bind(this);
      this.onClickHandler = this.onClick.bind(this);
      this.onKeydownHandler = this.handleNavigationKeys.bind(this);
      this.onMouseOverHandler = this.onMouseOver.bind(this);
      this.textsWrapMouseOverHandler = this.#onTextsWrapMouseOver.bind(this);

      if ("ontouchstart" in window) {
        titles.forEach((item) => {
          item.addEventListener("touchstart", this.onTouchChangeHandler, { signal, passive: true });
          item.addEventListener("click", this.onClickHandler, { signal });
        });
      } else {
        titles.forEach((item) => {
          item.addEventListener("mouseover", this.onMouseOverHandler, { signal });
          item.addEventListener("focus", this.onMouseOverHandler, { signal });
        });

        this.addEventListener("keydown", this.onKeydownHandler, { signal });

        preview.addEventListener("mouseover", this.textsWrapMouseOverHandler, { signal });
      }

      const mqlMobile = window.matchMedia(mediaBreakpointMobile);
      mqlMobile.addEventListener("change", () => this.updatePreviewHeight(), { signal });
    }
  }

  disconnectedCallback() {
    this.#abortController.abort();
    super.disconnectedCallback();
  }

  setPreviewHeight(targetText = null) {
    const { preview, texts } = this.refs;

    if (preview && texts.length > 0) {
      const source = targetText || texts[0];
      if (!source) return;
      preview.style.setProperty("height", `${Math.ceil(source.getBoundingClientRect().height)}px`);
    }
  }

  updatePreviewHeight() {
    const { preview, texts } = this.refs;
    if (!preview || !texts || texts.length === 0) return;

    requestAnimationFrame(() => {
      let maxHeight = 0;
      texts.forEach((el) => {
        maxHeight = Math.max(maxHeight, el.offsetHeight);
      });

      preview.style.setProperty("height", maxHeight + "px");
      this.#initialPreviewHeight = true;
    });
  }

  setActiveTab(newIndex) {
    const { titles, images, texts } = this.refs;

    const newTitle = titles[newIndex];
    const newImage = images[newIndex];
    const newText = texts[newIndex];

    this.#currentActiveIndex = newIndex;

    texts.forEach((el) => el.classList.toggle("is-active", el === newText));
    titles.forEach((el) => {
      const index = Number(el.dataset.index);
      el.setAttribute("aria-current", el === newTitle);
      el.setAttribute("tabindex", index == newIndex ? "0" : "-1");
    });
    images.forEach((el) => {
      el.classList.toggle("is-active", el === newImage);
    });
  }

  onMouseOver(event) {
    if (!this.#initialPreviewHeight) {
      this.updatePreviewHeight();
    }

    const titleEl = this.getTitleEl(event);
    const index = Number(titleEl.dataset.index);

    if (event.type === "mouseover") {
      clearTimeout(this.#hoverTracker);
      this.#hoverTracker = setTimeout(() => {
        if (this.isActive(titleEl)) return;

        this.setActiveTab(index);
      }, 100);
    } else {
      if (this.isActive(titleEl)) return;
      this.setActiveTab(index);
    }
  }

  onTouchChange(event) {
    const titleEl = this.getTitleEl(event);
    const index = Number(titleEl.dataset.index);

    if (this.isActive(titleEl)) {
      this.#preventClick = false;
      return;
    } else {
      this.#preventClick = true;
    }

    this.setActiveTab(index);
  }

  onClick(event) {
    if (this.#preventClick) {
      event.preventDefault();
    }
  }

  #onTextsWrapMouseOver() {
    clearTimeout(this.#hoverTracker);
  }
}

if (!customElements.get("collection-highlight-with-image-card")) {
  customElements.define("collection-highlight-with-image-card", CollectionHighlightWithImageCard);
}

class CollectionsWithBackground extends CollectionHighlight {
  #abortController = new AbortController();
  #hoverTracker = null;
  #preventClick = false;

  connectedCallback() {
    super.connectedCallback();

    const { titles, descriptionsWrap } = this.refs;
    const { signal } = this.#abortController;

    if (titles) {
      requestAnimationFrame(() => {
        this.setActiveTab(0);
      });

      this.onTouchChangeHandler = this.onTouchChange.bind(this);
      this.onClickHandler = this.onClick.bind(this);
      this.onKeydownHandler = this.handleNavigationKeys.bind(this);
      this.onMouseOverHandler = this.onMouseOver.bind(this);
      this.textsWrapMouseOverHandler = this.#onTextsWrapMouseOver.bind(this);

      if ("ontouchstart" in window) {
        titles.forEach((item) => {
          item.addEventListener("touchstart", this.onTouchChangeHandler, { signal, passive: true });
          item.addEventListener("click", this.onClickHandler, { signal });
        });
      } else {
        titles.forEach((item) => {
          item.addEventListener("mouseover", this.onMouseOverHandler, { signal });
          item.addEventListener("focus", this.onMouseOverHandler, { signal });
        });
      }

      this.addEventListener("keydown", this.onKeydownHandler, { signal });

      descriptionsWrap.addEventListener("mouseover", this.textsWrapMouseOverHandler, { signal });

      mediaQueryMobile.addEventListener("change", this.#updatePreviewHeight.bind(this));
    }
  }

  disconnectedCallback() {
    this.#abortController.abort();
    super.disconnectedCallback();
  }

  static get observedAttributes() {
    return ["selected-index"];
  }

  get selectedIndex() {
    return parseInt(this.getAttribute("selected-index")) || 0;
  }

  set selectedIndex(index) {
    this.setAttribute("selected-index", `${index}`);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "selected-index" && oldValue !== null && oldValue !== newValue) {
      const { images } = this.refs;
      if (!images) return;

      const activeImage = images[newValue];

      if (activeImage && !document.body.hasAttribute("data-motion-disabled")) {
        const motionEls = activeImage.querySelectorAll("motion-component");
        motionEls &&
          motionEls.forEach((el) => {
            el.replay();
          });
      }
    }
  }

  #updateControlsScheme() {
    const { container, titles } = this.refs;
    const activeTitle = titles[this.selectedIndex];

    const classesToRemove = Array.from(container.classList).filter((className) => className.startsWith("color-"));
    classesToRemove.forEach((className) => container.classList.remove(className));
    const colorScheme = activeTitle.dataset.colorScheme;
    if (colorScheme) container.classList.add(colorScheme);
  }

  #updatePreviewHeight() {
    const { descriptionsWrap, descriptions, productsWrap, products } = this.refs;

    requestAnimationFrame(() => {
      if (descriptionsWrap && descriptions.length > 0) {
        descriptionsWrap.style.setProperty("height", descriptions[this.selectedIndex].offsetHeight + "px");
      }

      if (productsWrap && products.length > 0) {
        productsWrap.style.setProperty("height", products[this.selectedIndex].offsetHeight + "px");
      }
    });
  }

  setActiveTab(newIndex) {
    const { titles, descriptions, images, products } = this.refs;
    const newTitle = titles[newIndex];
    const newDescription = descriptions[newIndex];
    const newImage = images[newIndex];
    const newProduct = products[newIndex];

    this.selectedIndex = newIndex;

    this.#updatePreviewHeight();
    this.#updateControlsScheme();

    titles.forEach((el) => {
      el.setAttribute("aria-current", el === newTitle);
      el.setAttribute("tabindex", el === newTitle ? "0" : "-1");
      const hlText = el.querySelector("em");
      hlText && hlText.classList.toggle("animate", el === newTitle);
    });
    images.forEach((el) => el.classList.toggle("is-active", el === newImage));
    products.forEach((el) => el.classList.toggle("is-active", el === newProduct));
    descriptions.forEach((el) => el.classList.toggle("is-active", el === newDescription));
  }

  onMouseOver(event) {
    const titleEl = this.getTitleEl(event);
    const index = Number(titleEl.dataset.index);

    clearTimeout(this.#hoverTracker);
    this.#hoverTracker = setTimeout(() => {
      if (this.isActive(titleEl)) return;

      this.setActiveTab(index);
    }, 100);
  }

  onTouchChange(event) {
    const titleEl = this.getTitleEl(event);
    const index = Number(titleEl.dataset.index);

    if (this.isActive(titleEl)) {
      this.#preventClick = false;
      return;
    } else {
      this.#preventClick = true;
    }

    this.setActiveTab(index);
  }

  onClick(event) {
    if (this.#preventClick) {
      event.preventDefault();
    }
  }

  #onTextsWrapMouseOver() {
    clearTimeout(this.#hoverTracker);
  }
}

if (!customElements.get("collections-with-background")) {
  customElements.define("collections-with-background", CollectionsWithBackground);
}

class CollectionsWithImage extends CollectionHighlight {
  #abortController = new AbortController();
  #hoverTracker = null;
  #preventClick = false;
  #initialPreviewHeight = false;

  connectedCallback() {
    super.connectedCallback();

    const { titles } = this.refs;
    const { signal } = this.#abortController;

    if (titles) {
      requestAnimationFrame(() => {
        this.setActiveTab(0);
        requestAnimationFrame(() => {
          if (!this.isConnected) return;
          this.setPreviewHeight();
        });
      });

      this.onTouchChangeHandler = this.onTouchChange.bind(this);
      this.onClickHandler = this.onClick.bind(this);
      this.onKeydownHandler = this.handleNavigationKeys.bind(this);
      this.onMouseOverHandler = this.onMouseOver.bind(this);

      if ("ontouchstart" in window) {
        titles.forEach((item) => {
          item.addEventListener("touchstart", this.onTouchChangeHandler, { signal, passive: true });
          item.addEventListener("click", this.onClickHandler, { signal });
        });
      } else {
        titles.forEach((item) => {
          item.addEventListener("mouseover", this.onMouseOverHandler, { signal });
          item.addEventListener("focus", this.onMouseOverHandler, { signal });
        });
      }

      this.addEventListener("keydown", this.onKeydownHandler, { signal });

      const mqlMobile = window.matchMedia(mediaBreakpointMobile);
      mqlMobile.addEventListener("change", () => this.updatePreviewHeight(), { signal });
    }
  }

  disconnectedCallback() {
    this.#abortController.abort();
    super.disconnectedCallback();
  }

  setupPreview() {
    const { titles, preview } = this.refs;

    titles.forEach((item) => {
      const templateEl = item.querySelector("template");
      if (templateEl) {
        const titlePreview = templateEl.content.firstElementChild.cloneNode(true);
        preview.append(titlePreview);
      }
    });

    this.updatePreviewHeight();
  }

  setPreviewHeight(targetProduct = null) {
    const { preview, products } = this.refs;

    if (preview && products.length > 0) {
      const source = targetProduct || products[0];
      if (!source) return;
      preview.style.setProperty("height", `${Math.ceil(source.getBoundingClientRect().height)}px`);
    }
  }

  updatePreviewHeight() {
    const { preview, products } = this.refs;
    if (!preview || !products || products.length === 0) return;

    requestAnimationFrame(() => {
      let maxHeight = 0;
      products.forEach((el) => {
        maxHeight = Math.max(maxHeight, el.offsetHeight);
      });

      preview.style.setProperty("height", maxHeight + "px");
      this.#initialPreviewHeight = true;
    });
  }

  setActiveTab(newIndex) {
    const { titles, images, products } = this.refs;
    const newTitle = titles[newIndex];
    const newImage = images[newIndex];
    const newProduct = products[newIndex];

    titles.forEach((el) => {
      el.setAttribute("aria-current", el === newTitle);
      el.setAttribute("tabindex", el === newTitle ? "0" : "-1");
      const hlText = el.querySelector("em");
      hlText && hlText.classList.toggle("animate", el === newTitle);
    });
    images.forEach((el) => el.classList.toggle("is-active", el === newImage));
    products.forEach((el) => el.classList.toggle("is-active", el === newProduct));
  }

  onMouseOver(event) {
    if (!this.#initialPreviewHeight) {
      this.updatePreviewHeight();
    }

    const titleEl = this.getTitleEl(event);
    const index = Number(titleEl.dataset.index);

    clearTimeout(this.#hoverTracker);
    this.#hoverTracker = setTimeout(() => {
      if (this.isActive(titleEl)) return;

      this.setActiveTab(index);
    }, 100);
  }

  onTouchChange(event) {
    const titleEl = this.getTitleEl(event);
    const index = Number(titleEl.dataset.index);

    if (this.isActive(titleEl)) {
      this.#preventClick = false;
      return;
    } else {
      this.#preventClick = true;
    }

    this.setActiveTab(index);
  }

  onClick(event) {
    if (this.#preventClick) {
      event.preventDefault();
    }
  }
}

if (!customElements.get("collections-with-image")) {
  customElements.define("collections-with-image", CollectionsWithImage);
}

class CollectionHighlightScrolling extends Component {
  requiredRefs = ["spacer", "container", "imagesWrap", "titlesContainer", "titlesWrap", "wrapper", "sectionContainer"];

  #lenis = null;
  #headerHeight = 0;
  #offsetHeight = 0;
  #visualHeight = 0;
  #offsetTop = 0;
  #stickySpacing = 30;
  #isInViewport = false;
  #cachedStartPoint = null;
  #cachedEndPoint = null;
  #cachedScrollRange = null;
  #cachedViewportHeight = 0;
  #imagesWrapMaxTranslateY = 0;
  #titlesWrapMaxTranslateY = 0;
  #desktopScrollHandler = null;
  #rafId = null;
  #intersectionObserver = null;
  #resizeObserver = null;
  #mediaQueryChangeHandler = null;
  #shopifyAbortController = null;
  #initObserver = null;
  #initialApplied = false;

  static #INIT_OBSERVER_MARGIN = "300px 0px";

  get sectionId() {
    return this.dataset.sectionId ?? "";
  }

  connectedCallback() {
    super.connectedCallback();

    this.#mediaQueryChangeHandler = () => {
      this.#initialApplied = true;
      this.#applyBreakpointLayout();
    };
    mediaQueryMobile.addEventListener("change", this.#mediaQueryChangeHandler);
    this.#registerDesignModeEvents();
    this.#scheduleInitialApply();
  }

  #scheduleInitialApply() {
    if (this.#initialApplied) return;

    if (typeof IntersectionObserver !== "undefined") {
      this.#initObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry?.isIntersecting) return;
          this.#initObserver?.disconnect();
          this.#initObserver = null;
          this.#initialApplied = true;
          this.#applyBreakpointLayout();
        },
        { rootMargin: CollectionHighlightScrolling.#INIT_OBSERVER_MARGIN }
      );
      this.#initObserver.observe(this);
    } else {
      this.#initialApplied = true;
      this.#applyBreakpointLayout();
    }
  }

  #isDesktop() {
    return !mediaQueryMobile.matches;
  }

  #applyBreakpointLayout() {
    if (this.#isDesktop()) {
      this.#setupIntersectionObserver();
      this.#setupResizeObserver();
      this.#setupSpacer();
      if (!this.#desktopScrollHandler) {
        this.#lenis = getLenis();
        this.#desktopScrollHandler = () => {
          if (!this.#isInViewport) return;
          if (this.#rafId) cancelAnimationFrame(this.#rafId);
          this.#rafId = requestAnimationFrame(() => {
            this.#updateScrollTransform();
            this.#rafId = null;
          });
        };
      }
      this.#addScrollListener();
      requestAnimationFrame(() => this.#updateScrollTransform());
    } else {
      this.#removeScrollListener();
      this.#cleanUpObservers();
      this.#cleanUpSticky();
    }
  }

  #addScrollListener() {
    if (!this.#desktopScrollHandler) return;
    this.#lenis = getLenis();
    if (this.#lenis) {
      this.#lenis.on("scroll", this.#desktopScrollHandler);
    } else {
      window.addEventListener("scroll", this.#desktopScrollHandler, { passive: true });
    }
  }

  #removeScrollListener() {
    if (!this.#desktopScrollHandler) return;
    if (this.#lenis) {
      this.#lenis.off("scroll", this.#desktopScrollHandler);
    } else {
      window.removeEventListener("scroll", this.#desktopScrollHandler, { passive: true });
    }
  }

  #cleanUpSticky() {
    const { spacer, container, imagesWrap, titlesWrap } = this.refs;
    if (container) {
      container.style.removeProperty("position");
      container.style.removeProperty("top");
      container.style.removeProperty("height");
    }
    if (spacer) spacer.style.height = "0";
    this.style.removeProperty("--container-height");
    if (imagesWrap) imagesWrap.style.transform = "translateY(0)";
    if (titlesWrap) titlesWrap.style.transform = "translateY(0)";
    this.#setScrollStateClasses(0);
    this.#setActiveTitleByIndex(0);
    this.#invalidateCache();
  }

  #cleanUpObservers() {
    this.#intersectionObserver?.disconnect();
    this.#intersectionObserver = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
  }

  #setupIntersectionObserver() {
    if (this.#intersectionObserver) return;

    const { container } = this.refs;
    if (!container) return;

    const options = { root: null, rootMargin: "0px", threshold: 0 };
    this.#intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        this.#isInViewport = entry.isIntersecting;
        if (this.#isInViewport) {
          requestAnimationFrame(() => this.#updateScrollTransform());
        }
      }
    }, options);
    this.#intersectionObserver.observe(container);
  }

  #setupResizeObserver() {
    if (this.#resizeObserver) return;

    this.#resizeObserver = new ResizeNotifier(() => {
      this.#invalidateCache();
      this.#setupSpacer();
      requestAnimationFrame(() => this.#updateScrollTransform());
    });
    this.#resizeObserver.observe(this);
  }

  #invalidateCache() {
    this.#cachedStartPoint = null;
  }

  #setupSpacer() {
    if (!this.#isDesktop()) {
      this.#cleanUpSticky();
      return;
    }

    const { spacer, container } = this.refs;
    if (!spacer || !container) return;

    requestAnimationFrame(() => {
      if (!this.#isDesktop()) return;

      container.style.removeProperty("position");
      container.style.removeProperty("top");
      container.style.removeProperty("height");
      this.#headerHeight = document.querySelector(".header")?.offsetHeight || 0;
      this.#offsetHeight = container.offsetHeight;
      this.#cachedViewportHeight = window.innerHeight;
      this.#visualHeight = this.#cachedViewportHeight - this.#headerHeight - this.#stickySpacing * 2;
      this.#offsetTop = this.#headerHeight + this.#stickySpacing;

      spacer.style.height = `${this.#offsetHeight}px`;
      this.style.setProperty("--container-height", `${this.#visualHeight}px`);
      container.style.setProperty("position", "sticky");
      container.style.setProperty("top", `${this.#offsetTop}px`);
      container.style.setProperty("height", `${this.#visualHeight}px`);
    });
  }

  #updateScrollTransform() {
    if (!this.#isDesktop()) {
      this.#cleanUpSticky();
      return;
    }

    const { imagesWrap, titlesWrap, titlesContainer, wrapper, container, sectionContainer } = this.refs;
    if (!imagesWrap || !titlesWrap || !titlesContainer || !container) return;

    const scrollTop = this.#lenis ? this.#lenis.scroll : (window.pageYOffset ?? document.documentElement.scrollTop);
    const isSticky = scrollTop >= (this.#cachedStartPoint ?? 0);

    if (prefersReducedMotion() || !isSticky) {
      if (this._lastImgY !== 0) {
        this._lastImgY = 0;
        imagesWrap.style.transform = "translateY(0)";
      }
      if (this._lastTitY !== 0) {
        this._lastTitY = 0;
        titlesWrap.style.transform = "translateY(0)";
      }
      this.#setScrollStateClasses(0);
      this.#setActiveTitleByIndex(0);
      return;
    }

    const viewportHeight = this.#cachedViewportHeight || window.innerHeight;

    if (this.#cachedStartPoint === null) {
      const sectionEl = sectionContainer ?? this;
      const rect = sectionEl.getBoundingClientRect();
      const sectionTop = rect.top + scrollTop;
      const sectionBottom = sectionTop + rect.height;

      this.#cachedStartPoint = sectionTop;
      this.#cachedEndPoint = sectionBottom - viewportHeight;
      this.#cachedScrollRange = this.#cachedEndPoint - this.#cachedStartPoint;

      if (wrapper && this.#cachedScrollRange > 0) {
        const wrapperStyle = getComputedStyle(wrapper);
        const paddingTop = parseFloat(wrapperStyle.paddingTop);
        const paddingBottom = parseFloat(wrapperStyle.paddingBottom);
        const paddingBlock = paddingTop + paddingBottom;
        const wrapContentHeight = wrapper.clientHeight - paddingBlock;
        const wrapperRect = wrapper.getBoundingClientRect();
        const wrapperContentTop = wrapperRect.top + paddingTop;
        const wrapperContentBottom = wrapperRect.bottom - paddingBottom;
        const titlesContainerRect = titlesContainer.getBoundingClientRect();
        const titlesVisibleHeight = Math.max(
          0,
          Math.min(titlesContainerRect.bottom, wrapperContentBottom) -
            Math.max(titlesContainerRect.top, wrapperContentTop)
        );
        const imagesHeight = imagesWrap.scrollHeight;
        const titlesHeight = titlesWrap.scrollHeight;
        this.#imagesWrapMaxTranslateY = -Math.max(0, imagesHeight - wrapContentHeight);
        this.#titlesWrapMaxTranslateY = -Math.max(0, titlesHeight - titlesVisibleHeight);
      }
    }

    if (this.#cachedScrollRange <= 0) {
      if (this._lastImgY !== 0) {
        this._lastImgY = 0;
        imagesWrap.style.transform = "translateY(0)";
      }
      if (this._lastTitY !== 0) {
        this._lastTitY = 0;
        titlesWrap.style.transform = "translateY(0)";
      }
      this.#setScrollStateClasses(0);
      this.#setActiveTitleByIndex(0);
      return;
    }

    const progress = Math.max(0, Math.min(1, (scrollTop - this.#cachedStartPoint) / this.#cachedScrollRange));
    const imgY = Math.round(this.#imagesWrapMaxTranslateY * progress * 10) / 10;
    const titY = Math.round(this.#titlesWrapMaxTranslateY * progress * 10) / 10;

    if (this._lastImgY !== imgY) {
      this._lastImgY = imgY;
      imagesWrap.style.transform = `translateY(${imgY}px)`;
    }
    if (this._lastTitY !== titY) {
      this._lastTitY = titY;
      titlesWrap.style.transform = `translateY(${titY}px)`;
    }

    this.#setScrollStateClasses(progress);

    const imgCount = Array.isArray(this.refs.images) ? this.refs.images.length : 0;
    if (imgCount > 0) {
      const activeIndex = Math.min(imgCount - 1, Math.round(progress * (imgCount - 1)));
      this.#setActiveTitleByIndex(activeIndex);
    }
  }

  #setScrollStateClasses(progress) {
    const atBeginning = progress <= 0;
    const atEnd = progress >= 1;
    if (this._wasBeginning !== atBeginning) {
      this._wasBeginning = atBeginning;
      this.classList.toggle("is--beginning", atBeginning);
    }
    if (this._wasEnd !== atEnd) {
      this._wasEnd = atEnd;
      this.classList.toggle("is--end", atEnd);
    }
  }

  #setActiveTitleByIndex(activeIndex) {
    const { titles } = this.refs;
    if (!Array.isArray(titles) || titles.length === 0) return;

    const count = titles.length;
    const index = Math.min(count - 1, Math.max(0, activeIndex));

    if (this._lastActiveIndex === index) return;

    const prev = this._lastActiveIndex;
    if (prev != null && prev >= 0 && prev < count) {
      titles[prev].setAttribute("aria-current", "false");
      titles[prev].querySelector("em")?.classList.toggle("animate", false);
    }

    titles[index].setAttribute("aria-current", "true");
    titles[index].querySelector("em")?.classList.toggle("animate", true);

    this._lastActiveIndex = index;
  }

  #registerDesignModeEvents() {
    if (!(window.Shopify && Shopify.designMode)) return;

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (e) => {
        if (String(e.detail?.sectionId) !== String(this.sectionId)) return;

        const part = e.target?.closest(".collection-highlight__part");
        const indexRaw = part?.dataset?.index;
        const index = parseInt(indexRaw, 10);
        if (Number.isNaN(index) || index < 0) return;

        this.#onBlockSelect(index);
      },
      { signal }
    );
  }

  #onBlockSelect(index) {
    this.#setActiveTitleByIndex(index);

    if (!this.#isDesktop()) {
      const { images } = this.refs;
      const el = Array.isArray(images) && images[index] ? images[index] : null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const { sectionContainer, images } = this.refs;
    const count = Array.isArray(images) ? images.length : 0;
    if (count === 0) return;

    const sectionEl = sectionContainer ?? this;
    const rect = sectionEl.getBoundingClientRect();
    const scrollTop = this.#lenis ? this.#lenis.scroll : (window.pageYOffset ?? document.documentElement.scrollTop);
    const viewportHeight = window.innerHeight;
    const sectionTop = rect.top + scrollTop;
    const sectionHeight = rect.height;
    const scrollRange = Math.max(0, sectionHeight - viewportHeight);
    const progress = count > 1 ? Math.min(1, Math.max(0, index / (count - 1))) : 0;
    const targetScroll = sectionTop + progress * scrollRange;

    if (this.#lenis) {
      this.#lenis.scrollTo(targetScroll, { immediate: false });
    } else {
      window.scrollTo({ top: targetScroll, behavior: "smooth" });
    }

    this.#invalidateCache();
    requestAnimationFrame(() => this.#updateScrollTransform());
  }

  disconnectedCallback() {
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    mediaQueryMobile.removeEventListener("change", this.#mediaQueryChangeHandler);
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    this.#initObserver?.disconnect();
    this.#initObserver = null;
    this.#removeScrollListener();
    this.#cleanUpObservers();
    super.disconnectedCallback();
  }
}

if (!customElements.get("collection-highlight-scrolling")) {
  customElements.define("collection-highlight-scrolling", CollectionHighlightScrolling);
}

class FeaturedCollection extends Component {
  connectedCallback() {
    super.connectedCallback();

    const { slider } = this.refs;

    if (slider) {
      if (slider.swiperInstance) {
        this.#initSliderNavigation();
      } else {
        slider.addEventListener(
          "carousel:ready",
          () => {
            this.#initSliderNavigation();
          },
          { once: true }
        );
      }
    }
  }

  updatedCallback() {
    super.updatedCallback?.();
    const { slider } = this.refs;
    if (slider) {
      slider.addEventListener("carousel:ready", () => this.#initSliderNavigation(), { once: true });
    }
  }

  #initSliderNavigation() {
    const { slider, controls, next, prev } = this.refs;

    controls.classList.remove("hidden");
    slider.swiperInstance.params.navigation.nextEl = next;
    slider.swiperInstance.params.navigation.prevEl = prev;
    slider.swiperInstance.navigation.init();
    slider.swiperInstance.navigation.update();
  }
}

if (!customElements.get("featured-collection")) {
  customElements.define("featured-collection", FeaturedCollection);
}

class LocalPickup extends Component {
  /** @type {AbortController | undefined} */
  #activeFetch;

  connectedCallback() {
    super.connectedCallback();

    const closestSection = this.closest(`.shopify-section, dialog`);

    /** @type {(event: VariantUpdateEvent) => void} */
    const variantUpdated = (event) => {
      if (event.detail.data.newProduct) {
        this.dataset.productUrl = event.detail.data.newProduct.url;
      }

      const variantId = event.detail.resource ? event.detail.resource.id : null;
      const variantAvailable = event.detail.resource ? event.detail.resource.available : null;
      if (variantId !== this.dataset.variantId) {
        if (variantId && variantAvailable) {
          this.classList.remove("hidden");
          this.dataset.variantId = variantId;
          this.#fetchAvailability(variantId);
        } else {
          this.classList.add("hidden");
        }
      }
    };

    closestSection?.addEventListener(ThemeEvents.variantUpdate, variantUpdated);

    this.disconnectedCallback = () => {
      closestSection?.removeEventListener(ThemeEvents.variantUpdate, variantUpdated);
    };
  }

  #createAbortController() {
    if (this.#activeFetch) this.#activeFetch.abort();
    this.#activeFetch = new AbortController();
    return this.#activeFetch;
  }

  /**
   * Fetches the availability of a variant.
   * @param {string} variantId - The ID of the variant to fetch availability for.
   */
  #fetchAvailability = (variantId) => {
    if (!variantId) return;

    const abortController = this.#createAbortController();

    const url = this.dataset.productUrl;
    fetch(`${url}?variant=${variantId}&section_id=${this.dataset.sectionId}`, {
      signal: abortController.signal,
    })
      .then((response) => response.text())
      .then((text) => {
        if (abortController.signal.aborted) return;

        const html = new DOMParser().parseFromString(text, "text/html");
        const wrapper = html.querySelector(`local-pickup[data-variant-id="${variantId}"]`);
        if (wrapper) {
          this.classList.remove("hidden");
          morph(this, wrapper);
        } else this.classList.add("hidden");
      })
      .catch((_e) => {
        if (abortController.signal.aborted) return;
        this.classList.add("hidden");
      });
  };
}

if (!customElements.get("local-pickup")) {
  customElements.define("local-pickup", LocalPickup);
}

class ScrollingCards extends Component {
  #shopifyAbortController;

  constructor() {
    super();
    this.desktopScrollHandler = null;
    this.resizeHandler = null;
    this.rafId = null;
    this.resizeTimeout = null;
    this.lenis = null;
    this.intersectionObserver = null;
    this.resizeObserver = null;
    this.isInViewport = false;
    // Cache positions to avoid getBoundingClientRect() on every scroll
    this.cachedStartPoint = null;
    this.cachedEndPoint = null;
    this.cachedScrollRange = null;
    this.needsRecalculation = true;
    // Cache viewport height to avoid reading window.innerHeight in scroll handler
    // (Safari mobile triggers layout when URL bar animates)
    this.cachedViewportHeight = null;
  }

  connectedCallback() {
    super.connectedCallback();

    this.scrollHandler = this.animateHeadings.bind(this);

    const updateLayout = (isMobile) => {
      const { headingWrap, headings, scrollEl } = this.refs;

      if (!headings || !scrollEl) {
        return;
      }

      const firstTextEl = headings.querySelector(".text-block");
      if (!firstTextEl) return;

      // Batch all layout reads first
      const firstTextStyle = window.getComputedStyle(firstTextEl);
      const lineHeight = parseFloat(firstTextStyle.lineHeight);
      const contentHeight = headings.offsetHeight;

      // Then perform calculations
      const doubleLineHeight = lineHeight * this.headingLinesToShow;
      const wrapHeight = Math.min(doubleLineHeight, contentHeight);

      // Finally, batch all writes
      headingWrap.style.height = `${wrapHeight}px`;

      if (wrapHeight >= contentHeight) {
        // Reset transform if no animation needed
        headings.style.transform = "translate3d(0, 0, 0)";
        this.cleanup();
        return;
      }

      this.headingsTranslateY = 0 - (contentHeight - wrapHeight);

      // Mark positions as needing recalculation after layout change
      this.needsRecalculation = true;

      // Clean up previous handlers
      this.cleanup();

      if (isMobile) {
        this.initMobileAnimation();
      } else {
        this.initDesktopAnimation();
      }

      // Update animation position immediately after layout change
      this.updateAnimationPosition();
    };

    // Defer entire initialization to avoid force reflow in connectedCallback
    requestAnimationFrame(() => {
      updateLayout(mediaQueryMobile.matches);
    });

    mediaQueryMobile.onchange = (event) => {
      requestAnimationFrame(() => {
        updateLayout(event.matches);
      });
    };

    // Setup resize handler to recalculate layout
    this.setupResizeHandler(updateLayout, mediaQueryMobile);
    this.#registerDesignModeEvents();

    this.boundFocusinHandler = this.#handleHeadingFocusin.bind(this);
    this.addEventListener("focusin", this.boundFocusinHandler);
  }

  setupResizeHandler(updateLayout, mqlMobile) {
    // Cache viewport height on init (avoid reading window.innerHeight in scroll handler)
    this.cachedViewportHeight = window.innerHeight;

    // Throttle resize handler to avoid excessive recalculations
    this.resizeHandler = () => {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }

      // Use RAF + timeout for smooth resize handling
      this.resizeTimeout = setTimeout(() => {
        // Update cached viewport height on resize
        this.cachedViewportHeight = window.innerHeight;
        this.needsRecalculation = true;
        requestAnimationFrame(() => {
          updateLayout(mqlMobile.matches);
        });
      }, 150);
    };

    window.addEventListener("resize", this.resizeHandler, { passive: true });
  }

  updateAnimationPosition() {
    // Update animation position based on current scroll state
    const { headings, cards } = this.refs;

    if (!headings || !cards || cards.length === 0) {
      return;
    }

    if (isMobileBreakpoint()) {
      // Mobile: update based on horizontal scroll
      this.animateHeadings();
    } else {
      // Desktop: update based on window scroll
      const firstColumn = cards[0];
      const lastColumn = cards[cards.length - 1];
      // Force recalculation when explicitly updating position after layout change
      this.needsRecalculation = true;
      this.updateDesktopAnimation(firstColumn, lastColumn, headings);
    }
  }

  get headingLinesToShow() {
    return 2;
  }

  initDesktopAnimation() {
    const { headings, cards } = this.refs;

    if (!headings || !cards || cards.length === 0) {
      return;
    }

    const firstColumn = cards[0];
    const lastColumn = cards[cards.length - 1];

    // Setup IntersectionObserver to pause animation when component is out of viewport
    // This prevents unnecessary calculations and layout thrashing on Safari
    this.setupIntersectionObserver(firstColumn, lastColumn);

    // Direct update function (no extra RAF wrapping)
    const updateAnimation = () => {
      if (!this.isInViewport) return;
      this.updateDesktopAnimation(firstColumn, lastColumn, headings);
    };

    // Use Lenis smooth scroll if available, otherwise fallback to native scroll
    this.lenis = getLenis();

    if (this.lenis) {
      // Lenis already runs its scroll callback inside RAF,
      // so we call updateAnimation directly — no extra RAF needed.
      // Wrapping in another RAF would delay by 1 frame → visible shimmer.
      this.desktopScrollHandler = updateAnimation;

      // Listen to Lenis scroll events (shared instance with other sections)
      this.lenis.on("scroll", this.desktopScrollHandler);
    } else {
      // Fallback to native scroll if Lenis not available yet
      // Note: Lenis is initialized early globally, but may not be ready if component init is very early
      // Retry logic ensures we switch to Lenis once it's available
      this.desktopScrollHandler = () => {
        if (!this.isInViewport) return;

        // Try to get Lenis again (in case it finished loading after component init)
        if (!this.lenis) {
          const retryLenis = getLenis();
          if (retryLenis) {
            this.lenis = retryLenis;
            window.removeEventListener("scroll", this.desktopScrollHandler);
            // Switch to direct handler (Lenis already in RAF)
            this.desktopScrollHandler = updateAnimation;
            this.lenis.on("scroll", this.desktopScrollHandler);
            return;
          }
        }

        // Native scroll needs RAF to sync with browser's render cycle
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
        }
        this.rafId = requestAnimationFrame(() => {
          updateAnimation();
          this.rafId = null;
        });
      };

      window.addEventListener("scroll", this.desktopScrollHandler, { passive: true });
    }

    // Initial update
    requestAnimationFrame(() => {
      this.updateDesktopAnimation(firstColumn, lastColumn, headings);
    });
  }

  setupIntersectionObserver(firstColumn, lastColumn) {
    // Use IntersectionObserver to detect when component enters/leaves viewport
    // This helps pause calculations when component is not visible, reducing layout thrashing
    const options = {
      root: null,
      rootMargin: "50% 0px", // Start observing before component enters viewport
      threshold: 0,
    };

    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        this.isInViewport = entry.isIntersecting;
        // If component enters viewport, mark positions as needing recalculation
        if (this.isInViewport) {
          this.needsRecalculation = true;
        }
      });
    }, options);

    // Observe the container element (this) to detect when it enters/leaves viewport
    this.intersectionObserver.observe(this);

    // Setup ResizeObserver to detect when columns change size (layout shifts from other sections)
    // This is critical for Safari when scrolling between sections
    // Debounce with RAF to avoid multiple invalidations per frame (e.g. lazy-loaded images)
    let resizeRafId = null;
    this.resizeObserver = new ResizeObserver(() => {
      if (resizeRafId) return;
      resizeRafId = requestAnimationFrame(() => {
        this.needsRecalculation = true;
        resizeRafId = null;
      });
    });

    // Observe both columns to detect layout changes
    if (firstColumn) {
      this.resizeObserver.observe(firstColumn);
    }
    if (lastColumn) {
      this.resizeObserver.observe(lastColumn);
    }
  }

  updateDesktopAnimation(firstColumn, lastColumn, headings) {
    // Early return if not in viewport to avoid unnecessary calculations
    if (!this.isInViewport) {
      return;
    }

    // Use Lenis scroll position if available, otherwise fallback to native scroll
    const scrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;

    // Use cached viewport height (updated on resize) to avoid reading window.innerHeight
    // in scroll handler — Safari mobile triggers layout when URL bar animates
    const viewportHeight = this.cachedViewportHeight || window.innerHeight;

    // Only recalculate positions when needed (layout change, resize, first time)
    // Invalidation is handled by ResizeObserver + IntersectionObserver, no need for
    // significantScrollChange heuristic which caused unnecessary getBoundingClientRect()
    // calls during fast scrolling (major source of layout thrashing on Safari)
    if (this.needsRecalculation || this.cachedStartPoint === null) {
      // Batch layout reads together to minimize forced reflows
      const firstRect = firstColumn.getBoundingClientRect();
      const lastRect = lastColumn.getBoundingClientRect();

      // Calculate absolute positions from document top
      const firstTop = firstRect.top + scrollTop;
      const lastBottom = lastRect.bottom + scrollTop;

      // ScrollTrigger equivalent:
      // start: "top top" = when firstColumn top reaches viewport top
      // end: "bottom bottom" = when lastColumn bottom reaches viewport bottom
      this.cachedStartPoint = firstTop;
      this.cachedEndPoint = lastBottom - viewportHeight;
      this.cachedScrollRange = this.cachedEndPoint - this.cachedStartPoint;

      // Mark as calculated
      this.needsRecalculation = false;
    }

    if (this.cachedScrollRange <= 0) {
      if (this._lastHeadingY !== 0) {
        this._lastHeadingY = 0;
        headings.style.transform = "translate3d(0, 0, 0)";
      }
      return;
    }

    const progress = Math.max(0, Math.min(1, (scrollTop - this.cachedStartPoint) / this.cachedScrollRange));
    const y = Math.round(this.headingsTranslateY * progress * 10) / 10;

    if (this._lastHeadingY !== y) {
      this._lastHeadingY = y;
      headings.style.transform = `translate3d(0, ${y}px, 0)`;
    }
  }

  initMobileAnimation() {
    const { scrollEl } = this.refs;

    if (!scrollEl) {
      return;
    }

    this._cachedMaxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
    scrollEl.addEventListener("scroll", this.scrollHandler, { passive: true });
  }

  cleanup() {
    // Clean up desktop scroll listener
    if (this.desktopScrollHandler) {
      if (this.lenis) {
        // Remove Lenis scroll listener
        this.lenis.off("scroll", this.desktopScrollHandler);
      } else {
        // Remove native scroll listener
        window.removeEventListener("scroll", this.desktopScrollHandler);
      }
      this.desktopScrollHandler = null;
    }

    // Clean up IntersectionObserver
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    // Clean up ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // Cancel pending RAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Cancel pending resize timeout
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    // Clean up mobile scroll listener
    if (this.refs.scrollEl) {
      this.refs.scrollEl.removeEventListener("scroll", this.scrollHandler);
    }

    // Reset cached values
    this.cachedStartPoint = null;
    this.cachedEndPoint = null;
    this.cachedScrollRange = null;
    this.needsRecalculation = true;
  }

  animateHeadings() {
    const { scrollEl, headings } = this.refs;

    if (!scrollEl || !headings) {
      return;
    }

    const scrollLeft = Math.ceil(scrollEl.scrollLeft);
    const maxScroll = this._cachedMaxScroll ?? scrollEl.scrollWidth - scrollEl.clientWidth;

    if (maxScroll <= 0) {
      if (this._lastMobileY !== 0) {
        this._lastMobileY = 0;
        headings.style.transform = "translate3d(0, 0, 0)";
      }
      return;
    }

    const scrolledRatio = scrollLeft / maxScroll;
    const y = Math.ceil(this.headingsTranslateY * scrolledRatio);

    if (this._lastMobileY !== y) {
      this._lastMobileY = y;
      headings.style.transform = `translate3d(0, ${y}px, 0)`;
    }
  }

  disconnectedCallback() {
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();

    if (this.boundFocusinHandler) {
      this.removeEventListener("focusin", this.boundFocusinHandler);
      this.boundFocusinHandler = null;
    }

    this.cleanup();
  }

  get sectionId() {
    return this.dataset.sectionId || "";
  }

  #handleHeadingFocusin(e) {
    const { target } = e;
    if (target.closest(".block-scrolling__headings")) {
      this.#scrollToHeadingBlock(target);
    }
  }

  #registerDesignModeEvents() {
    if (!(window.Shopify && Shopify.designMode)) return;

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (e) => {
        if (e.detail.sectionId != this.sectionId) return;

        const { target } = e;

        // Heading block selected.
        const headingsContainer = target.closest(".block-scrolling__headings");
        if (headingsContainer) {
          this.#scrollToHeadingBlock(target);
          return;
        }

        // Card block selected.
        const cardEl = target.closest(".scrolling-cards__card");
        if (isMobileBreakpoint() && cardEl) {
          const { cards, scrollEl } = this.refs;
          const index = Array.from(cards).indexOf(cardEl);
          if (index >= 0) {
            const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
            if (maxScroll > 0) {
              const targetLeft = cardEl.offsetLeft - (scrollEl.clientWidth - cardEl.offsetWidth) / 2;
              scrollEl.scrollTo({
                left: Math.max(0, Math.min(targetLeft, maxScroll)),
                behavior: "smooth",
              });
            }
            this.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      },
      { signal }
    );
  }

  #scrollToHeadingBlock(target) {
    const { headings: headingsContainer, cards, scrollEl } = this.refs;
    const selectedTextBlock = target.closest(".text-block");
    const index = selectedTextBlock ? Array.from(headingsContainer.children).indexOf(selectedTextBlock) : 0;
    const N = Math.max(1, headingsContainer.children.length);

    if (isMobileBreakpoint()) {
      if (scrollEl) {
        const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
        if (maxScroll > 0) {
          let ratio;
          if (index === 0) {
            ratio = 1;
          } else if (index === N - 1) {
            ratio = 0;
          } else {
            const containerRect = headingsContainer.getBoundingClientRect();
            const textRect = selectedTextBlock.getBoundingClientRect();
            const offsetTop = containerRect.height - (textRect.top - containerRect.top + textRect.height / 2);
            ratio = offsetTop / containerRect.height;
          }

          ratio = 1 - Math.max(0, Math.min(1, ratio));
          const targetLeft = Math.max(0, Math.min(maxScroll * ratio, maxScroll));

          scrollEl.scrollTo({
            left: targetLeft,
            behavior: "smooth",
          });
        }
      }
    } else {
      if (cards && cards.length > 0) {
        const firstColumn = cards[0];
        const lastColumn = cards[cards.length - 1];
        const scrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;
        const firstRect = firstColumn.getBoundingClientRect();
        const lastRect = lastColumn.getBoundingClientRect();
        const firstTop = firstRect.top + scrollTop;
        const lastBottom = lastRect.bottom + scrollTop;
        const viewportHeight = window.innerHeight;
        const startPoint = firstTop;
        const endPoint = lastBottom - viewportHeight;
        const scrollRange = endPoint - startPoint;
        if (scrollRange > 0) {
          const progress = N > 1 ? index / (N - 1) : 0;
          const targetScrollTop = startPoint + progress * scrollRange;
          const lenis = getLenis();
          if (lenis) {
            lenis.scrollTo(targetScrollTop, { lerp: 0.1 });
          } else {
            window.scrollTo({ top: targetScrollTop, behavior: "smooth" });
          }
        }
      } else {
        this.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }
}

if (!customElements.get("scrolling-cards")) {
  customElements.define("scrolling-cards", ScrollingCards);
}

class ScrollingCardLayered extends Component {
  constructor() {
    super();
    this.scrollHandler = null;
    this.resizeHandler = null;
    this.rafId = null;
    this.resizeTimeout = null;
    this.lenis = null;
    this.cardData = null; // Store card widths, scale ratios, and cached positions
    this.previousTransforms = new Map(); // Cache previous transform values to avoid unnecessary DOM writes
    this.intersectionObserver = null;
    this.isInViewport = false;
    // Cache viewport height to avoid reading in scroll handler
    // (Safari mobile triggers layout when URL bar animates)
    this.cachedViewportHeight = null;
  }

  connectedCallback() {
    super.connectedCallback();

    const mqlMobile = window.matchMedia("screen and (max-width: 767px)");
    const init = () => {
      // Defer all layout reads to avoid force reflow during page load
      // Use double RAF to ensure refs are ready (Component updates refs in requestIdleCallback)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const style = getComputedStyle(this);
          this.stickySpacing = parseFloat(style.getPropertyValue("--sticky-spacing")) * 10;
          this.widthReduced = parseFloat(style.getPropertyValue("--width-reduced")) * 10;

          this.cleanup();
          this.initAnimation();
        });
      });
    };

    init(mqlMobile.matches);
    mqlMobile.onchange = (event) => init(event.matches);
  }

  initAnimation() {
    const { cards } = this.refs;

    if (!Array.isArray(cards) || cards.length === 0) {
      this.cardData = null;
      return;
    }

    const cardCount = cards.length;
    const lastCard = cards[cardCount - 1];
    const headerHeight =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) +
      20 +
      (cards.length - 1) * this.stickySpacing;

    // Batch all layout reads before loop to avoid force reflow
    const cardWidths = [];
    const scaleRatios = [];

    for (let index = 0; index < cardCount; index++) {
      cardWidths[index] = cards[index].offsetWidth;

      if (index < cardCount - 1) {
        const cardWidth = cardWidths[index];
        const newWidth = cardWidth - (cardCount - index - 1) * this.widthReduced;
        scaleRatios[index] = newWidth / cardWidth;
      }
    }

    // Cache absolute positions (document-relative) for ALL cards
    // These are stable during scroll — only change on resize/layout shift
    // This eliminates ALL getBoundingClientRect() calls from the scroll handler
    const lenisInstance = getLenis();
    const currentScrollTop = lenisInstance
      ? lenisInstance.scroll
      : window.pageYOffset || document.documentElement.scrollTop;

    const cardTopsAbsolute = [];
    for (let index = 0; index < cardCount; index++) {
      cardTopsAbsolute[index] = cards[index].getBoundingClientRect().top + currentScrollTop;
    }

    // Cache viewport height (updated on resize, avoids reading in scroll handler)
    this.cachedViewportHeight = window.visualViewport
      ? window.visualViewport.height
      : document.documentElement.clientHeight || window.innerHeight;

    // Store card data — set BEFORE scroll handler to avoid race condition
    this.cardData = {
      cards,
      cardCount,
      lastCard,
      headerHeight,
      cardWidths,
      scaleRatios,
      cardTopsAbsolute,
      lastCardTopAbsolute: cardTopsAbsolute[cardCount - 1],
    };

    // Setup IntersectionObserver to pause when off-screen
    this.setupIntersectionObserver();

    // Direct update function (no throttle, no RAF loop)
    const updateAnimation = () => {
      if (!this.isInViewport || !this.cardData) return;
      this.updateAnimation();
    };

    // Lenis already runs its scroll callback inside RAF — call directly, no throttle needed.
    // Previously throttled to 30fps which capped animation to half frame rate.
    // With cached positions (no DOM reads in scroll handler), 60fps is cheap.
    this.lenis = getLenis();

    if (this.lenis) {
      this.scrollHandler = updateAnimation;
      this.lenis.on("scroll", this.scrollHandler);
    } else {
      // Fallback to native scroll with single RAF
      this.scrollHandler = () => {
        if (!this.isInViewport || !this.cardData) return;

        // Retry Lenis
        if (!this.lenis) {
          const retryLenis = getLenis();
          if (retryLenis) {
            this.lenis = retryLenis;
            window.removeEventListener("scroll", this.scrollHandler);
            this.scrollHandler = updateAnimation;
            this.lenis.on("scroll", this.scrollHandler);
            return;
          }
        }

        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => {
          this.updateAnimation();
          this.rafId = null;
        });
      };
      window.addEventListener("scroll", this.scrollHandler, { passive: true });
    }

    // Initial update
    requestAnimationFrame(() => {
      if (this.cardData) this.updateAnimation();
    });

    // Setup resize handler
    this.setupResizeHandler();
  }

  setupIntersectionObserver() {
    // Pause calculations when component is out of viewport
    // This prevents unnecessary work when scrolling other sections
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.isInViewport = entry.isIntersecting;
        });
      },
      { rootMargin: "50% 0px", threshold: 0 }
    );
    this.intersectionObserver.observe(this);
  }

  updateAnimation() {
    if (!this.cardData) return;

    const { cards, cardCount, headerHeight, scaleRatios, cardTopsAbsolute, lastCardTopAbsolute } = this.cardData;
    const scrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;

    // Use cached viewport height (updated on resize) — avoids reading window.visualViewport
    // in scroll handler which triggers layout on Safari mobile when URL bar animates
    const viewportHeight = this.cachedViewportHeight || window.innerHeight;

    // ALL calculations use cached positions + scrollTop — ZERO getBoundingClientRect() calls
    // Positions are cached in initAnimation() and updated on resize

    // Early exit: completely outside animation range
    const firstCardAnimationStart = lastCardTopAbsolute - headerHeight - viewportHeight * 3;
    const lastCardAnimationEnd = lastCardTopAbsolute + viewportHeight * 2;
    if (scrollTop < firstCardAnimationStart || scrollTop > lastCardAnimationEnd) {
      for (let index = 0; index < cardCount - 1; index++) {
        const card = cards[index];
        const prev = this.previousTransforms.get(card);
        if (prev !== "scale3d(1, 1, 1)") {
          card.style.transform = "scale3d(1, 1, 1)";
          this.previousTransforms.set(card, "scale3d(1, 1, 1)");
        }
        if (card.style.getPropertyValue("--offset-top")) {
          card.style.removeProperty("--offset-top");
        }
      }
      return;
    }

    // Sticky range calculated from cached absolute position
    const stickyStartPoint = lastCardTopAbsolute - headerHeight;
    const stickyEndPoint = lastCardTopAbsolute;
    const isInStickyRange = scrollTop >= stickyStartPoint && scrollTop <= stickyEndPoint;

    // Scale animations — uses cached absolute positions (no DOM reads)
    for (let index = 0; index < cardCount - 1; index++) {
      const card = cards[index];
      const scaleRatio = scaleRatios[index];

      const nextCardTop = cardTopsAbsolute[index + 1];
      const endPoint = lastCardTopAbsolute - headerHeight;
      const startPoint = nextCardTop - viewportHeight;
      const scrollRange = endPoint - startPoint;

      let newTransform;
      if (scrollRange <= 0) {
        newTransform = "scale3d(1, 1, 1)";
      } else {
        const progress = Math.max(0, Math.min(1, (scrollTop - startPoint) / scrollRange));
        const scale = 1 + (scaleRatio - 1) * progress;
        newTransform = `scale3d(${scale}, ${scale}, 1)`;
      }

      const prev = this.previousTransforms.get(card);
      if (prev !== newTransform) {
        card.style.transform = newTransform;
        this.previousTransforms.set(card, newTransform);
      }
    }

    // Sticky offset — calculated from cached position, no DOM read needed
    // lastCard viewport-relative top = lastCardTopAbsolute - scrollTop
    // When card is sticky, browser clamps it at its CSS sticky top value,
    // but Math.max(..., 0) gives a good approximation for the layered offset effect
    if (isInStickyRange) {
      const currentLastCardTop = Math.max(lastCardTopAbsolute - scrollTop, 0);
      for (let index = 0; index < cardCount - 1; index++) {
        const card = cards[index];
        const newValue = `${currentLastCardTop - (cardCount - index - 1) * this.stickySpacing}px`;
        const currentValue = card.style.getPropertyValue("--offset-top");
        if (currentValue !== newValue) {
          card.style.setProperty("--offset-top", newValue);
        }
      }
    } else {
      for (let index = 0; index < cardCount - 1; index++) {
        const card = cards[index];
        if (card.style.getPropertyValue("--offset-top")) {
          card.style.removeProperty("--offset-top");
        }
      }
    }
  }

  setupResizeHandler() {
    this.resizeHandler = () => {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }

      this.resizeTimeout = setTimeout(() => {
        // Update cached viewport height
        this.cachedViewportHeight = window.visualViewport
          ? window.visualViewport.height
          : document.documentElement.clientHeight || window.innerHeight;

        requestAnimationFrame(() => {
          if (!this.cardData) return;

          const { cards, cardCount } = this.cardData;
          const cardWidths = [];
          const scaleRatios = [];

          for (let index = 0; index < cardCount; index++) {
            cardWidths[index] = cards[index].offsetWidth;

            if (index < cardCount - 1) {
              const cardWidth = cardWidths[index];
              const newWidth = cardWidth - (cardCount - index - 1) * this.widthReduced;
              scaleRatios[index] = newWidth / cardWidth;
            }
          }

          this.cardData.cardWidths = cardWidths;
          this.cardData.scaleRatios = scaleRatios;

          // Recalculate headerHeight
          this.cardData.headerHeight =
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) +
            20 +
            (cardCount - 1) * this.stickySpacing;

          // Recalculate ALL card absolute positions (only on resize, not every frame)
          const currentScrollTop = this.lenis
            ? this.lenis.scroll
            : window.pageYOffset || document.documentElement.scrollTop;

          const cardTopsAbsolute = [];
          for (let index = 0; index < cardCount; index++) {
            cardTopsAbsolute[index] = cards[index].getBoundingClientRect().top + currentScrollTop;
          }
          this.cardData.cardTopsAbsolute = cardTopsAbsolute;
          this.cardData.lastCardTopAbsolute = cardTopsAbsolute[cardCount - 1];

          this.updateAnimation();
        });
      }, 150);
    };

    window.addEventListener("resize", this.resizeHandler, { passive: true });
  }

  cleanup() {
    // Clean up scroll listener
    if (this.scrollHandler) {
      if (this.lenis) {
        this.lenis.off("scroll", this.scrollHandler);
      } else {
        window.removeEventListener("scroll", this.scrollHandler);
      }
      this.scrollHandler = null;
    }

    // Clean up IntersectionObserver
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // Cancel pending RAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Cancel pending resize timeout
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    // Reset card data and cache
    this.cardData = null;
    this.previousTransforms.clear();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.cleanup();
  }
}

if (!customElements.get("scrolling-card-layered")) {
  customElements.define("scrolling-card-layered", ScrollingCardLayered);
}

class ImageComparison extends Component {
  constructor() {
    super();

    this.startDragHandler = this.#onStartDrag.bind(this);
    this.dragHandler = this.#onDrag.bind(this);
    this.stopDragHandler = this.#onStopDrag.bind(this);
  }

  get isHorizontal() {
    return this.dataset.direction === "horizontal";
  }

  connectedCallback() {
    super.connectedCallback();

    this.#init();

    if (!prefersReducedMotion()) {
      this.#bindInView();
    }
  }

  #bindInView() {
    const { trigger } = this.refs;

    inView(
      trigger,
      () => {
        this.#enter();
      },
      { rootMargin: "0px 0px -50px 0px" }
    );
  }

  #enter() {
    this.setAttribute("is-visible", "");
    this.classList.add("is-animating");
    setTimeout(() => {
      this.classList.remove("is-animating");
    }, 1e3);
  }

  #init() {
    const { rangeButton, rangeButtonIcon } = this.refs;

    // Set default value to prevent undefined during early drag
    this.offset = 31;

    // Defer layout measurement to avoid forced reflow
    requestAnimationFrame(() => {
      this.offset = rangeButtonIcon ? rangeButtonIcon.offsetWidth / 2 : this.offset;
    });

    rangeButton.addEventListener("touchstart", this.startDragHandler);
    rangeButton.addEventListener("mousedown", this.startDragHandler);
  }

  #onStartDrag(event) {
    event.preventDefault();
    document.documentElement.classList.add("scroll-locked");

    this.classList.add("is-dragging");

    if (event.type === "mousedown") {
      document.addEventListener("mousemove", this.dragHandler);
      document.addEventListener("mouseup", this.stopDragHandler);
    } else if (event.type === "touchstart") {
      document.addEventListener("touchmove", this.dragHandler, { passive: false });
      document.addEventListener("touchend", this.stopDragHandler);
    }
  }

  #onStopDrag() {
    this.classList.remove("is-dragging");

    document.removeEventListener("mousemove", this.dragHandler);
    document.removeEventListener("mouseup", this.stopDragHandler);

    document.removeEventListener("touchmove", this.dragHandler);
    document.removeEventListener("touchend", this.stopDragHandler);

    const lenis = getLenis();
    if (lenis) {
      lenis.start();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.documentElement.classList.remove("scroll-locked");
        });
      });
    } else {
      document.documentElement.classList.remove("scroll-locked");
    }
  }

  #onDrag(e) {
    e.preventDefault();
    const event = (e.touches && e.touches[0]) || e;
    const rect = this.getBoundingClientRect();
    let x, distance;

    if (this.isHorizontal) {
      x = event.clientX - rect.left;
      distance = this.clientWidth;

      if (isRTL()) {
        x = distance - x; // Reverse the x position for RTL
      }
    } else {
      x = event.clientY - rect.top;
      distance = this.clientHeight;
    }

    const max = distance - this.offset;
    const min = this.offset;
    const mouseX = Math.max(min, Math.min(x, max));
    const mousePercent = (mouseX * 100) / distance;
    this.style.setProperty("--percent", mousePercent + "%");
  }
}

if (!customElements.get("image-comparison")) {
  customElements.define("image-comparison", ImageComparison);
}

class ComparisonGallery extends Component {
  #preventClick = false;
  #activeIndex = -1;
  #abortController = new AbortController();
  #resizeObserver = null;
  #rafId = null;

  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  connectedCallback() {
    super.connectedCallback();

    const { thumbnails } = this.refs;

    if (thumbnails) {
      this.#setupListeners();
      this.#observeActiveContent();

      requestAnimationFrame(() => {
        this.setActiveTab(0);
      });
    }

    this.#registerDesignModeEvents();
  }

  updatedCallback() {
    super.updatedCallback?.();

    const { thumbnails } = this.refs;
    if (!thumbnails) return;

    this.#abortController.abort();
    this.#abortController = new AbortController();
    this.#setupListeners();
    this.#observeActiveContent();

    requestAnimationFrame(() => {
      this.setActiveTab(0);
    });
  }

  disconnectedCallback() {
    this.#cancelScheduledUpdate();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#abortController.abort();
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();
  }

  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error("Section id missing");

    return sectionId;
  }

  #setupListeners() {
    const { thumbnails } = this.refs;
    const { signal } = this.#abortController;

    if ("ontouchstart" in window) {
      thumbnails.forEach((item) => {
        item.addEventListener("touchstart", (e) => this.onTouchChange(e), { signal, passive: true });
        item.addEventListener("click", (e) => this.onClick(e), { signal });
      });
    } else {
      thumbnails.forEach((item) => {
        item.addEventListener("click", (e) => this.onThumbnailClick(e), { signal });
      });
    }

    const mqlMobile = window.matchMedia(mediaBreakpointMobile);
    mqlMobile.addEventListener("change", () => this.updateHeight(), { signal });
  }

  #observeActiveContent() {
    this.#resizeObserver?.disconnect();

    const { images, infos } = this.refs;
    const currentImage = images[this.#activeIndex];
    const currentInfo = infos[this.#activeIndex];

    if (!currentImage && !currentInfo) return;

    this.#resizeObserver = new ResizeObserver(() => {
      this.updateHeight();
    });

    if (currentImage) this.#resizeObserver.observe(currentImage);
    if (currentInfo) this.#resizeObserver.observe(currentInfo);
  }

  #cancelScheduledUpdate() {
    if (this.#rafId != null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }

  #registerDesignModeEvents() {
    if (!(window.Shopify && Shopify.designMode)) return;

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (event) => {
        if (event.detail.sectionId !== this.sectionId) return;

        const { target } = event;
        const el = target.closest(".comparison-gallery-item__part");
        if (!el) return;

        const index = Number(el.dataset.index);
        if (Number.isNaN(index)) return;

        this.setActiveTab(index);
      },
      { signal }
    );
  }

  isActive(tab) {
    return tab.getAttribute("aria-current") === "true";
  }

  updateHeight() {
    this.#cancelScheduledUpdate();

    const { imagesWrap, images, infosWrap, infos } = this.refs;

    const currentImage = images[this.#activeIndex];
    const currentInfo = infos[this.#activeIndex];

    if (!currentImage && !currentInfo) return;

    // Defer read so layout is settled (breakpoint change, design mode sidebar resize)
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = null;

      if (!this.isConnected) return;

      const imageH = currentImage?.offsetHeight;
      const infoH = currentInfo?.offsetHeight;

      if (imageH != null) imagesWrap.style.setProperty("height", imageH + "px");
      if (infoH != null) infosWrap.style.setProperty("height", infoH + "px");
    });
  }

  setActiveTab(newIndex) {
    this.#activeIndex = newIndex;
    const { images, thumbnails, infos } = this.refs;

    const newThumbnail = thumbnails[newIndex];
    const newImage = images[newIndex];
    const newInfo = infos[newIndex];

    thumbnails.forEach((el) => el.setAttribute("aria-current", el === newThumbnail));
    images.forEach((el) => el.setAttribute("aria-current", el === newImage));
    infos.forEach((el) => el.setAttribute("aria-current", el === newInfo));

    this.#observeActiveContent();
    this.updateHeight();
  }

  getThumbnailEl(event) {
    const { target } = event;

    return target.closest(".comparison-gallery-item__thumbnail");
  }

  onThumbnailClick(event) {
    const thumbnailEl = this.getThumbnailEl(event);
    if (!thumbnailEl) return;

    const index = Number(thumbnailEl.dataset.index);
    if (this.isActive(thumbnailEl)) return;

    this.setActiveTab(index);
  }

  onTouchChange(event) {
    const thumbnailEl = this.getThumbnailEl(event);
    if (!thumbnailEl) return;

    const index = Number(thumbnailEl.dataset.index);

    if (this.isActive(thumbnailEl)) {
      this.#preventClick = false;
      return;
    } else {
      this.#preventClick = true;
    }

    this.setActiveTab(index);
  }

  onClick(event) {
    if (this.#preventClick) {
      event.preventDefault();
    }
  }
}

if (!customElements.get("comparison-gallery")) {
  customElements.define("comparison-gallery", ComparisonGallery);
}

class BaseMultiProductAddToCart extends Component {
  /** @type {number | undefined} */
  #timeout;

  constructor() {
    super();
  }

  /**
   * Abstract method to get the items to add to the cart.
   * return an array of objects with id and quantity properties.
   * @returns {Array<{id: string, quantity: number}>}
   * @example
   * return [
   *   { id: "123", quantity: 1 },
   *   { id: "456", quantity: 2 },
   * ];
   */
  getItems() {
    throw new Error("Subclass must implement getItems method");
  }

  getQuantiy() {
    const items = this.getItems();
    return items.reduce((acc, item) => acc + item.quantity, 0);
  }

  /**
   * Abstract method to get the submit element.
   * @returns {HTMLButtonElement}
   */
  getSubmitElement() {
    throw new Error("Subclass must implement getSubmitElement method");
  }

  /**
   * Abstract method to get the message element.
   * @returns {HTMLDivElement}
   */
  getMessageElement() {
    throw new Error("Subclass must implement getMessageElement method");
  }

  onAddToCartClick(event) {
    event?.preventDefault();

    const items = this.getItems();
    if (!items.length) return;

    const submitElement = this.getSubmitElement();
    if (submitElement.getAttribute("aria-disabled") === "true") return;
    submitElement.setAttribute("aria-disabled", "true");
    this.#showErrorMessage();
    this.#toggleButtonLoading(true);

    const shouldRedirectToCartAfterAdd = FoxTheme.template.name == "cart" || FoxTheme.settings.cartType != "drawer";

    let sectionsToUpdate = [];
    document.dispatchEvent(new CartGroupedSections(sectionsToUpdate));

    const body = JSON.stringify({
      items,
      sections: Array.from(sectionsToUpdate).join(","),
      sections_url: window.location.pathname,
    });

    const fetchCfg = fetchConfig("json", { body });

    fetch(`${FoxTheme.routes.cart_add_url}`, fetchCfg)
      .then((response) => response.json())
      .then(async (response) => {
        if (response.status) {
          this.dispatchEvent(
            new CartErrorEvent(this.id || "", response.message, response.description, response.errors)
          );

          document.dispatchEvent(
            new CustomEvent(ThemeEvents.productAjaxError, {
              detail: { errorMessage: response.description || response.message },
            })
          );

          this.#showErrorMessage(response.description);

          // Fetch cart.js AND section HTML in parallel for instant morph (same ids as add-to-cart `sections` payload)
          const sectionIds = [...new Set(sectionsToUpdate)];
          const sectionsData = {};
          const sectionPromises = sectionIds.map(async (sectionId) => {
            const sectionUrl = `${window.location.pathname.split("?")[0]}?section_id=${sectionId}`;
            const res = await fetch(sectionUrl);
            sectionsData[sectionId] = await res.text();
          });

          const cartPromise = fetch(FoxTheme.routes.cart).then((res) => res.json());

          Promise.all([cartPromise, ...sectionPromises])
            .then(([cart]) => {
              this.dispatchEvent(
                new CartUpdateEvent(cart, this.id, {
                  itemCount: cart.item_count || 0,
                  sections: Object.keys(sectionsData).length > 0 ? sectionsData : undefined,
                })
              );
            })
            .catch((error) => {
              console.error("Failed to fetch cart count:", error);
            });
          return;
        } else {
          if (shouldRedirectToCartAfterAdd) {
            window.location = FoxTheme.routes.cart_url;
            return;
          }

          this.dispatchEvent(
            new CartAddEvent(response, this.id, {
              itemCount: this.getQuantiy(),
              sections: response.sections,
            })
          );

          document.dispatchEvent(
            new CustomEvent(ThemeEvents.productAjaxAdded, {
              detail: { product: response },
            })
          );
        }
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        submitElement.removeAttribute("aria-disabled");
        this.#toggleButtonLoading(false);
      });
  }

  #showErrorMessage(message = false) {
    // Clear existing timeout to reset the 5s timer
    if (this.#timeout) {
      clearTimeout(this.#timeout);
    }

    const messageElement = this.getMessageElement();

    if (messageElement) {
      messageElement.classList.toggle("hidden", !message);

      if (message) {
        messageElement.textContent = message;

        // Hide error message after 5 seconds
        this.#timeout = setTimeout(() => {
          messageElement.classList.add("hidden");
        }, 5000);
      }
    } else {
      message && alert(message);
    }
  }

  #toggleButtonLoading(isLoading) {
    const submitElement = this.getSubmitElement();
    submitElement && submitElement.classList.toggle("btn--loading", isLoading);
  }
}

class ProductsBundle extends BaseMultiProductAddToCart {
  #abortController = new AbortController();

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    const { hotspots } = this.refs;
    this.onHoverHandler = this.#handleHover.bind(this);

    if (hotspots) {
      hotspots.forEach((hotspot) => {
        ["mouseover", "mouseleave", "focus", "focusout"].forEach((eventName) => {
          hotspot.addEventListener(eventName, this.onHoverHandler, { signal });
        });
      });
    }

    this.#setButtonDisable();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  getItems() {
    const productForms = this.querySelectorAll(".product-card__form");

    return Array.from(productForms, (form) => ({
      id: form.querySelector("[name=id]")?.value,
      quantity: Number(form.querySelector("[name=quantity]")?.value) || 1,
    })).filter((item) => item.id);
  }

  getSubmitElement() {
    return this.refs.addAllToCart;
  }

  getMessageElement() {
    return this.refs.addToCartTextError;
  }

  #handleHover(event) {
    const { type, target } = event;
    const { productList } = this.refs;
    const { products } = productList.refs;
    const hotspot = target.closest('[ref="hotspots[]"]');
    const hotspotIndex = Number(hotspot.dataset.index);
    const isEnter = "mouseover" === type || "focus" === type;

    hotspot.classList.toggle("is-selected", isEnter);
    if (!isMobileBreakpoint()) {
      this.classList.toggle("is-hover", isEnter);
    }

    let activeProduct = null;
    products.forEach((product) => {
      const productIndex = Number(product.dataset.index);
      product.classList.toggle("is-selected", hotspotIndex === productIndex);
      if (hotspotIndex === productIndex) {
        activeProduct = product;
      }
    });

    if (isEnter) {
      if (isMobileBreakpoint()) {
        activeProduct && this.#scrollToTop(activeProduct);
      } else {
        if (
          typeof productList?.swiperInstance === "object" &&
          !productList?.swiperInstance?.visibleSlidesIndexes?.includes(hotspotIndex)
        ) {
          productList.goToSlide(hotspotIndex);
        }
      }
    }
  }

  #scrollToTop(target, offset = 80) {
    const scrollIntoView = (selector, offset) => {
      window.scrollTo({
        behavior: "smooth",
        top: selector.getBoundingClientRect().top - document.body.getBoundingClientRect().top - offset,
      });
    };

    scrollIntoView(target, offset);
  }

  #setButtonDisable() {
    const products = this.querySelectorAll("product-bundle-variant-selector");
    const { addAllToCart } = this.refs;

    if (products.length < 1) {
      addAllToCart.disabled = true;
    }
  }
}

if (!customElements.get("products-bundle")) {
  customElements.define("products-bundle", ProductsBundle);
}

class ProductsBoughtTogether extends BaseMultiProductAddToCart {
  #abortController = new AbortController();

  constructor() {
    super();

    this.variants = [];
  }

  connectedCallback() {
    super.connectedCallback();

    if (!this.checkboxes.length) {
      return;
    }

    const { signal } = this.#abortController;
    this.onVariantChangeHandler = this.#onVariantChange.bind(this);
    this.onCheckboxChangeHandler = this.#onCheckboxChange.bind(this);
    this.onQuantityChangeHandler = this.#onQuantityChange.bind(this);

    this.addEventListener("variant-change", this.onVariantChangeHandler, { signal });

    this.checkboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", this.onCheckboxChangeHandler, { signal });
    });

    this.quantityInputs.forEach((quantityInput) => {
      quantityInput.addEventListener("change", this.onQuantityChangeHandler, { signal });
    });

    this.productCards.forEach((card) => {
      this.#updateProductCardLinePrice(card);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  get checkboxSelector() {
    return ".product-bought-together__checkbox";
  }

  get productCardSelector() {
    return ".product-card";
  }

  get productCards() {
    return (this._productCards = this._productCards || this.querySelectorAll(this.productCardSelector));
  }

  get checkboxes() {
    return (this._checkboxes = this._checkboxes || this.querySelectorAll(this.checkboxSelector));
  }

  get quantityInputs() {
    return (this._quantityInputs = this._quantityInputs || this.querySelectorAll("product-card [name='quantity']"));
  }

  get checkedCheckboxes() {
    return Array.from(this.checkboxes).filter((checkbox) => checkbox.checked);
  }

  getItems() {
    return this.variants.map((variant) => ({
      id: variant.id,
      quantity: variant.quantity,
    }));
  }

  getSubmitElement() {
    return this.refs.addAllToCart;
  }

  getMessageElement() {
    return this.refs.addToCartTextError;
  }

  #onCheckboxChange(event) {
    const { target: checkbox } = event;
    const isSelected = checkbox.checked;
    const productCard = checkbox.closest(this.productCardSelector);
    const productId = productCard.dataset.productId;
    productCard.classList.toggle("is-selected", isSelected);

    if (isSelected) {
      this.#addVariantFromProductCard(productCard);
    } else {
      this.removeVariant(productId);
    }
  }

  #onQuantityChange(event) {
    const { target: quantityInput } = event;
    const productCard = quantityInput.closest(this.productCardSelector);
    const checkboxEl = productCard.querySelector(this.checkboxSelector);

    if (checkboxEl?.checked) {
      this.#addVariantFromProductCard(productCard);
    } else {
      this.#updateProductCardLinePrice(productCard);
    }
  }

  #onVariantChange(event) {
    const { target } = event;
    const productCard = target.closest(this.productCardSelector);
    const checkboxEl = productCard.querySelector(this.checkboxSelector);
    const isSelected = checkboxEl.checked;

    if (!isSelected) {
      return;
    }

    this.#addVariantFromProductCard(productCard);
  }

  #addVariantFromProductCard(productCard) {
    const productId = productCard.dataset.productId;
    const variantSelect = productCard.querySelector('[name="id"]');
    const selectedOption = variantSelect.selectedOptions[0];
    const variantId = selectedOption.value;
    const baseUnitPrice = parseFloat(selectedOption.dataset.price);
    const quantityInput = productCard.querySelector('[name="quantity"]');
    const quantity = quantityInput && quantityInput.value != "" ? parseInt(quantityInput.value) : 1;
    const quantityOption = quantityInput?.selectedOptions?.[0];
    const priceContainer = productCard.querySelector('[ref="priceContainer"]');
    const usesQuantityLinePricing = priceContainer?.dataset?.quantityBreaks === "true";
    const rawLineTotal = quantityOption?.dataset?.linePrice;
    const parsedLineTotal = rawLineTotal != null && rawLineTotal !== "" ? parseFloat(rawLineTotal) : NaN;
    const lineTotalCents =
      usesQuantityLinePricing && Number.isFinite(parsedLineTotal)
        ? Math.round(parsedLineTotal)
        : Math.round(baseUnitPrice * quantity);
    const effectiveUnitPrice = quantity > 0 ? lineTotalCents / quantity : baseUnitPrice;

    this.addVariant({
      productId: productId,
      id: variantId,
      price: effectiveUnitPrice,
      quantity: quantity,
      lineTotalCents: lineTotalCents,
    });

    this.#updateProductCardLinePrice(productCard);
  }

  /** Updates card product-price to line total (uses quantity option data-line-price when set — includes volume tiers). */
  #updateProductCardLinePrice(productCard) {
    const card =
      productCard instanceof HTMLElement && productCard.tagName.toLowerCase() === "product-card"
        ? /** @type {import("../modules/product-card").ProductCard} */ (productCard)
        : null;

    const priceContainer = card.querySelector(`[ref="priceContainer"]`);
    if (!priceContainer) return;

    const variantSelect = productCard.querySelector('[name="id"]');
    const selectedOption = variantSelect?.selectedOptions?.[0];
    if (!selectedOption) return;

    const quantityInput = productCard.querySelector('[name="quantity"]');
    const quantityOption = quantityInput?.selectedOptions?.[0];
    const quantity = quantityInput && quantityInput.value !== "" ? parseInt(quantityInput.value) : 1;

    const rawLine = quantityOption?.dataset?.linePrice;
    const parsedLine = rawLine != null && rawLine !== "" ? parseFloat(rawLine) : NaN;
    const usesQuantityLinePricing = priceContainer.dataset.quantityBreaks === "true";
    const hasQuantityLineData = usesQuantityLinePricing && Number.isFinite(parsedLine) && parsedLine >= 0;

    if (!hasQuantityLineData) {
      if (priceContainer.classList.contains("volume-pricing--sale-badge")) return;

      const regularPriceElCheck = priceContainer.querySelector(".price__regular .price");
      if (
        regularPriceElCheck &&
        (regularPriceElCheck.textContent.includes("–") || regularPriceElCheck.textContent.includes("from"))
      ) {
        return;
      }
    }

    const unitPrice = parseFloat(selectedOption.dataset.price) || 0;
    const unitCompare = parseFloat(selectedOption.dataset.compareAtPrice) || 0;
    const moneyFormat = window.FoxTheme?.moneyFormat || "${{amount}}";

    let linePriceCents = hasQuantityLineData ? Math.round(parsedLine) : Math.round(unitPrice * quantity);
    let lineCompareCents = 0;

    if (hasQuantityLineData) {
      const rawCompareLine = quantityOption?.dataset?.compareLinePrice;
      if (rawCompareLine != null && rawCompareLine !== "") {
        lineCompareCents = Math.round(parseFloat(rawCompareLine)) || 0;
      }
    } else if (unitCompare > unitPrice) {
      lineCompareCents = Math.round(unitCompare * quantity);
    }

    const formattedPrice = formatCurrency(linePriceCents, moneyFormat);
    const formattedCompare = lineCompareCents > linePriceCents ? formatCurrency(lineCompareCents, moneyFormat) : null;

    const isOnSale = Boolean(formattedCompare);

    priceContainer.classList.toggle("price--on-sale", isOnSale);

    const salePriceDiv = priceContainer.querySelector(".price__sale");
    if (salePriceDiv) {
      const salePriceEl = salePriceDiv.querySelector(".price");
      const comparePriceEl = salePriceDiv.querySelector(".compare-at-price");

      if (salePriceEl) salePriceEl.textContent = formattedPrice;
      if (comparePriceEl && formattedCompare) {
        comparePriceEl.textContent = formattedCompare;
      }
    }

    const regularPriceDiv = priceContainer.querySelector(".price__regular");
    if (regularPriceDiv) {
      const regularPriceEl = regularPriceDiv.querySelector(".price");
      if (regularPriceEl) {
        const isRangeText = regularPriceEl.textContent.includes("–") || regularPriceEl.textContent.includes("from");
        if (hasQuantityLineData || !isRangeText) {
          regularPriceEl.textContent = formattedPrice;
        }
      }
    }
  }

  addVariant(variant) {
    if (this.variants.some((v) => v.productId === variant.productId)) {
      this.variants = this.variants.map((v) => (v.productId === variant.productId ? variant : v));
    } else {
      this.variants.push(variant);
    }

    this.#updateSummary();
  }

  removeVariant(productId) {
    this.variants = this.variants.filter((v) => v.productId !== productId);

    this.#updateSummary();
  }

  updateVariant(productId, variant) {
    this.variants = this.variants.map((v) => (v.productId === productId ? { ...v, ...variant } : v));

    this.#updateSummary();
  }

  #updateSummary() {
    this.#updateButtonState();
    this.#updateCount();
    this.#updateSubTotal();
  }

  #updateButtonState() {
    const { addAllToCart } = this.refs;
    const hasVariants = this.variants.length > 0;
    if (hasVariants) {
      addAllToCart.removeAttribute("disabled");
    } else {
      addAllToCart.setAttribute("disabled", "");
    }
  }

  #updateCount() {
    const { itemCount } = this.refs;
    const { itemCountOne, itemCountOther } = itemCount.dataset;

    const checkedCount = this.variants.reduce((total, variant) => total + variant.quantity, 0);

    itemCount.textContent =
      checkedCount === 1
        ? itemCountOne.replace("{{ count }}", checkedCount)
        : itemCountOther.replace("{{ count }}", checkedCount);
  }

  #updateSubTotal() {
    const { subTotal } = this.refs;
    const totalPrice = this.variants.reduce((total, variant) => {
      if (typeof variant.lineTotalCents === "number") {
        return total + variant.lineTotalCents;
      }
      return total + variant.price * variant.quantity;
    }, 0);

    subTotal.textContent = formatCurrency(totalPrice);
  }
}
if (!customElements.get("products-bought-together")) {
  customElements.define("products-bought-together", ProductsBoughtTogether);
}

class ProductBundleVariantSelector extends Component {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    const { variantSelect } = this.refs;

    this.currentOptionIds = variantSelect ? variantSelect.options[variantSelect.selectedIndex].dataset.optionsId : null;
    this.currentVariantId = variantSelect ? variantSelect.value : null;
  }

  get productId() {
    return this.dataset.productId;
  }

  get productUrl() {
    return this.dataset.productUrl;
  }

  get sectionId() {
    return this.dataset.sectionId;
  }

  /**
   * @param {Element} element
   * @returns {element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement}
   */
  #isFormInputElement(element) {
    return (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    );
  }

  /**
   * @param {Element} destination
   */
  #clearVariantSyncElement(destination) {
    if (this.#isFormInputElement(destination)) {
      if (destination instanceof HTMLSelectElement) {
        destination.innerHTML = "";
        destination.value = "";
        destination.selectedIndex = -1;
      } else if (destination instanceof HTMLInputElement) {
        if (destination.type === "checkbox" || destination.type === "radio") {
          destination.checked = false;
        } else {
          destination.value = "";
        }
      } else {
        destination.value = "";
      }
      return;
    }

    destination.innerHTML = "";
  }

  /**
   * @param {Element} source
   * @param {Element} destination
   */
  #syncVariantSyncElement(source, destination) {
    if (this.#isFormInputElement(destination)) {
      if (destination instanceof HTMLSelectElement && source instanceof HTMLSelectElement) {
        const preservedValue = destination.value;
        destination.innerHTML = source.innerHTML;
        if ([...destination.options].some((option) => option.value === preservedValue)) {
          destination.value = preservedValue;
        }
        return;
      }

      const preservedValue = destination.value;
      const preservedChecked =
        destination instanceof HTMLInputElement && (destination.type === "checkbox" || destination.type === "radio")
          ? destination.checked
          : null;

      const replacement = source.cloneNode(true);
      if (replacement instanceof HTMLInputElement || replacement instanceof HTMLTextAreaElement) {
        if (preservedChecked != null) {
          replacement.checked = preservedChecked;
        } else if (preservedValue) {
          replacement.value = preservedValue;
        }
      }
      destination.replaceWith(replacement);
      return;
    }

    destination.replaceWith(source);
  }

  /**
   * @param {Element | null} sourceRoot
   * @param {Element | null} destRoot
   */
  #syncProductCardFromFetchedHtml(sourceRoot, destRoot) {
    if (!sourceRoot || !destRoot) return;

    destRoot.querySelectorAll("[data-variant-sync]").forEach((destination) => {
      const syncKey = destination.dataset.variantSync;
      if (!syncKey) return;

      const source = sourceRoot.querySelector(`[data-variant-sync="${CSS.escape(syncKey)}"]`);

      if (!source) {
        this.#clearVariantSyncElement(destination);
        return;
      }

      this.#syncVariantSyncElement(source, destination);
    });
  }

  /**
   * @param {HTMLSelectElement} variantSelect
   */
  updateVariantFromSelect(variantSelect) {
    this.currentOptionIds = variantSelect.options[variantSelect.selectedIndex].dataset.optionsId;
    this.currentVariantId = variantSelect.value;
  }

  getVariantChangeFetchUrl() {
    return `${this.productUrl.split("?")[0]}?section_id=${this.sectionId}&option_values=${this.currentOptionIds}`;
  }

  getProductCardFromSource(html) {
    return html.querySelector(`.product-card__wrapper[data-product-id="${this.productId}"]`);
  }

  fetchAndSyncProductCard() {
    return fetch(this.getVariantChangeFetchUrl())
      .then((response) => response.text())
      .then((responseText) => {
        const html = new DOMParser().parseFromString(responseText, "text/html");
        const pcardSource = this.getProductCardFromSource(html);
        const pcardDestination = this.closest(`.product-card__wrapper[data-product-id="${this.productId}"]`);

        this.#syncProductCardFromFetchedHtml(pcardSource, pcardDestination);
      })
      .catch((error) => {
        console.error(error);
      });
  }

  onVariantChange(event) {
    this.updateVariantFromSelect(event.target);
    this.fetchAndSyncProductCard().then(() => {
      this.dispatchEvent(new CustomEvent("variant-change", { bubbles: true }));
    });
  }
}

if (!customElements.get("product-bundle-variant-selector")) {
  customElements.define("product-bundle-variant-selector", ProductBundleVariantSelector);
}

class ProductsBundleSelection extends BaseMultiProductAddToCart {
  constructor() {
    super();

    this.variants = [];
    this.preventDuplicateItems = this.dataset.preventDuplicateItems === "true";
    this.minItems = parseInt(this.dataset.minItems);
    this.maxItems = parseInt(this.dataset.maxItems);

    this.rawItems = this.querySelectorAll(".products-bundle-selection__bar-item");
  }

  connectedCallback() {
    super.connectedCallback();

    const { bundleBar } = this.refs;
    const { bundleBarList, bundleBarSubmit } = bundleBar.refs;

    this.updateBundleBarInfo();

    bundleBarList.addEventListener("click", this.onBundleBarItemRemoveClick.bind(this));
    bundleBarSubmit.addEventListener("click", this.onSubmitClick.bind(this));

    const mqlMobile = window.matchMedia(mediaBreakpointMobile);
    const updateOpen = (isMobile) => {
      const shouldOpen = !isMobile;

      const accordionEl = this.refs.bundleBar;
      if (!accordionEl || !accordionEl.refs) {
        return;
      }

      const details = accordionEl.querySelector("details");

      if (details.open === shouldOpen) return;

      const { item: items, summary: summaries, content: contents } = accordionEl.refs;

      let idx = -1;
      if (Array.isArray(items)) idx = items.indexOf(details);

      let item = Array.isArray(items) ? items[idx] : items;
      let summary = Array.isArray(summaries) ? summaries[idx] : summaries;
      let content = Array.isArray(contents) ? contents[idx] : contents;

      if (!item || !summary || !content) return;

      accordionEl.toggleOpen({
        willOpen: shouldOpen,
        item,
        summary,
        content,
      });
    };

    updateOpen(mqlMobile.matches);
    mqlMobile.onchange = (event) => updateOpen(event.matches);
  }

  getItems() {
    return this.variants.map((variant) => ({
      id: variant.id,
      quantity: variant.quantity,
    }));
  }

  getSubmitElement() {
    return this.refs.bundleBar.refs.bundleBarSubmit;
  }

  getMessageElement() {
    return this.refs.bundleBar.refs.addToCartTextError;
  }

  onBundleBarItemRemoveClick(event) {
    const removeBtn = event.target.closest(".products-bundle-selection__bar-item-remove");
    if (removeBtn) {
      event.preventDefault();

      const variantToRemove = removeBtn.closest(".products-bundle-selection__bar-item");
      const index = variantToRemove.dataset.variantIndex;
      this.removeFromBundle(index);
    }
  }

  onSubmitClick(event) {
    event?.preventDefault();

    if (this.getCount() < this.minItems) {
      return;
    }

    this.onAddToCartClick();
  }

  addToBundle(variant) {
    if (this.getCount() + variant.quantity > this.maxItems) {
      alert(this.dataset.limitMessage);
      return;
    }

    if (this.preventDuplicateItems && this.variants.some((v) => v.productId === variant.productId)) {
      alert(this.dataset.duplicateMessage);
      return;
    }

    this.variants.push(variant);

    this.updateBundleBar();
  }

  removeFromBundle(index) {
    if (index >= 0 && index < this.variants.length) {
      this.variants.splice(index, 1);
      this.updateBundleBar();
    }
  }

  clearBundle() {
    this.variants = [];

    this.updateBundleBar();
  }

  getCount() {
    return this.variants.reduce((quantity, item) => quantity + item.quantity, 0);
  }

  updateBundleBar() {
    this.updateBundleBarInfo();
    this.updateAddToBundleButtons();

    const { bundleBar } = this.refs;
    const { bundleBarList } = bundleBar.refs;

    let variantIndex = 0;
    let variant = false;
    let variantRepeatTimes = 0;
    const rawItems = Array.from(this.rawItems); // Get raw template items.
    const updatedItems = rawItems.map((item) => {
      const wrapper = item.cloneNode(true);
      wrapper.dataset.variantIndex = variantIndex;

      if (variantRepeatTimes > 0) {
        variantRepeatTimes--;
      } else {
        variant = this.variants[variantIndex];
        variantRepeatTimes = variant ? variant.quantity - 1 : 0;
      }

      if (variantRepeatTimes == 0) {
        variantIndex++;
      }

      if (variant) {
        const contentEl = wrapper.querySelector(".products-bundle-selection__bar-item-content");
        contentEl.innerHTML = "";
        wrapper.classList.remove("is-placeholder");
        wrapper.classList.add("is-product");
        wrapper.setAttribute("data-variant-id", variant.id);
        contentEl.appendChild(variant.thumbnail.cloneNode(true));
      }

      return wrapper;
    });

    bundleBarList.innerHTML = ""; // Clear current items.
    updatedItems.forEach((el) => bundleBarList.appendChild(el)); // Append new items.
  }

  updateBundleBarInfo() {
    const { bundleBar } = this.refs;
    const { bundleBarSubmit, bundleBarCount } = bundleBar.refs;
    const count = this.getCount();

    if (count >= this.minItems) {
      bundleBarSubmit.removeAttribute("disabled");
    } else {
      bundleBarSubmit.setAttribute("disabled", "true");
    }

    bundleBarCount.textContent = this.getCount();
  }

  updateAddToBundleButtons(context = this) {
    if (!this.preventDuplicateItems) {
      return;
    }

    const forms = context.querySelectorAll("product-bundle-selection");
    forms &&
      forms.forEach((form) => {
        const productId = form.dataset.productId;

        let found = false;

        for (const variant of this.variants) {
          if (variant.productId == productId) {
            found = true;
          }
        }

        const { addToBundleButton } = form.refs;
        if (found) {
          addToBundleButton.setAttribute("aria-disabled", true);
        } else {
          addToBundleButton.removeAttribute("aria-disabled");
        }
      });
  }
}

if (!customElements.get("products-bundle-selection")) {
  customElements.define("products-bundle-selection", ProductsBundleSelection);
}

class ProductBundleSelection extends ProductBundleVariantSelector {
  get bundleSelectionEl() {
    return (this._bundleSelectionEl = this._bundleSelectionEl || this.closest("products-bundle-selection"));
  }

  async handleVariantChange(event) {
    this.updateVariantFromSelect(event.target);

    const { addToBundleButton } = this.refs;
    const wasDisabled = addToBundleButton.getAttribute("aria-disabled") === "true";

    addToBundleButton.setAttribute("aria-disabled", "true");
    addToBundleButton.classList.add("btn--loading");

    try {
      await this.fetchAndSyncProductCard();
    } finally {
      if (wasDisabled) {
        addToBundleButton.setAttribute("aria-disabled", "true");
      } else {
        addToBundleButton.removeAttribute("aria-disabled");
      }
      addToBundleButton.classList.remove("btn--loading");
    }
  }

  handleAddToBundle(event) {
    event.preventDefault();

    const { addToBundleButton } = this.refs;

    if (addToBundleButton.getAttribute("aria-disabled") == "true") {
      return;
    }

    const productCard = this.closest(".product-card");
    const thumbnailEl = productCard.querySelector(".product-card__image--first img");
    const thumbnail = thumbnailEl
      ? thumbnailEl.cloneNode(true)
      : productCard.querySelector(".product-card__media .placeholder");
    const variant = this.querySelector('[name="id"]').selectedOptions[0];
    const itemPrice = parseFloat(variant.dataset.price);
    const quantityEl = this.querySelector('[name="quantity"]');
    const quantity = quantityEl && quantityEl.value != "" ? parseInt(quantityEl.value) : 1;

    this.bundleSelectionEl.addToBundle({
      productId: this.dataset.productId,
      id: variant.value,
      thumbnail: thumbnail,
      price: itemPrice,
      quantity: quantity,
    });
  }
}

if (!customElements.get("product-bundle-selection")) {
  customElements.define("product-bundle-selection", ProductBundleSelection);
}

class LookbookHotspots extends Component {
  #shopifyAbortController;
  #abortController = new AbortController();
  #activeIndex = -1;

  constructor() {
    super();

    this.classes = {
      isSelected: "is-selected",
    };

    this.clickOutsideHandler = this.#handleClickOutside.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    const { hotspots } = this.refs;

    if (!hotspots) {
      return;
    }

    if ("ontouchstart" in window) {
      hotspots.forEach((hotspot) => {
        hotspot.addEventListener("touchstart", this.#handleTouchChange.bind(this), { signal });
      });
    } else {
      hotspots.forEach((hotspot) => {
        ["mouseenter", "mouseleave", "focus", "blur"].forEach((eventName) => {
          hotspot.addEventListener(eventName, this.#handleMouseOver.bind(this), { signal });
        });
      });
    }

    this.#registerDesignModeEvents();
  }

  disconnectedCallback() {
    this.#abortController.abort();
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();
  }

  get sectionId() {
    return this.dataset.sectionId;
  }

  #registerDesignModeEvents() {
    if (!(window.Shopify && Shopify.designMode)) return;

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    ["shopify:block:select", "shopify:block:deselect"].forEach((eventName) => {
      document.addEventListener(
        eventName,
        (event) => {
          if (event.detail.sectionId != this.sectionId) return;

          const { type } = event;
          const hotspotEl = this.#getHotspotEl(event);
          const isSelected = type === "shopify:block:select";
          const index = isSelected ? Number(hotspotEl.dataset.index) : -1;

          this.#setActive(index);
        },
        { signal }
      );
    });
  }

  #handleMouseOver(event) {
    const { type } = event;
    const hotspotEl = this.#getHotspotEl(event);
    const isMouseOver = type === "mouseenter" || type === "focus";
    const index = isMouseOver ? Number(hotspotEl.dataset.index) : -1;

    this.#setActive(index);
  }

  #getHotspotEl(event) {
    return event.target.closest(".hotspot-icon");
  }

  #getProductCardEl(event) {
    return event.target.closest(".hotspot-icon__product");
  }

  #isActive(hotspotEl) {
    return hotspotEl.classList.contains(this.classes.isSelected);
  }

  #setActive(newIndex) {
    const { hotspots } = this.refs;

    hotspots.forEach((hotspot) => {
      const index = Number(hotspot.dataset.index);
      this.#toggleHotspot(hotspot, index === newIndex);
    });

    this.#activeIndex = newIndex;

    if (newIndex !== -1) {
      document.addEventListener("click", this.clickOutsideHandler);
    } else {
      document.removeEventListener("click", this.clickOutsideHandler);
    }
  }

  #handleClickOutside(event) {
    const hotspotEl = this.#getHotspotEl(event);

    if (hotspotEl) return;

    this.#setActive(-1);
  }

  #handleTouchChange(event) {
    const productCardEl = this.#getProductCardEl(event);
    if (productCardEl) return;

    const hotspotEl = this.#getHotspotEl(event);
    const index = this.#isActive(hotspotEl) ? -1 : Number(hotspotEl.dataset.index);
    this.#setActive(index);
  }

  #toggleHotspot(hotspotEl, isSelected) {
    hotspotEl.classList.toggle(this.classes.isSelected, isSelected);
    if (isSelected) {
      this.#calculateCardPosition(hotspotEl);
    }
  }

  #calculateCardPosition(hotspotEl) {
    const productCardEl = hotspotEl.querySelector(".hotspot-icon__product");

    productCardEl.style.removeProperty("--card-offset-x");
    productCardEl.style.removeProperty("--card-offset-y");
    productCardEl.style.removeProperty("transform");

    const containerRect = this.getBoundingClientRect();
    const cardRect = productCardEl.getBoundingClientRect();
    const cardMargin = 12; // Gap between hotspot and card in px.
    const margin = 8;

    const overflowStart = cardRect.left < containerRect.left + margin;
    const overflowEnd = cardRect.right > containerRect.right - margin;
    const spaceBelow = containerRect.bottom - cardRect.bottom;
    const spaceAbove = cardRect.top - containerRect.top;

    const rtl = isRTL();

    let translateX = `${cardMargin}px`;
    let translateY = "-50%";
    let offsetX;
    let offsetY;

    if (overflowStart && overflowEnd) {
      offsetX = rtl ? "auto 50%" : "50% auto";
      translateX = "-50%";
    } else if (overflowEnd) {
      offsetX = rtl ? "100% auto" : "auto 100%";
      translateX = rtl ? `${cardMargin}px` : `-${cardMargin}px`;
    } else if (overflowStart) {
      offsetX = rtl ? "auto 100%" : "100% auto";
      translateX = rtl ? `-${cardMargin}px` : `${cardMargin}px`;
    }

    if (spaceBelow < margin) {
      offsetY = "auto 0";
      translateY = `-${cardMargin}px`;
    } else if (spaceAbove < margin) {
      offsetY = "0 auto";
      translateY = `${cardMargin}px`;
    }

    offsetX && productCardEl.style.setProperty("--card-offset-x", offsetX);
    offsetY && productCardEl.style.setProperty("--card-offset-y", offsetY);
    productCardEl.style.transform = `translate(${translateX}, ${translateY})`;
  }
}
if (!customElements.get("lookbook-hotspots")) {
  customElements.define("lookbook-hotspots", LookbookHotspots);
}

class ShopTheLook extends Component {
  #abortController = new AbortController();

  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    const { slider, hotspots } = this.refs;
    const { signal } = this.#abortController;

    hotspots &&
      hotspots.forEach((hotspot) => {
        hotspot.addEventListener("mouseover", this.#handleHover.bind(this), { signal });
        hotspot.addEventListener("click", this.#handleClick.bind(this), { signal });
      });

    if (slider.swiperInstance) {
      this.#registerSliderEvents();
    } else {
      slider.addEventListener(
        "carousel:ready",
        () => {
          this.#registerSliderEvents();
        },
        { once: true }
      );
    }

    this.#registerDesignModeEvents();
  }

  #registerDesignModeEvents() {
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
        const hotspotEl = target.closest(".hotspot__element");
        const index = Number(hotspotEl.dataset.index);

        this.#setActiveItem(index);
      },
      { signal }
    );
  }

  #registerSliderEvents() {
    const { slider } = this.refs;

    if (!slider.swiperInstance) return;

    slider.swiperInstance.on("realIndexChange", (swiper) => {
      const { realIndex } = swiper;
      this.#setActiveItem(realIndex, false);
    });
  }

  disconnectedCallback() {
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  updatedCallback() {
    super.updatedCallback?.();
    const { slider } = this.refs;
    if (slider) {
      slider.addEventListener("carousel:ready", () => this.#registerSliderEvents(), { once: true });
    }
  }

  #handleHover(event) {
    const { currentTarget: target } = event;
    const index = Number(target.dataset.index);

    this.#setActiveItem(index);
  }

  #setActiveItem(index, slideToActive = true) {
    const { hotspots, slider } = this.refs;

    hotspots.forEach((hotspot) => {
      hotspot.classList.toggle("is-selected", index === Number(hotspot.dataset.index));
    });

    if (slideToActive && typeof slider.swiperInstance === "object") {
      slider.goToSlide(index);
    }
  }

  #handleClick(event) {
    if (!isMobileBreakpoint()) {
      return;
    }

    event.preventDefault();

    const { target } = event;
    const button = target.closest(".hotspot-icon");
    const dialog = document.querySelector(`dialog[id="${button.getAttribute("aria-controls")}"]`);
    const dialogComponent = dialog.closest("dialog-component");

    dialogComponent.showDialog();
  }

  get sectionId() {
    return this.dataset.sectionId;
  }
}
if (!customElements.get("shop-the-look")) {
  customElements.define("shop-the-look", ShopTheLook);
}
class LookbookCarousel extends CarouselComponent {
  #resizeObserver;
  /** @type {number | null} */
  #lastSyncedMediaIndex = null;

  constructor() {
    super();
    this.selectedIndex = this.selectedIndex;
  }

  static get observedAttributes() {
    return ["selected-index"];
  }

  get selectedIndex() {
    return parseInt(this.getAttribute("selected-index")) || 0;
  }

  set selectedIndex(index) {
    this.setAttribute("selected-index", `${index}`);
  }

  connectedCallback() {
    super.connectedCallback();

    if (this.swiperInstance) {
      this.#initAfterSwiperReady();
    } else {
      this.addEventListener(
        "carousel:ready",
        () => {
          this.#initAfterSwiperReady();
        },
        { once: true }
      );
    }
  }

  #initAfterSwiperReady() {
    this.#init();
    this.#updateControlsScheme(this.refs.slides[0]);

    // ResizeObserver callback is already batched by browser, no rAF needed
    this.#resizeObserver = new ResizeObserver(() => this.#updateControlHeight());
    this.#resizeObserver.observe(this.refs.controls);
  }

  disconnectedCallback() {
    this.#resizeObserver?.disconnect();
    this.#detachSwiperMediaListeners();

    super.disconnectedCallback();
  }

  updatedCallback() {
    this.addEventListener("carousel:ready", () => this.#initAfterSwiperReady(), { once: true });
    super.updatedCallback?.();
  }

  #detachSwiperMediaListeners() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) return;
    swiper.off("realIndexChange", this.#handleChange);
    swiper.off("slideChangeTransitionEnd", this.#handleSlideTransitionEnd);
  }

  #pauseSlideMedia(index) {
    this.querySelectorAll(`[data-swiper-slide-index="${index}"]`).forEach((slide) => {
      slide.querySelector("deferred-media")?.pauseMedia();
    });
  }

  #playActiveSlideMedia() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) return;

    const activeSlide = swiper.slides[swiper.activeIndex];
    if (!activeSlide) return;

    const deferredMedia = activeSlide.querySelector("deferred-media");
    if (deferredMedia) deferredMedia.playMedia();

    if (!document.body.hasAttribute("data-motion-disabled")) {
      activeSlide.querySelectorAll("motion-component").forEach((el) => {
        el.replay();
      });
    }
  }

  #init() {
    if (typeof this.swiperInstance !== "object") return;
    const { slides, activeIndex } = this.swiperInstance;

    const runMotionReplay = () => {
      if (slides[activeIndex]) {
        const motionEls = slides[activeIndex].querySelectorAll("motion-component[data-motion-hold]");
        motionEls?.forEach((el) => el.replay());
      }
    };

    // When page transitions enabled: start motion slightly before overlay ends for smoother handoff
    const PAGE_TRANSITION_DURATION_MS = 500;
    const MOTION_OVERLAP_MS = 200; // motion starts this many ms before page transition ends

    if (document.body.classList.contains("page-transitions-enabled")) {
      const pageTransition = document.querySelector("page-transition");
      if (pageTransition && !pageTransition.hidden) {
        const startDelay = Math.max(0, PAGE_TRANSITION_DURATION_MS - MOTION_OVERLAP_MS);
        let done = false;
        const runOnce = () => {
          if (done) return;
          done = true;
          runMotionReplay();
        };
        document.addEventListener(ThemeEvents.pageTransitionEnd, runOnce, { once: true });
        setTimeout(runOnce, startDelay);
      } else {
        runMotionReplay();
      }
    } else {
      runMotionReplay();
    }

    this.#detachSwiperMediaListeners();
    this.#lastSyncedMediaIndex = this.swiperInstance.realIndex;
    this.swiperInstance.on("realIndexChange", this.#handleChange);
    this.swiperInstance.on("slideChangeTransitionEnd", this.#handleSlideTransitionEnd);
  }

  #handleChange = (swiper) => {
    const { slides, realIndex, activeIndex } = swiper;
    const previousIndex = this.#lastSyncedMediaIndex ?? this.selectedIndex;

    if (previousIndex !== realIndex) {
      this.#pauseSlideMedia(previousIndex);
    }

    this.selectedIndex = realIndex;
    this.#lastSyncedMediaIndex = realIndex;
    this.#updateControlsScheme(slides[activeIndex]);
  };

  #handleSlideTransitionEnd = () => {
    this.#playActiveSlideMedia();
  };

  #updateControlsScheme(activeSlide) {
    const { controls } = this.refs;

    if (!controls) return;

    const colorScheme = activeSlide.dataset.colorScheme;
    const classesToRemove = Array.from(controls.classList).filter((className) => className.startsWith("color-"));
    classesToRemove.forEach((className) => controls.classList.remove(className));

    if (colorScheme) controls.classList.add(colorScheme);
  }

  #updateControlHeight() {
    // Batch read and write to avoid force reflow
    // Safe in ResizeObserver callback but also ensures proper batching
    const height = this.refs.controls.offsetHeight;
    this.style.setProperty("--control-height", `${height}px`);
  }
}

if (!customElements.get("lookbook-carousel")) {
  customElements.define("lookbook-carousel", LookbookCarousel);
}

class LookbookSlidePopover extends Component {
  requiredRefs = ["popover", "dialogComponent"];

  static get observedAttributes() {
    return ["open"];
  }

  get open() {
    return this.hasAttribute("open");
  }

  set open(value) {
    if (value) {
      this.setAttribute("open", "");
    } else {
      this.removeAttribute("open");
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.init();
    mediaQueryDesktop.addEventListener("change", this.#handleMediaChange);

    // Listen for dialog close event to re-enable carousel drag
    const { dialogComponent } = this.refs;
    if (dialogComponent) {
      dialogComponent.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    mediaQueryDesktop.removeEventListener("change", this.#handleMediaChange);

    const { dialogComponent } = this.refs;
    if (dialogComponent) {
      dialogComponent.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
    }
  }

  #handleMediaChange = () => {
    this.init();
  };

  #getCarouselComponent() {
    return this.closest("lookbook-carousel");
  }

  #toggleCarouselDrag(enabled) {
    const carousel = this.#getCarouselComponent();
    if (carousel?.swiperInstance) {
      carousel.swiperInstance.allowTouchMove = enabled;
    }
  }

  #handleDialogClose = () => {
    // Re-enable carousel drag when dialog closes
    this.#toggleCarouselDrag(true);
  };

  init() {
    if (!isDesktopBreakpoint()) {
      if (this.open) {
        this.removeAttribute("open");
      }
    } else {
      if (!this.open) {
        this.open = true;
      }
    }
  }

  togglePopover() {
    this.open = !this.open;
  }

  openPopover() {
    if (mediaQueryLarge.matches) {
      this.open = true;
    } else {
      const { dialogComponent } = this.refs;
      if (dialogComponent) {
        // Disable carousel drag when opening dialog
        this.#toggleCarouselDrag(false);
        dialogComponent.showDialog();
      }
    }
  }

  closePopover() {
    this.open = false;
  }
}
if (!customElements.get("lookbook-slide-popover")) {
  customElements.define("lookbook-slide-popover", LookbookSlidePopover);
}

class TestimonialParallax extends Component {
  #resizeHandler = null;

  constructor() {
    super();
    this.scrollHandler = null;
    this.rafId = null;
    this.lenis = null;
    this.intersectionObserver = null;
    this.isInViewport = false;
    this.viewportHeight = window.innerHeight;
  }

  connectedCallback() {
    super.connectedCallback();

    this.#update();
    mediaQueryMobile.addEventListener("change", this.#update);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    mediaQueryMobile.removeEventListener("change", this.#update);
    this.#destroy();
  }

  #update = () => {
    if (isMobileBreakpoint()) {
      this.#destroy();
    } else {
      this.#init();
    }
  };

  #init() {
    const { items } = this.refs;
    if (!items?.length) return;

    this.viewportHeight = window.innerHeight;
    this.#resizeHandler = () => {
      this.viewportHeight = window.innerHeight;
    };
    window.addEventListener("resize", this.#resizeHandler, { passive: true });

    this.#setupIntersectionObserver();
    this.#handleItemsAnimation();
  }

  #setupIntersectionObserver() {
    // Setup IntersectionObserver to only animate when in viewport
    // This significantly reduces performance impact when scrolling past the component
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        this.isInViewport = entries[0].isIntersecting;

        // Trigger initial update when entering viewport
        if (this.isInViewport) {
          requestAnimationFrame(() => {
            this.#updateItemsAnimation();
          });
        }
      },
      {
        rootMargin: "100px", // Start animating slightly before entering viewport
      }
    );

    this.intersectionObserver.observe(this);
  }

  #handleItemsAnimation() {
    const { items } = this.refs;

    if (!items?.length) return;

    // Use Lenis smooth scroll if available, otherwise fallback to native scroll
    this.lenis = getLenis();

    this.scrollHandler = () => {
      if (!this.isInViewport) return;

      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }

      this.rafId = requestAnimationFrame(() => {
        this.#updateItemsAnimation();
        this.rafId = null;
      });
    };

    if (this.lenis) {
      // Listen to Lenis scroll events (shared instance with other sections)
      this.lenis.on("scroll", this.scrollHandler);
    } else {
      // Fallback to native scroll if Lenis not available yet
      window.addEventListener("scroll", this.scrollHandler, { passive: true });

      // Retry finding Lenis every 500ms, max 10 times (5s)
      let retryCount = 0;
      this.lenisRetryTimer = setInterval(() => {
        retryCount++;
        const retryLenis = getLenis();
        if (retryLenis) {
          this.lenis = retryLenis;
          window.removeEventListener("scroll", this.scrollHandler);
          this.lenis.on("scroll", this.scrollHandler);
          clearInterval(this.lenisRetryTimer);
          this.lenisRetryTimer = null;
        } else if (retryCount >= 10) {
          clearInterval(this.lenisRetryTimer);
          this.lenisRetryTimer = null;
        }
      }, 500);
    }

    // Initial update
    requestAnimationFrame(() => {
      this.#updateItemsAnimation();
    });
  }

  #updateItemsAnimation() {
    const { items } = this.refs;

    if (!items?.length) return;

    // Skip animations if not in viewport (performance optimization)
    if (!this.isInViewport) return;

    const scrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;
    const viewportHeight = this.viewportHeight;

    // --- Batch READ: read all rects first to avoid layout thrashing ---
    const measurements = [];
    for (const item of items) {
      const { begin, end } = item.dataset;
      if (!begin || !end) {
        measurements.push(null);
        continue;
      }
      measurements.push({
        item,
        rect: item.getBoundingClientRect(),
        begin,
        end,
      });
    }

    // --- Batch WRITE: apply all transforms after reads ---
    for (const m of measurements) {
      if (!m) continue;

      const { item, rect, begin, end } = m;

      const beginValue = parseFloat(begin);
      const endValue = parseFloat(end);
      const beginUnit = begin.includes("%") ? "%" : "px";
      const endUnit = end.includes("%") ? "%" : "px";

      const itemTop = rect.top + scrollTop;
      const itemBottom = itemTop + rect.height;

      const startPoint = itemTop - viewportHeight;
      const endPoint = itemBottom;
      const scrollRange = endPoint - startPoint;

      if (scrollRange <= 0) {
        const beginPx = beginUnit === "%" ? (beginValue / 100) * rect.height : beginValue;
        const val = `translateY(${beginPx}${beginUnit === "%" ? "%" : "px"})`;
        if (item._lastTransform !== val) {
          item._lastTransform = val;
          item.style.transform = val;
        }
        continue;
      }

      const progress = Math.max(0, Math.min(1, (scrollTop - startPoint) / scrollRange));

      const beginPx = beginUnit === "%" ? (beginValue / 100) * rect.height : beginValue;
      const endPx = endUnit === "%" ? (endValue / 100) * rect.height : endValue;
      const rounded = Math.round((beginPx + (endPx - beginPx) * progress) * 10) / 10;

      if (item._lastY !== rounded) {
        item._lastY = rounded;
        item.style.transform = `translateY(${rounded}px)`;
      }
    }
  }

  #destroy() {
    if (this.lenisRetryTimer) {
      clearInterval(this.lenisRetryTimer);
      this.lenisRetryTimer = null;
    }

    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    if (this.#resizeHandler) {
      window.removeEventListener("resize", this.#resizeHandler);
      this.#resizeHandler = null;
    }

    if (this.scrollHandler) {
      if (this.lenis) {
        this.lenis.off("scroll", this.scrollHandler);
      } else {
        window.removeEventListener("scroll", this.scrollHandler);
      }
      this.scrollHandler = null;
    }

    // Cancel pending RAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Reset transforms on mobile
    if (this.refs.items) {
      this.refs.items.forEach((item) => {
        item.style.transform = "";
      });
    }
  }
}

if (!customElements.get("testimonial-parallax")) {
  customElements.define("testimonial-parallax", TestimonialParallax);
}

class ProductHighlightPoints extends TestimonialParallax {
  connectedCallback() {
    super.connectedCallback();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
  }
}

if (!customElements.get("product-highlight-points")) {
  customElements.define("product-highlight-points", ProductHighlightPoints);
}

class FlexCarousel extends CarouselComponent {
  connectedCallback() {
    super.connectedCallback();

    // Wait for parent CarouselComponent to finish Swiper initialization
    // Check if already initialized (in case event fired before our connectedCallback)
    if (this.swiperInstance) {
      this.#init();
    } else {
      // Listen for carousel:ready event
      this.addEventListener(
        "carousel:ready",
        () => {
          this.#init();
        },
        { once: true }
      );
    }
  }

  #init() {
    if (!this.swiperInstance) return;

    const EVENTS = ["reachBeginning", "reachEnd", "fromEdge"];
    const shadowsList = this.querySelectorAll(".edge__shadows");

    shadowsList.forEach((edgeEl) => {
      const isThumb = edgeEl.getAttribute("ref") === "thumbnails";
      const swiper = isThumb ? this.thumbnailSwiper : this.swiperInstance;

      edgeEl.classList.add("is--active");

      this.#updateShadow(edgeEl, swiper);

      EVENTS.forEach((evt) => {
        swiper.on(evt, () => this.#updateShadow(edgeEl, swiper));
      });
    });
  }

  updatedCallback() {
    this.addEventListener("carousel:ready", () => this.#init(), { once: true });
    super.updatedCallback?.();
  }

  #updateShadow(edgeEl, swiper) {
    edgeEl.classList.toggle("is--beginning", swiper.isBeginning);
    edgeEl.classList.toggle("is--end", swiper.isEnd);
  }
}

customElements.define("flex-carousel", FlexCarousel);

if (!customElements.get("footer-details")) {
  customElements.define(
    "footer-details",
    class FooterDetails extends HTMLDetailsElement {
      constructor() {
        super();
      }

      get accordionEl() {
        return (this._accordionEl = this._accordionEl || this.closest("accordion-component"));
      }

      connectedCallback() {
        this.openDefault = this.dataset.openDefault === "true";

        const mqlTablet = window.matchMedia("screen and (max-width: 1023px)");
        const updateOpen = (isTablet) => {
          const shouldOpen = isTablet ? this.openDefault : true;

          if (this.open === shouldOpen) return;

          // Check if accordion component exists and has refs initialized
          const accordionEl = this.accordionEl;
          if (!accordionEl || !accordionEl.refs) {
            console.warn("footer-details: accordion-component not found or refs not initialized");
            return;
          }

          const { item: items, summary: summaries, content: contents } = accordionEl.refs;

          // Fallback if refs are not available
          if (!items || !summaries || !contents) {
            // Use DOM query as fallback
            const item = this.closest("details") || this;
            const summary = item.querySelector("summary");
            const content = item.querySelector(".accordion__content");

            if (accordionEl.toggleOpen && item && summary && content) {
              accordionEl.toggleOpen({
                willOpen: shouldOpen,
                item,
                summary,
                content,
              });
            }
            return;
          }

          let idx = -1;
          if (Array.isArray(items)) idx = items.indexOf(this);

          let item = Array.isArray(items) ? items[idx] : items;
          let summary = Array.isArray(summaries) ? summaries[idx] : summaries;
          let content = Array.isArray(contents) ? contents[idx] : contents;

          if (!item || !summary || !content) return;

          accordionEl.toggleOpen({
            willOpen: shouldOpen,
            item,
            summary,
            content,
          });
        };

        updateOpen(mqlTablet.matches);
        mqlTablet.onchange = (event) => updateOpen(event.matches);
      }
    },
    { extends: "details" }
  );
}

class MarqueeComponent extends Component {
  requiredRefs = ["inner"];

  #resizeObserver;
  #scrollStop = null;
  #inViewStop = null;
  #intersectionObserver = null;
  #initObserver = null;
  #initScheduled = false;
  #initialized = false;
  #previousWidth = 0;

  static #PAUSE_OBSERVER_MARGIN = "0px 0px 50px 0px";
  static #INIT_OBSERVER_MARGIN = "300px 0px";
  static #MIN_COPIES = 2;
  static #DURATION_MULTIPLIER = 33;
  static #DURATION_MAX_RATIO = 2.5;
  static #DEFAULT_DURATION = "20s";
  static #DEFAULT_PARALLAX = 0.55;
  static #RESIZE_DEBOUNCE = 200;

  connectedCallback() {
    super.connectedCallback();
    if (prefersReducedMotion()) return;

    this.isRTL = false;

    this.#scheduleInit();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#cleanup();
  }

  #scheduleInit() {
    if (this.#initScheduled) return;
    this.#initScheduled = true;

    if (typeof IntersectionObserver !== "undefined") {
      this.#initObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry?.isIntersecting) return;
          this.#initObserver?.disconnect();
          this.#initObserver = null;
          this.#init();
        },
        { rootMargin: MarqueeComponent.#INIT_OBSERVER_MARGIN }
      );
      this.#initObserver.observe(this);
    } else if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => this.#init(), { timeout: 1000 });
    } else {
      setTimeout(() => this.#init(), 100);
    }
  }

  #init() {
    if (this.#initialized) return;
    this.#initialized = true;

    const { inner } = this.refs;
    if (!inner) return;

    const item = inner.firstElementChild;
    if (!item) return;

    requestAnimationFrame(() => {
      // Batch all layout reads
      const height = this.offsetHeight;
      const isRotated = this.classList.contains("marquee--rotated");
      const childWidth = this.#getChildWidthSync(inner);
      const parentWidth = this.#getParentWidthSync();

      // Perform non-layout operations
      item.classList.add("animate");

      // Set animation duration with cached values
      this.#setAnimationDurationWithValues(childWidth, parentWidth);

      // Set height and rotate offset with cached values
      this.style.setProperty("--block-height", `${height}px`);
      if (isRotated) {
        this._setRotateOffsetWithHeight(height);
      } else {
        this.style.setProperty("--offset", "0px");
      }

      this.#adjustItemCount(false, childWidth, parentWidth, true);
      this.#previousWidth = parentWidth;

      if (this.parallax) {
        this.#initParallax();
        requestAnimationFrame(() => {
          this.#adjustItemCount();
        });
      } else {
        this.#initPauseObserver();
      }

      this.#setupResizeObserver();
    });
  }

  #getChildWidthSync(inner) {
    const item = inner?.firstElementChild;
    if (!item) return 1;
    const rect = item.getBoundingClientRect();
    return rect.right - rect.left;
  }

  #getParentWidthSync() {
    const rect = this.getBoundingClientRect();
    return rect.right - rect.left;
  }

  #setAnimationDurationWithValues(childWidth, parentWidth) {
    const liquidDuration = this.duration;
    if (liquidDuration && liquidDuration > 0) {
      this.style.setProperty("--duration", `${liquidDuration}s`);
      return;
    }

    if (childWidth > 0 && parentWidth > 0) {
      const ratio = Math.ceil(childWidth / parentWidth);
      const defaultSpeed = 16;
      const duration =
        (MarqueeComponent.#DURATION_MULTIPLIER - defaultSpeed) * Math.min(MarqueeComponent.#DURATION_MAX_RATIO, ratio);
      this.style.setProperty("--duration", `${duration}s`);
    } else {
      this.style.setProperty("--duration", MarqueeComponent.#DEFAULT_DURATION);
    }
  }

  #cleanup() {
    this.#initObserver?.disconnect();
    this.#initObserver = null;
    this.#resizeObserver?.disconnect();
    window.removeEventListener("resize", this.#handleResize);
    this.#intersectionObserver?.disconnect();
    this.#inViewStop?.();
    this.#scrollStop?.();
    this.#intersectionObserver = null;
    this.#inViewStop = null;
    this.#scrollStop = null;
  }

  #setAnimationDuration() {
    const liquidDuration = this.duration;
    if (liquidDuration && liquidDuration > 0) {
      this.style.setProperty("--duration", `${liquidDuration}s`);
      return;
    }

    const { inner } = this.refs;
    const childWidth = this.#getChildWidthSync(inner);
    const parentWidth = this.#getParentWidthSync();

    this.#setAnimationDurationWithValues(childWidth, parentWidth);
  }

  #adjustItemCount(
    resetAll = false,
    measuredChildWidth = null,
    measuredParentWidth = null,
    skipDurationRecalc = false
  ) {
    const { inner } = this.refs;
    if (!inner) return;

    const currentCount = inner.children.length;
    if (currentCount === 0) return;

    const originalItem = inner.firstElementChild;
    if (!originalItem) return;

    if (resetAll && currentCount > 1) {
      while (inner.children.length > 1) {
        inner.lastElementChild?.remove();
      }
    }

    const childWidth =
      typeof measuredChildWidth === "number" && measuredChildWidth > 0
        ? measuredChildWidth
        : this.#getChildWidthSync(inner);
    const parentWidth =
      typeof measuredParentWidth === "number" && measuredParentWidth > 0
        ? measuredParentWidth
        : this.#getParentWidthSync();
    const exactCount = this.#calculateNumberOfCopies(childWidth, parentWidth);
    const finalCount = inner.children.length;

    if (exactCount > finalCount) {
      const numberToAdd = exactCount - finalCount;
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < numberToAdd; i++) {
        const clone = originalItem.cloneNode(true);
        this.#disableFocusableElements(clone);
        clone.setAttribute("aria-hidden", "true");
        clone.classList.add("animate");
        fragment.appendChild(clone);
      }
      inner.appendChild(fragment);

      requestAnimationFrame(() => {
        inner.querySelectorAll(".marquee__items:not(:first-child) .media").forEach((media) => {
          const img = media.querySelector("img.media__image");
          if (img && img.complete && img.naturalWidth > 0) {
            media.classList.remove("loading");
            if (img.classList.contains("loading")) {
              img.classList.remove("loading");
              img.classList.add("loaded");
            }
          }
        });
      });
    } else if (exactCount < finalCount) {
      const itemsToRemove = Math.min(finalCount - exactCount, finalCount - 1);
      this.#removeRepeatedItems(itemsToRemove);
    }

    if (!skipDurationRecalc && !this.hasAttribute("data-duration")) {
      this.#setAnimationDuration();
    }
  }

  #addRepeatedItems(numberOfCopies, templateItem = null) {
    const { inner } = this.refs;
    if (!inner) return;

    const item = templateItem || inner.firstElementChild;
    if (!item) return;

    for (let i = 0; i < numberOfCopies; i++) {
      this.#cloneItem(item, inner);
    }
  }

  #removeRepeatedItems(numberOfCopies) {
    const { inner } = this.refs;
    if (!inner) return;

    for (let i = 0; i < numberOfCopies; i++) {
      inner.lastElementChild?.remove();
    }
  }

  #cloneItem(item, container) {
    const clone = item.cloneNode(true);
    this.#disableFocusableElements(clone);
    clone.setAttribute("aria-hidden", "true");
    clone.classList.add("animate");
    container.appendChild(clone);

    // Handle images in cloned items to prevent flicker
    // Only remove loading class if images are already loaded
    clone.querySelectorAll(".media").forEach((media) => {
      const img = media.querySelector("img.media__image");
      if (img && img.complete && img.naturalWidth > 0) {
        // Image is already loaded, safe to remove loading class
        media.classList.remove("loading");
        if (img.classList.contains("loading")) {
          img.classList.remove("loading");
          img.classList.add("loaded");
        }
      }
      // If image is not loaded yet, keep loading class to prevent flicker
      // responsive-image will handle removing it when image loads
    });
  }

  #getFocusableElements(wrapperEl) {
    const focusableSelectors = "a[href], button:enabled, [tabindex]:not([tabindex^='-'])";
    const focusableElements = wrapperEl.querySelectorAll(focusableSelectors);

    return focusableElements;
  }

  #disableFocusableElements(wrapperEl) {
    const focusableElements = this.#getFocusableElements(wrapperEl);

    focusableElements &&
      focusableElements.forEach((el) => {
        el.setAttribute("tabindex", "-1");
      });
  }

  #calculateNumberOfCopies(childWidth = null, parentWidth = null) {
    const { inner } = this.refs;
    const safeChildWidth =
      typeof childWidth === "number" && childWidth > 0 ? childWidth : this.#getChildWidthSync(inner);
    const safeParentWidth =
      typeof parentWidth === "number" && parentWidth > 0 ? parentWidth : this.#getParentWidthSync();

    if (safeChildWidth <= 0 || safeParentWidth <= 0) {
      return MarqueeComponent.#MIN_COPIES;
    }

    const baseCopies = Math.ceil(safeParentWidth / safeChildWidth);

    if (this.parallax) {
      const parallaxValue = this.#parseParallaxValue();
      const parallaxTranslate = Math.abs((parallaxValue * 100) / (1 + parallaxValue));
      const parallaxMultiplier = 1.5;
      const extraCopies = Math.ceil(parallaxTranslate / 10) + 4;
      return Math.ceil(baseCopies * parallaxMultiplier) + extraCopies;
    }

    return baseCopies + 2;
  }

  #initParallax() {
    this.#createParallaxAnimation();
    this.#initParallaxPauseObserver();
  }

  #createParallaxAnimation() {
    const parallaxValue = this.#parseParallaxValue();
    let translate = this.#calculateParallaxTranslate(parallaxValue);

    this.#scrollStop = scroll(
      animate(this.refs.inner, { transform: [`translateX(${translate}%)`, `translateX(0)`] }, { easing: "linear" }),
      {
        target: this,
        offset: ["start end", "end start"],
      }
    );
  }

  #parseParallaxValue() {
    const parallaxAttr = this.getAttribute("data-parallax");
    if (!parallaxAttr || parallaxAttr === "false") return 0;
    if (parallaxAttr === "true") return MarqueeComponent.#DEFAULT_PARALLAX;
    return parseFloat(parallaxAttr);
  }

  #calculateParallaxTranslate(parallaxValue) {
    let translate = (parallaxValue * 100) / (1 + parallaxValue);
    const isReverse = this.direction === "reverse" || this.direction === "right";

    if (!isReverse) {
      translate *= -1;
    }

    if (this.isRTL) {
      translate *= -1;
    }

    return translate;
  }

  #initParallaxPauseObserver() {
    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            this.#pauseParallax();
          } else {
            this.#resumeParallax();
          }
        });
      },
      {
        rootMargin: MarqueeComponent.#PAUSE_OBSERVER_MARGIN,
      }
    );
    this.#intersectionObserver.observe(this);
  }

  #pauseParallax() {
    this.classList.add("paused");
    if (this.#scrollStop) {
      this.#scrollStop();
      this.#scrollStop = null;
    }
  }

  #resumeParallax() {
    this.classList.remove("paused");
    if (!this.#scrollStop) {
      this.#createParallaxAnimation();
    }
  }

  #initPauseObserver() {
    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.classList.remove("paused");
          } else {
            this.classList.add("paused");
          }
        });
      },
      {
        rootMargin: MarqueeComponent.#PAUSE_OBSERVER_MARGIN,
      }
    );
    this.#intersectionObserver.observe(this);
  }

  #setupResizeObserver() {
    this.#resizeObserver = new ResizeObserver(() => this.#setHeight());
    this.#resizeObserver.observe(this);
    window.addEventListener("resize", this.#handleResize);
  }

  #handleResize = debounce(() => {
    const currentWidth = this.parentWidth;
    if (currentWidth === this.#previousWidth) return;

    this.#previousWidth = currentWidth;

    const { inner } = this.refs;
    if (!inner) return;

    const allItemsElements = inner.querySelectorAll(".marquee__items");
    allItemsElements.forEach((el) => {
      el.classList.remove("animate");
      el.style.transform = "";
    });

    if (this.parallax && this.#scrollStop) {
      this.#scrollStop();
      this.#scrollStop = null;
      inner.style.transform = "";
    }

    this.#adjustItemCount(true, null, currentWidth);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const currentItemsElements = inner.querySelectorAll(".marquee__items");
        currentItemsElements.forEach((el) => {
          el.classList.add("animate");
          el.style.transform = "";
        });

        if (this.parallax) {
          this.#createParallaxAnimation();
        }
      });
    });
  }, MarqueeComponent.#RESIZE_DEBOUNCE);

  #setHeight() {
    // Called from ResizeObserver, batch reads and writes
    const height = this.offsetHeight;
    const isRotated = this.classList.contains("marquee--rotated");

    // Batch writes after all reads
    this.style.setProperty("--block-height", `${height}px`);

    if (isRotated) {
      this._setRotateOffsetWithHeight(height);
    } else {
      this.style.setProperty("--offset", "0px");
    }
  }

  _setRotateOffsetWithHeight(blockHeight) {
    let angleDeg =
      parseFloat(this.style.getPropertyValue("--angle-raw")) || parseFloat(this.style.getPropertyValue("--angle")) || 0;

    if (angleDeg === 0) {
      this.style.setProperty("--offset", "0px");
      return;
    }

    angleDeg *= isRTL() ? -1 : 1;

    const angleRad = (Math.abs(angleDeg) * Math.PI) / 180;
    const offset = blockHeight * Math.tan(angleRad);

    this.style.setProperty("--offset", `${offset}px`);
  }

  #setRotateOffset() {
    // Legacy method - kept for compatibility
    // Now handled inline in #setHeight() to avoid double rAF
    if (!this.classList.contains("marquee--rotated")) {
      this.style.setProperty("--offset", "0px");
      return;
    }

    const angleDeg =
      parseFloat(this.style.getPropertyValue("--angle-raw")) || parseFloat(this.style.getPropertyValue("--angle")) || 0;
    if (angleDeg === 0) {
      this.style.setProperty("--offset", "0px");
      return;
    }

    const angleRad = (Math.abs(angleDeg) * Math.PI) / 180;
    const blockHeight = this.offsetHeight || parseFloat(this.style.getPropertyValue("--block-height")) || 0;
    const offset = blockHeight * Math.tan(angleRad);

    this.style.setProperty("--offset", `${offset}px`);
  }

  onPause() {
    this.classList.add("paused");
    if (this.parallax && this.#scrollStop) {
      this.#scrollStop();
      this.#scrollStop = null;
    }
  }

  onPlay() {
    this.classList.remove("paused");
    if (this.parallax && !this.#scrollStop) {
      this.#createParallaxAnimation();
    }
  }

  get direction() {
    return this.getAttribute("data-direction") || "forward";
  }

  get duration() {
    if (!this.hasAttribute("data-duration")) return null;
    const value = parseFloat(this.getAttribute("data-duration"));
    return isNaN(value) ? null : value;
  }

  get parallax() {
    if (isTouch()) return false;
    return this.#parseParallaxValue();
  }

  get parentWidth() {
    const rect = this.getBoundingClientRect();
    return rect.right - rect.left;
  }

  get childElementWidth() {
    const { inner } = this.refs;
    const item = inner?.firstElementChild;
    if (!item) return 1;
    const rect = item.getBoundingClientRect();
    return rect.right - rect.left;
  }
}

if (!customElements.get("marquee-component")) {
  customElements.define("marquee-component", MarqueeComponent);
}

class TestimonialSplitContent extends CarouselComponent {
  connectedCallback() {
    super.connectedCallback();

    if (this.swiperInstance) {
      this.#init();
    } else {
      this.addEventListener(
        "carousel:ready",
        () => {
          this.#init();
        },
        { once: true }
      );
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  updatedCallback() {
    this.addEventListener("carousel:ready", () => this.#init(), { once: true });
    super.updatedCallback?.();
  }

  #init() {
    if (typeof this.swiperInstance !== "object") return;

    this.#updateControlsScheme(this.refs.slides[0]);

    this.swiperInstance.on("realIndexChange", this.#handleChange);
  }

  #handleChange = (swiper) => {
    const { slides, realIndex, activeIndex } = swiper;
    this.selectedIndex = realIndex;

    this.#updateControlsScheme(slides[activeIndex]);
  };

  #updateControlsScheme(activeSlide) {
    const activeSlideInner = activeSlide.querySelector(".testimonial-split__content");
    if (this.wrapper) {
      const classesToRemove = Array.from(this.wrapper.classList).filter((className) => className.startsWith("color-"));
      classesToRemove.forEach((className) => this.wrapper.classList.remove(className));
      const colorScheme = `color-${activeSlideInner.dataset.colorScheme}`;
      if (colorScheme) this.wrapper.classList.add(colorScheme);
    }
  }

  get wrapper() {
    return this.parentElement?.closest(".testimonials-split-slider__content");
  }
}

if (!customElements.get("testimonial-split-content")) {
  customElements.define("testimonial-split-content", TestimonialSplitContent);
}

class TestimonialsSplitSlider extends Component {
  requiredRefs = ["content"];

  constructor() {
    super();
    this.selectedIndex = this.selectedIndex;
  }

  static get observedAttributes() {
    return ["selected-index"];
  }

  get selectedIndex() {
    return parseInt(this.getAttribute("selected-index")) || 0;
  }

  set selectedIndex(index) {
    this.setAttribute("selected-index", `${index}`);
  }

  connectedCallback() {
    super.connectedCallback();

    this.#init();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#cleanup();
  }

  updatedCallback() {
    super.updatedCallback?.();
    const { content } = this.refs;
    if (content) {
      content.addEventListener("carousel:ready", () => this.#setupSync(), { once: true });
    }
  }

  #init() {
    const { content } = this.refs;
    if (!content) return;

    if (content.swiperInstance) {
      this.#setupSync();
    } else {
      content.addEventListener(
        "carousel:ready",
        () => {
          this.#setupSync();
        },
        { once: true }
      );
    }
  }

  #setupSync() {
    const { content } = this.refs;
    if (!content?.swiperInstance) return;

    content.swiperInstance.on("realIndexChange", this.#handleSlideChange);
  }

  #handleSlideChange = (swiper) => {
    const { realIndex } = swiper;
    this.selectedIndex = realIndex;
  };

  #cleanup() {
    const { content } = this.refs;

    if (content?.swiperInstance) {
      content.swiperInstance.off("realIndexChange", this.#handleSlideChange);
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "selected-index" && oldValue !== null && oldValue !== newValue) {
      const { mediaItems } = this.refs;
      if (!mediaItems) return;

      const prevSlide = mediaItems[oldValue];
      const currentSlide = mediaItems[newValue];

      prevSlide?.classList.remove("active");
      currentSlide?.classList.add("active");

      if (currentSlide && !document.body.hasAttribute("data-motion-disabled")) {
        const motionEls = currentSlide.querySelectorAll("motion-component");
        motionEls.forEach((el) => {
          el.replay();
        });
      }
    }
  }
}

if (!customElements.get("testimonials-split-slider")) {
  customElements.define("testimonials-split-slider", TestimonialsSplitSlider);
}

class MasonryComponent extends Component {
  #resizeObserver = null;
  #resizeHandler = null;
  #lastWidth = 0;

  connectedCallback() {
    super.connectedCallback();

    // Setup resize observer to recalculate on layout changes
    this.#resizeObserver = new ResizeNotifier(() => {
      requestAnimationFrame(() => {
        this.calculatePositioning();
      });
    });
    this.#resizeObserver.observe(this);

    // Setup debounced window resize handler (skip height-only changes from mobile URL bar)
    this.#resizeHandler = debounce(() => {
      const currentWidth = window.innerWidth;
      if (currentWidth === this.#lastWidth) return;
      this.#lastWidth = currentWidth;
      requestAnimationFrame(() => {
        this.calculatePositioning();
      });
    }, 150);

    window.addEventListener("resize", this.#resizeHandler, { passive: true });

    // Initial calculation
    this.#lastWidth = window.innerWidth;
    requestAnimationFrame(() => {
      this.calculatePositioning();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this.#resizeObserver) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }

    // Clean up resize handler
    if (this.#resizeHandler) {
      this.#resizeHandler.cancel();
      window.removeEventListener("resize", this.#resizeHandler);
      this.#resizeHandler = null;
    }
  }

  /**
   * Get current column number based on device breakpoint
   * @returns {number} Number of columns for current device
   */
  get columnNumber() {
    const computedStyles = window.getComputedStyle(this);
    const columns = computedStyles.getPropertyValue("--f-grid-columns");
    if (!columns) return 1;

    return parseInt(columns) || 1;
  }

  /**
   * Get row gap from CSS variable
   * @returns {number} Row gap in pixels
   */
  get rowGap() {
    const computedStyles = window.getComputedStyle(this);
    const rowGap = computedStyles.getPropertyValue("--f-row-gap");
    const rowGapMobile = computedStyles.getPropertyValue("--f-row-gap-mobile");

    const temp = document.createElement("div");
    temp.style.position = "absolute";
    temp.style.visibility = "hidden";
    temp.style.rowGap = rowGap;
    temp.style.rowGapMobile = rowGapMobile;

    document.body.appendChild(temp);

    const resolvedValue = parseFloat(getComputedStyle(temp).rowGap);
    const resolvedValueMobile = parseFloat(getComputedStyle(temp).rowGapMobile);

    temp.remove();

    // Check mobile row gap if on mobile
    if (isMobileBreakpoint()) {
      if (resolvedValueMobile) {
        return resolvedValueMobile || 0;
      }
    }

    return resolvedValue || 0;
  }

  disable() {
    Array.from(this.refs.items).forEach((item) => item.style.removeProperty("--offset-top"));
  }

  calculatePositioning() {
    this.disable();
    if (this.columnNumber <= 1) return;
    Array.from(this.refs.items)
      .slice(this.columnNumber)
      .forEach((col, i) => {
        const prevItem = this.refs.items[i].children[0];
        const currentItem = col.children[0];

        const prevItemPos = prevItem.getBoundingClientRect().bottom;
        const currentItemPos = currentItem.getBoundingClientRect().top;

        const offsetTop = prevItemPos - currentItemPos + this.rowGap;

        col.style.setProperty("--offset-top", `${offsetTop}px`);
      });
  }
}

if (!customElements.get("masonry-component")) {
  customElements.define("masonry-component", MasonryComponent);
}

/**
 * @typedef {Object} ShowMoreWrapperRefs
 * @property {HTMLElement} wrapper - The wrapper element to check height and expand/collapse
 * @property {HTMLElement} showMoreButton - The button to toggle visibility
 */

/**
 * A custom element that shows a "show more" button when wrapper height exceeds 75svh
 * and allows expanding to show full content
 *
 * @extends {Component<ShowMoreWrapperRefs>}
 */
class ShowMoreWrapperComponent extends Component {
  requiredRefs = ["showMoreContent", "showMoreButton"];

  /**
   * @type {boolean}
   */
  #expanded = false;

  /**
   * @type {boolean}
   */
  #isAnimating = false;

  /**
   * @type {number}
   */
  #collapsedHeight = 0;

  /**
   * @type {Animation | undefined}
   */
  #animation;

  /**
   * @constant {number}
   */
  #animationSpeed = 300;

  /**
   * Get max height threshold from HTML attribute or use default
   * @returns {number} Max height threshold as percentage of viewport height (default: 70)
   */
  get #maxHeightThreshold() {
    const attrValue = this.getAttribute("data-max-height");
    if (attrValue) {
      const parsed = parseFloat(attrValue);
      return isNaN(parsed) ? 70 : parsed;
    }
    return 70; // Default: 70svh
  }

  #resizeObserver = null;
  #resizeHandler = null;
  #lastWidth = 0;

  connectedCallback() {
    super.connectedCallback();

    // Defer initialization to ensure layout is ready
    requestAnimationFrame(() => {
      this.#init();
    });

    // Setup resize observer to check height changes
    this.#resizeObserver = new ResizeNotifier(() => {
      requestAnimationFrame(() => {
        this.#checkHeight();
      });
    });
    this.#resizeObserver.observe(this.refs.showMoreContent);

    // Setup debounced window resize handler (skip height-only changes from mobile URL bar)
    this.#resizeHandler = debounce(() => {
      const currentWidth = window.innerWidth;
      if (currentWidth === this.#lastWidth) return;
      this.#lastWidth = currentWidth;
      requestAnimationFrame(() => {
        this.#checkHeight();
      });
    }, 150);

    window.addEventListener("resize", this.#resizeHandler, { passive: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this.#resizeObserver) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }

    if (this.#resizeHandler) {
      this.#resizeHandler.cancel();
      window.removeEventListener("resize", this.#resizeHandler);
      this.#resizeHandler = null;
    }

    if (this.#animation) {
      this.#animation.cancel();
      this.#animation = null;
    }
  }

  /**
   * Initialize component - check height and setup initial state
   */
  #init() {
    this.#lastWidth = window.innerWidth;
    this.#checkHeight();
  }

  /**
   * Check if content height exceeds threshold and show/hide button accordingly
   */
  #checkHeight() {
    // Don't check height while animating to prevent conflicts
    if (this.#isAnimating) return;
    if (this.#expanded) return;

    const { showMoreContent, showMoreButtonWrapper } = this.refs;
    if (!showMoreContent || !showMoreButtonWrapper) return;

    const svhHeight = (window.visualViewport?.height || window.innerHeight) * (this.#maxHeightThreshold / 100);
    const contentHeight = showMoreContent.scrollHeight;

    // If wrapper height exceeds threshold, show button
    if (contentHeight > svhHeight) {
      showMoreButtonWrapper.classList.remove("hidden");
      this.#collapsedHeight = svhHeight;

      // If not expanded, set initial height
      if (!this.#expanded) {
        showMoreContent.style.maxHeight = `${svhHeight}px`;
        showMoreContent.style.overflow = "hidden";
      }
    } else {
      // Hide button if content fits within threshold
      showMoreButtonWrapper.classList.add("hidden");
      showMoreContent.style.removeProperty("max-height");
      showMoreContent.style.removeProperty("overflow");
      this.#expanded = false;
    }
  }

  /**
   * Handles expanding the wrapper to show full content
   * @returns {{startHeight: number, endHeight: number}}
   */
  #expand() {
    const { showMoreContent } = this.refs;
    const startHeight = showMoreContent.offsetHeight;
    const endHeight = showMoreContent.scrollHeight;

    return { startHeight, endHeight };
  }

  /**
   * Handles collapsing the wrapper back to threshold height
   * @returns {{startHeight: number, endHeight: number}}
   */
  #collapse() {
    const { showMoreContent } = this.refs;
    const startHeight = showMoreContent.offsetHeight;
    const endHeight = this.#collapsedHeight;

    return { startHeight, endHeight };
  }

  /**
   * Animate height transition
   * @param {number} startHeight
   * @param {number} endHeight
   */
  #animateHeight(startHeight, endHeight) {
    const { showMoreContent } = this.refs;

    this.#isAnimating = true;
    showMoreContent.style.overflow = "hidden";
    this.#animation?.cancel();

    const distance = Math.abs(endHeight - startHeight);
    const duration = Math.min(Math.max(distance * 0.5, this.#animationSpeed), 600);

    this.#animation = showMoreContent.animate(
      {
        maxHeight: [`${startHeight}px`, `${endHeight}px`],
      },
      {
        duration,
        easing: "ease-in-out",
      }
    );

    this.#animation.onfinish = () => this.#onAnimationFinish();
  }

  /**
   * Handles the animation finish event
   */
  #onAnimationFinish() {
    const { showMoreContent, showMoreButtonWrapper } = this.refs;

    this.#expanded = !this.#expanded;

    if (this.#expanded) {
      showMoreContent.style.removeProperty("max-height");
      showMoreContent.style.overflow = "";

      if (showMoreButtonWrapper) {
        showMoreButtonWrapper.classList.add("show-more-button--expanded");
      }
    } else {
      showMoreContent.style.maxHeight = `${this.#collapsedHeight}px`;
      showMoreContent.style.overflow = "hidden";
    }

    this.#updateButtonLabel();
    this.#isAnimating = false;
  }

  /**
   * Swap button label between "show more" and "show less"
   */
  #updateButtonLabel() {
    const { showMoreButton } = this.refs;
    if (!showMoreButton) return;

    const label = this.#expanded ? showMoreButton.dataset.showLessLabel : showMoreButton.dataset.showMoreLabel;

    if (!label) return;

    showMoreButton.querySelectorAll(".btn__text, .btn__icon-text").forEach((el) => (el.textContent = label));
  }

  /**
   * Start the collapse/expand animation with attribute updates
   * @param {boolean} willExpand
   */
  #startToggle(willExpand) {
    const { showMoreButton, showMoreButtonWrapper } = this.refs;
    this.dataset.expanded = willExpand ? "true" : "false";
    showMoreButton.setAttribute("aria-expanded", willExpand ? "true" : "false");

    if (!willExpand && showMoreButtonWrapper) {
      showMoreButtonWrapper.classList.remove("show-more-button--expanded");
    }

    const { startHeight, endHeight } = willExpand ? this.#expand() : this.#collapse();
    this.#animateHeight(startHeight, endHeight);
  }

  /**
   * Scroll to section top first, then start collapse animation
   */
  #collapseWithScroll() {
    const section = this.closest(".section");
    const target = section || this;
    const rect = target.getBoundingClientRect();

    if (rect.top >= -10) {
      this.#startToggle(false);
      return;
    }

    this.#isAnimating = true;
    target.scrollIntoView({ behavior: "smooth", block: "start" });

    let done = false;
    const startCollapse = () => {
      if (done) return;
      done = true;
      document.removeEventListener("scrollend", startCollapse);
      this.#isAnimating = false;
      this.#startToggle(false);
    };

    document.addEventListener("scrollend", startCollapse, { once: true });
    setTimeout(startCollapse, 800);
  }

  /**
   * Toggles the expansion state of the content
   * @param {Event} event - The click event
   */
  toggle = (event) => {
    event.preventDefault();

    const { showMoreButton } = this.refs;
    if (!showMoreButton || this.#isAnimating) return;

    if (!this.#expanded) {
      this.#startToggle(true);
    } else {
      this.#collapseWithScroll();
    }
  };
}

if (!customElements.get("show-more-wrapper-component")) {
  customElements.define("show-more-wrapper-component", ShowMoreWrapperComponent);
}
class IconBoxesSlider extends CarouselComponent {
  /** @type {(() => void) | null} */
  #loopResizeCleanup = null;

  connectedCallback() {
    super.connectedCallback();

    // Listen to carousel:ready every time (not once) to handle destroy/reinit
    this.addEventListener("carousel:ready", () => {
      this.#init();
    });
  }

  disconnectedCallback() {
    // Cleanup loop resize listener
    if (this.#loopResizeCleanup) {
      this.#loopResizeCleanup();
      this.#loopResizeCleanup = null;
    }
    super.disconnectedCallback();
  }

  #shouldDisableLoop() {
    // Check if Swiper should be destroyed based on destroyBelow (same logic as CarouselComponent)
    const options = this.finalOptions || this.lastResolvedOptions;
    if (!options) return false;

    const w = window.innerWidth || 0;
    const below = Number(options.destroyBelow);
    const above = Number(options.destroyAbove);

    // If destroyBelow is set and viewport is below it, disable loop (Swiper will be destroyed)
    if (!Number.isNaN(below) && w < below) return true;
    // If destroyAbove is set and viewport is above it, disable loop (Swiper will be destroyed)
    if (!Number.isNaN(above) && w > above) return true;

    // Default: disable loop on mobile (≤767px) if destroyBelow is not set
    if (Number.isNaN(below) && Number.isNaN(above)) {
      return w <= 767;
    }

    return false;
  }

  #init() {
    const swiper = this.swiperInstance;
    if (!swiper) return;

    // Force disable Swiper's built-in loop
    if (swiper.params?.loop) {
      swiper.params.loop = false;
    }

    // Create or destroy loop based on viewport and destroyBelow param
    if (this.#shouldDisableLoop()) {
      this.#destroyLoop();
    } else {
      this.#createLoop();
    }

    // Setup responsive loop handling
    this.#setupLoopResponsive();

    // Only setup loop fix handlers when loop is enabled
    if (!this.#shouldDisableLoop()) {
      // Set initial position to first original slide (after prepended clones)
      requestAnimationFrame(() => {
        if (!swiper || swiper.destroyed) return;
        const centeredSlides = swiper.params.centeredSlides || false;
        const slidesPerView = swiper.params.slidesPerView || 1;

        // For centeredSlides, find the first original slide index
        let initialIndex = this.loopedSlides;
        if (centeredSlides) {
          // With centeredSlides, we need to center the first slide
          // Find the first original slide (not duplicate)
          const originalSlides = swiper.slides.filter((slide) => !slide.classList.contains("swiper-slide-duplicate"));
          if (originalSlides.length > 0) {
            const firstOriginalIndex = swiper.getSlideIndex(originalSlides[0]);
            if (firstOriginalIndex >= 0) {
              initialIndex = firstOriginalIndex;
            }
          }
        }

        swiper.slideTo(initialIndex, 0, false);
      });

      // Setup loop fix on slide change transition end (Swiper v8 style)
      // Fix after transition completes to ensure smooth transform
      swiper.on("slideChangeTransitionEnd", () => {
        this.#loopFix();
      });

      // Setup loop fix during drag to prevent buttons from being disabled
      // Listen to sliderMove to detect when dragging near edges
      swiper.on("sliderMove", () => {
        this.#loopFixDuringDrag();
      });

      // Ensure allowSlidePrev/allowSlideNext are always true for loop
      // Override updateSlidesClasses to prevent disabling buttons
      const originalUpdateSlidesClasses = swiper.updateSlidesClasses;
      swiper.updateSlidesClasses = () => {
        originalUpdateSlidesClasses.call(swiper);
        // Always allow navigation in loop mode
        swiper.allowSlidePrev = true;
        swiper.allowSlideNext = true;
      };
    }
  }

  #setupLoopResponsive() {
    // Cleanup existing listener
    if (this.#loopResizeCleanup) {
      this.#loopResizeCleanup();
      this.#loopResizeCleanup = null;
    }

    // Track loop disabled state - reset when Swiper is reinit
    let wasLoopDisabled = this.#shouldDisableLoop();

    // Reset state when Swiper is reinit (after destroy)
    const handleCarouselReady = () => {
      wasLoopDisabled = this.#shouldDisableLoop();
    };
    this.addEventListener("carousel:ready", handleCarouselReady);

    const handleResize = () => {
      const shouldDisableLoop = this.#shouldDisableLoop();
      const swiper = this.swiperInstance;

      // Only handle if state changed
      if (shouldDisableLoop === wasLoopDisabled) return;

      wasLoopDisabled = shouldDisableLoop;

      requestAnimationFrame(() => {
        // If Swiper is destroyed, handle duplicates in DOM directly
        if (!swiper || swiper.destroyed) {
          const container = this.refs?.container;
          if (container) {
            if (shouldDisableLoop) {
              // Remove duplicates when loop should be disabled
              const duplicates = Array.from(container.querySelectorAll(".swiper-slide-duplicate"));
              duplicates.forEach((el) => {
                if (el.parentNode) {
                  el.parentNode.removeChild(el);
                }
              });
            }
            // If loop should be enabled and Swiper destroyed, wait for reinit (handled in #init)
          }
          return;
        }

        if (shouldDisableLoop) {
          // Remove loop when should be disabled
          this.#destroyLoop();
        } else {
          // Add loop when should be enabled
          this.#createLoop();

          // Reset position after creating loop
          requestAnimationFrame(() => {
            if (!swiper || swiper.destroyed) return;
            const centeredSlides = swiper.params.centeredSlides || false;

            let initialIndex = this.loopedSlides;
            if (centeredSlides) {
              const originalSlides = swiper.slides.filter(
                (slide) => !slide.classList.contains("swiper-slide-duplicate")
              );
              if (originalSlides.length > 0) {
                const firstOriginalIndex = swiper.getSlideIndex(originalSlides[0]);
                if (firstOriginalIndex >= 0) {
                  initialIndex = firstOriginalIndex;
                }
              }
            }

            swiper.slideTo(initialIndex, 0, false);
          });
        }
      });
    };

    window.addEventListener("resize", handleResize);
    this.#loopResizeCleanup = () => {
      window.removeEventListener("resize", handleResize);
      this.removeEventListener("carousel:ready", handleCarouselReady);
    };
  }

  #destroyLoop() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) {
      // If Swiper is destroyed, remove duplicates from DOM directly
      const container = this.refs?.container;
      if (container) {
        const duplicates = Array.from(container.querySelectorAll(".swiper-slide-duplicate"));
        duplicates.forEach((el) => {
          if (el.parentNode) {
            el.parentNode.removeChild(el);
          }
        });
      }
      return;
    }

    const { slidesEl } = swiper;

    // Remove all duplicate slides
    const duplicates = Array.from(slidesEl.querySelectorAll(".swiper-slide-duplicate"));
    duplicates.forEach((el) => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });

    // Recalculate and update Swiper
    swiper.recalcSlides();
    swiper.updateSlides();
  }

  #createLoop() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.params?.loop) {
      return;
    }

    const { slidesEl, params } = swiper;

    // Remove existing duplicates
    const toRemove = Array.from(slidesEl.querySelectorAll(".swiper-slide-duplicate"));
    toRemove.forEach((el) => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });

    // Get original slides (excluding duplicates)
    const originalSlides = Array.from(slidesEl.querySelectorAll(`.${params.slideClass}`)).filter(
      (slide) => !slide.classList.contains("swiper-slide-duplicate")
    );

    if (originalSlides.length === 0) return;

    // Set data-swiper-slide-index on original slides
    originalSlides.forEach((slide, index) => {
      slide.setAttribute("data-swiper-slide-index", index);
    });

    // Calculate loopedSlides (Swiper v8/v11 logic)
    const slidesPerView = params.slidesPerView || 1;
    const slidesPerGroup = params.slidesPerGroup || 1;
    const loopAdditionalSlides = params.loopAdditionalSlides || 0;

    // Start with slidesPerGroup, ensure it's a multiple of slidesPerGroup
    let loopedSlides = slidesPerGroup;
    if (loopedSlides % slidesPerGroup !== 0) {
      loopedSlides += slidesPerGroup - (loopedSlides % slidesPerGroup);
    }
    loopedSlides += loopAdditionalSlides;

    // Ensure loopedSlides is at least slidesPerView to fill edges
    if (loopedSlides < slidesPerView) {
      loopedSlides = Math.ceil(slidesPerView / slidesPerGroup) * slidesPerGroup;
      loopedSlides += loopAdditionalSlides;
    }

    // Limit to original slides count if needed
    if (loopedSlides > originalSlides.length && params.loopedSlidesLimit !== false) {
      loopedSlides = originalSlides.length;
    }

    // Ensure minimum of 1
    loopedSlides = Math.max(1, loopedSlides);

    this.loopedSlides = loopedSlides;

    // Prepare slides to clone (Swiper v8 style)
    const prependSlides = [];
    const appendSlides = [];
    const cols = originalSlides.length;

    for (let i = 0; i < loopedSlides; i += 1) {
      // Calculate index with wrap-around
      const appendIndex = i % cols;
      appendSlides.push(originalSlides[appendIndex]);

      // Prepend from end, wrapping around
      const prependIndex = (cols - 1 - (i % cols) + cols) % cols;
      prependSlides.unshift(originalSlides[prependIndex]);
    }

    // Clone and append slides at the end
    for (let i = 0; i < appendSlides.length; i += 1) {
      const clone = appendSlides[i].cloneNode(true);
      if (clone) {
        clone.classList.add("swiper-slide-duplicate");
        clone.setAttribute("data-swiper-slide-index", appendSlides[i].getAttribute("data-swiper-slide-index"));
        slidesEl.appendChild(clone);
      }
    }

    // Clone and prepend slides at the beginning
    for (let i = prependSlides.length - 1; i >= 0; i -= 1) {
      const clone = prependSlides[i].cloneNode(true);
      if (clone) {
        clone.classList.add("swiper-slide-duplicate");
        clone.setAttribute("data-swiper-slide-index", prependSlides[i].getAttribute("data-swiper-slide-index"));
        slidesEl.prepend(clone);
      }
    }

    // Recalculate and update Swiper
    swiper.recalcSlides();
    swiper.updateSlides();
  }

  #loopFixDuringDrag() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) return;

    const { slides, params, slidesGrid, snapGrid } = swiper;
    const activeIndex = swiper.activeIndex;
    const currentSlide = slides[activeIndex];

    if (!currentSlide) return;

    // Check if current slide is a duplicate
    const isDuplicate = currentSlide.classList.contains("swiper-slide-duplicate");
    if (!isDuplicate) {
      // Not a duplicate, ensure buttons are enabled
      swiper.allowSlidePrev = true;
      swiper.allowSlideNext = true;
      return;
    }

    // Get the real index from duplicate slide
    const realIndex = parseInt(currentSlide.getAttribute("data-swiper-slide-index"), 10);
    if (Number.isNaN(realIndex)) return;

    // Get original slides (not duplicates)
    const originalSlides = slides.filter((slide) => !slide.classList.contains("swiper-slide-duplicate"));
    const originalCount = originalSlides.length;

    if (originalCount === 0) return;

    // Find the original slide with this realIndex
    const targetOriginalSlide = originalSlides.find(
      (slide) => parseInt(slide.getAttribute("data-swiper-slide-index"), 10) === realIndex
    );

    if (!targetOriginalSlide) return;

    // Find the index of target slide in all slides array (including duplicates)
    const targetIndex = swiper.getSlideIndex(targetOriginalSlide);
    if (targetIndex < 0 || targetIndex === activeIndex) return;

    // For centeredSlides, use snapGrid; otherwise use slidesGrid
    const centeredSlides = params.centeredSlides || false;
    const grid = centeredSlides && snapGrid ? snapGrid : slidesGrid;

    // Calculate diff between current and target translate
    const currentSlideTranslate = grid[activeIndex] || 0;
    const targetSlideTranslate = grid[targetIndex] || 0;
    const diff = targetSlideTranslate - currentSlideTranslate;

    // Update translate during drag (Swiper v8 style with setTranslate: true)
    if (swiper.touchEventsData) {
      swiper.touchEventsData.startTranslate = swiper.touchEventsData.startTranslate - diff;
      swiper.touchEventsData.currentTranslate = swiper.touchEventsData.currentTranslate - diff;
      swiper.setTranslate(swiper.translate - diff);
    }

    // Update active index without animation during drag
    swiper.updateActiveIndex(targetIndex);
    swiper.updateSlidesClasses();

    // Ensure buttons are always enabled during drag
    swiper.allowSlidePrev = true;
    swiper.allowSlideNext = true;
  }

  #loopFix() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) return;

    const { slides, params, slidesGrid, snapGrid } = swiper;
    const activeIndex = swiper.activeIndex;
    const currentSlide = slides[activeIndex];

    if (!currentSlide) return;

    // Check if current slide is a duplicate
    const isDuplicate = currentSlide.classList.contains("swiper-slide-duplicate");
    if (!isDuplicate) {
      // Not a duplicate, ensure buttons are enabled
      swiper.allowSlidePrev = true;
      swiper.allowSlideNext = true;
      return;
    }

    // Get the real index from duplicate slide
    const realIndex = parseInt(currentSlide.getAttribute("data-swiper-slide-index"), 10);
    if (Number.isNaN(realIndex)) return;

    // Get original slides (not duplicates)
    const originalSlides = slides.filter((slide) => !slide.classList.contains("swiper-slide-duplicate"));
    const originalCount = originalSlides.length;

    if (originalCount === 0) return;

    // Find the original slide with this realIndex
    const targetOriginalSlide = originalSlides.find(
      (slide) => parseInt(slide.getAttribute("data-swiper-slide-index"), 10) === realIndex
    );

    if (!targetOriginalSlide) return;

    // Find the index of target slide in all slides array (including duplicates)
    const targetIndex = swiper.getSlideIndex(targetOriginalSlide);
    if (targetIndex < 0 || targetIndex === activeIndex) return;

    // For centeredSlides, use snapGrid; otherwise use slidesGrid
    const centeredSlides = params.centeredSlides || false;
    const grid = centeredSlides && snapGrid ? snapGrid : slidesGrid;

    // Calculate diff between current and target translate (Swiper v8/v11 style)
    const currentSlideTranslate = grid[activeIndex] || 0;
    const targetSlideTranslate = grid[targetIndex] || 0;
    const diff = targetSlideTranslate - currentSlideTranslate;

    // Update touchEventsData if exists (for smooth touch handling)
    if (swiper.touchEventsData) {
      swiper.touchEventsData.startTranslate = swiper.touchEventsData.startTranslate - diff;
      swiper.touchEventsData.currentTranslate = swiper.touchEventsData.currentTranslate - diff;
    }

    // Set transition to 0 before jump for smooth transform (Swiper v8 style)
    swiper.setTransition(0);

    // Jump to original slide using slideTo with speed 0 and internal flag
    // Use requestAnimationFrame to ensure DOM is ready for smooth transform
    requestAnimationFrame(() => {
      if (swiper.destroyed) return;
      swiper.slideTo(targetIndex, 0, false, true);

      // Ensure buttons are enabled after jump
      swiper.allowSlidePrev = true;
      swiper.allowSlideNext = true;

      // Restore transition after jump
      requestAnimationFrame(() => {
        if (swiper.destroyed) return;
        swiper.setTransition(params.speed || 300);
      });
    });
  }
}

if (!customElements.get("icon-boxes-slider")) {
  customElements.define("icon-boxes-slider", IconBoxesSlider);
}
class ScrollProgressBar extends HTMLElement {
  constructor() {
    super();
    this.mediaQuery = null;
    this.resizeObserver = null;
    this.scrollHandler = null;
    this.progressBar = null;
    this.targetPadding = 0;
    this.initialProgress = 0;
    this.mediaQueryHandler = null;
  }

  get totalWidth() {
    return this.target ? this.target.scrollWidth : 0;
  }

  get target() {
    return document.getElementById(this.getAttribute("target"));
  }

  connectedCallback() {
    this.mediaQuery = mediaQueryMobile;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.mediaQuery.matches) {
        this.init();
      }
    });

    this.mediaQueryHandler = (event) => {
      if (event.matches) {
        this.init();
      } else {
        this.disable();
      }
    };

    this.mediaQuery.addEventListener("change", this.mediaQueryHandler);

    if (!this.mediaQuery.matches) {
      this.disable();
      return;
    }

    this.init();
  }

  init() {
    if (!this.target) {
      console.error("Target element not found");
      return;
    }

    this.progressBar = this.querySelector(".progress-bar");
    if (!this.progressBar) {
      console.error("Progress bar element not found");
      return;
    }

    const targetStyle = window.getComputedStyle(this.target);
    this.targetPadding = parseFloat(targetStyle.paddingLeft) + parseFloat(targetStyle.paddingRight);

    this.resizeObserver.observe(this.target);

    const viewportWidth = this.target.clientWidth - this.targetPadding;
    if (this.totalWidth <= viewportWidth) {
      this.disable();
      return;
    }

    this.initialProgress = 0;
    this.calculateInitialProgress();

    this.scrollHandler = () => {
      requestAnimationFrame(() => this.updateProgress());
    };
    this.target.addEventListener("scroll", this.scrollHandler, { passive: true });

    this.style.display = "block";
    this.updateProgress();
  }

  disable() {
    if (this.scrollHandler && this.target) {
      this.target.removeEventListener("scroll", this.scrollHandler);
    }

    this.style.display = "none";

    if (this.progressBar) {
      this.progressBar.style.width = "0%";
    }

    if (this.target) {
      this.resizeObserver.unobserve(this.target);
    }
  }

  disconnectedCallback() {
    if (this.mediaQuery && this.mediaQueryHandler) {
      this.mediaQuery.removeEventListener("change", this.mediaQueryHandler);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.disable();
  }

  calculateInitialProgress() {
    if (!this.target || this.totalWidth === 0) {
      this.initialProgress = 0;
      return;
    }

    const viewportWidth = this.target.clientWidth - this.targetPadding;
    this.initialProgress = (viewportWidth / this.totalWidth) * 100;
    this.updateProgress();
  }

  updateProgress() {
    if (!this.target || !this.progressBar) {
      return;
    }

    const isRTL = document.documentElement.dir === "rtl" || document.body.dir === "rtl";
    const factor = isRTL ? -1 : 1;
    const viewportWidth = this.target.clientWidth - this.targetPadding;
    const scrolled = factor * this.target.scrollLeft;
    const maxScroll = this.totalWidth - viewportWidth;

    if (maxScroll <= 0) {
      return;
    }

    const scrollProgress = (scrolled / maxScroll) * (100 - this.initialProgress);
    const totalProgress = this.initialProgress + scrollProgress;
    const clampedProgress = Math.min(100, Math.max(this.initialProgress, totalProgress));

    this.progressBar.style.width = `${clampedProgress}%`;
  }
}

if (!customElements.get("scroll-progress-bar")) {
  customElements.define("scroll-progress-bar", ScrollProgressBar);
}

class ProgressTimeline extends Component {
  constructor() {
    super();
    this.scrollHandler = null;
    this.rafId = null;
    this.lenis = null;
    this.intersectionObserver = null;
    this.isInViewport = false;
    this._cachedTop = null;
    this._cachedHeight = null;
    this._cachedViewportHeight = window.innerHeight;
  }

  connectedCallback() {
    super.connectedCallback();

    this.#init();
    this.#initParallax();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#destroyParallax();
  }

  #init() {
    const spinningBadge = this.querySelector(".spinning-icon-badge-block");

    if (spinningBadge) {
      const size = spinningBadge.offsetWidth;
      this.style.setProperty("--media-padding-top", `${size / 2}px`);
    }
  }

  #initParallax() {
    const secondaryImage = this.querySelector(".timeline-media__image--secondary");
    if (secondaryImage) {
      // Set initial transform
      secondaryImage.style.transform = "translateY(20%)";
    }

    // Only enable parallax on desktop (similar to TestimonialParallax)
    // if (isMobileBreakpoint()) {
    //   return;
    // }

    this.#setupIntersectionObserver();
    this.#handleParallaxAnimation();
  }

  #setupIntersectionObserver() {
    // Setup IntersectionObserver to only animate when in viewport
    // This significantly reduces performance impact when scrolling past the component
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        this.isInViewport = entries[0].isIntersecting;

        // Trigger initial update when entering viewport
        if (this.isInViewport) {
          requestAnimationFrame(() => {
            this.#runScrollFrameUpdates();
          });
        }
      },
      {
        rootMargin: "100px", // Start animating slightly before entering viewport
      }
    );

    this.intersectionObserver.observe(this);
  }

  #handleParallaxAnimation() {
    // Use Lenis smooth scroll if available, otherwise fallback to native scroll
    this.lenis = getLenis();

    this.scrollHandler = () => {
      if (!this.isInViewport) return;

      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }

      this.rafId = requestAnimationFrame(() => {
        this.#runScrollFrameUpdates();
        this.rafId = null;
      });
    };

    this._resizeHandler = () => {
      this._cachedViewportHeight = window.innerHeight;
      this._cachedTop = null;
    };
    window.addEventListener("resize", this._resizeHandler, { passive: true });

    if (this.lenis) {
      this.lenis.on("scroll", this.scrollHandler);
    } else {
      window.addEventListener("scroll", this.scrollHandler, { passive: true });
    }

    requestAnimationFrame(() => {
      this.#runScrollFrameUpdates();
    });
  }

  #ensureLenisForScroll() {
    if (this.lenis || !this.scrollHandler) return;
    const retryLenis = getLenis();
    if (retryLenis) {
      this.lenis = retryLenis;
      window.removeEventListener("scroll", this.scrollHandler);
      this.lenis.on("scroll", this.scrollHandler);
    }
  }

  #runScrollFrameUpdates() {
    this.#ensureLenisForScroll();
    this.#updateParallax();
    this.#updateTimelineProgress();
  }

  /**
   * Progress runs only after at least half the viewport height of this component
   * is visible (user has effectively brought "half a screen" of the block into view).
   * That gate applies only while the section top is still at/below the viewport top;
   * once the user has scrolled the start of the section past the top edge, a thin
   * strip of remaining content can be shorter than half the screen — do not reset.
   * Reading line at viewport mid-height so progression stays 0%→100% per item
   * (not all 100% at once).
   */
  #updateTimelineProgress() {
    if (!this.isInViewport) return;

    const progressEls = this.querySelectorAll(".timeline-block__progress");
    if (!progressEls.length) return;

    const viewportH = this._cachedViewportHeight;
    const halfScreen = viewportH * 0.5;

    const hostRect = this.getBoundingClientRect();
    const visibleTop = Math.max(hostRect.top, 0);
    const visibleBottom = Math.min(hostRect.bottom, viewportH);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);

    const sectionTopPastViewport = hostRect.top < 0;

    if (visibleHeight <= 0) {
      for (const el of progressEls) {
        el.style.setProperty("--progress", "0%");
      }
      return;
    }

    if (!sectionTopPastViewport && visibleHeight < halfScreen) {
      for (const el of progressEls) {
        el.style.setProperty("--progress", "0%");
      }
      return;
    }

    const refY = halfScreen;

    for (const el of progressEls) {
      const block = el.closest(".timeline-block");
      if (!block || !block.nextElementSibling) {
        continue;
      }

      const rect = block.getBoundingClientRect();
      const h = rect.height;
      if (h <= 0) continue;

      let t;
      if (refY <= rect.top) {
        t = 0;
      } else if (refY >= rect.bottom) {
        t = 1;
      } else {
        t = (refY - rect.top) / h;
      }

      const pct = Math.round(t * 1000) / 10;
      el.style.setProperty("--progress", `${pct}%`);
    }
  }

  #updateParallax() {
    const secondaryImage = this.querySelector(".timeline-media__image--secondary");
    if (!secondaryImage) return;

    // Skip animations if not in viewport (performance optimization)
    if (!this.isInViewport) return;

    // Try to get Lenis again if not available (in case it loaded after init)
    if (!this.lenis) {
      const retryLenis = getLenis();
      if (retryLenis) {
        this.lenis = retryLenis;
        window.removeEventListener("scroll", this.scrollHandler);
        this.lenis.on("scroll", this.scrollHandler);
      }
    }

    const scrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;
    const viewportHeight = this._cachedViewportHeight;

    if (this._cachedTop === null) {
      const componentRect = this.getBoundingClientRect();
      this._cachedTop = componentRect.top + scrollTop;
      this._cachedHeight = componentRect.height;
    }

    const componentTop = this._cachedTop;
    const componentBottom = componentTop + this._cachedHeight;
    const startPoint = componentTop - viewportHeight;
    const endPoint = componentBottom;
    const scrollRange = endPoint - startPoint;

    if (scrollRange <= 0) {
      if (secondaryImage._lastTransform !== "translateY(20%)") {
        secondaryImage._lastTransform = "translateY(20%)";
        secondaryImage.style.transform = "translateY(20%)";
      }
      return;
    }

    const progress = Math.max(0, Math.min(1, (scrollTop - startPoint) / scrollRange));

    const beginY = 20;
    const endY = -20;
    const rounded = Math.round((beginY + (endY - beginY) * progress) * 10) / 10;

    if (secondaryImage._lastY !== rounded) {
      secondaryImage._lastY = rounded;
      secondaryImage.style.transform = `translateY(${rounded}%)`;
    }
  }

  #destroyParallax() {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    if (this._resizeHandler) {
      window.removeEventListener("resize", this._resizeHandler);
      this._resizeHandler = null;
    }

    if (this.scrollHandler) {
      if (this.lenis) {
        this.lenis.off("scroll", this.scrollHandler);
      } else {
        window.removeEventListener("scroll", this.scrollHandler);
      }
      this.scrollHandler = null;
    }

    // Cancel pending RAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Reset transform on mobile
    const secondaryImage = this.querySelector(".timeline-media__image--secondary");
    if (secondaryImage && isMobileBreakpoint()) {
      secondaryImage.style.transform = "";
    }
  }
}

if (!customElements.get("progress-timeline")) {
  customElements.define("progress-timeline", ProgressTimeline);
}

class ProductRecentlyViewed extends HTMLElement {
  constructor() {
    super();

    if (hasLocalStorage()) {
      this.#addToRecentlyViewed();
    }
  }

  #addToRecentlyViewed() {
    if (!this.dataset.productId) {
      return;
    }

    const productId = parseInt(this.dataset.productId);
    const items = getLocalStorage(CookieManager.PRODUCT_RECENTLY_VIEWED) || [];

    if (items.includes(productId)) {
      items.splice(items.indexOf(productId), 1);
    }

    items.unshift(productId);

    setLocalStorage(CookieManager.PRODUCT_RECENTLY_VIEWED, items.slice(0, 20));
  }
}

if (!customElements.get("product-recently-viewed")) {
  customElements.define("product-recently-viewed", ProductRecentlyViewed);
}

class BackToTop extends Component {
  #lenis = null;

  constructor() {
    super();

    this.toggleVisibilityHandler = this.#toggleVisibility.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();

    this.#lenis = getLenis();

    if (this.#lenis) {
      this.#lenis.on("scroll", this.toggleVisibilityHandler);
    } else {
      window.addEventListener("scroll", this.toggleVisibilityHandler, { passive: true });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this.#lenis) {
      this.#lenis.off("scroll", this.toggleVisibilityHandler);
    } else {
      window.removeEventListener("scroll", this.toggleVisibilityHandler);
    }
  }

  backToTop(event) {
    event?.preventDefault();

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  #toggleVisibility() {
    const scrollY = this.#lenis ? this.#lenis.scroll : window.scrollY;
    const shouldVisible = scrollY > 400;

    if (this._wasVisible !== shouldVisible) {
      this._wasVisible = shouldVisible;
      this.classList.toggle("show", shouldVisible);
    }
  }
}

customElements.define("back-to-top", BackToTop);

class CounterComponent extends Component {
  requiredRefs = ["numberDisplay", "numberPlaceholder"];

  #inViewStop = null;
  #endVal = 0;
  #thousandsSep = ",";
  #decimalSep = ".";
  #decimalPlaces = 0;
  #durationMs = 2000;
  #rAF = null;
  #startTime = null;

  /** easeOutExpo: t, b, c, d */
  static #easeOutExpo(t, b, c, d) {
    return (c * (-Math.pow(2, (-10 * t) / d) + 1) * 1024) / 1023 + b;
  }

  connectedCallback() {
    super.connectedCallback();

    const endVal = parseFloat(this.dataset.target, 10);
    if (Number.isNaN(endVal) || endVal < 0) return;

    this.#endVal = endVal;
    this.#thousandsSep = this.dataset.thousandsSep ?? ",";
    this.#decimalSep = this.dataset.decimalSep ?? ".";
    this.#decimalPlaces = endVal % 1 !== 0 ? 2 : 0;

    this.#init();
    mediaQueryMobile.addEventListener("change", this.#init.bind(this));

    this.#inViewStop = inView(this, () => this.#start(), { margin: "0px", amount: 0.1 });
  }

  disconnectedCallback() {
    this.#inViewStop?.();
    this.#inViewStop = null;
    if (this.#rAF != null) cancelAnimationFrame(this.#rAF);
    this.#rAF = null;
    super.disconnectedCallback();
  }

  #init() {
    const { numberPlaceholder } = this.refs;

    requestAnimationFrame(() => {
      numberPlaceholder.textContent = this.#formatValue(this.#endVal);
      this.style.minWidth = `${this.offsetWidth}px`;
    });
  }

  #formatValue(val) {
    const neg = val < 0 ? "-" : "";
    const fixed = Math.abs(val).toFixed(this.#decimalPlaces);
    const parts = fixed.split(".");
    let intPart = parts[0];
    const decPart = parts.length > 1 ? this.#decimalSep + parts[1] : "";
    if (this.#thousandsSep !== "") {
      intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, this.#thousandsSep);
    }
    return neg + intPart + decPart;
  }

  #printValue(val) {
    const { numberDisplay } = this.refs;
    numberDisplay.textContent = this.#formatValue(val);
  }

  #count(timestamp) {
    if (!this.#startTime) this.#startTime = timestamp;
    const progress = timestamp - this.#startTime;
    const frameVal = CounterComponent.#easeOutExpo(progress, 0, this.#endVal, this.#durationMs);
    const clamped = Math.min(frameVal, this.#endVal);
    const rounded = Number(clamped.toFixed(this.#decimalPlaces));
    this.#printValue(rounded);

    if (progress < this.#durationMs) {
      this.#rAF = requestAnimationFrame(this.#count.bind(this));
    } else {
      this.#printValue(this.#endVal);
      this.#rAF = null;
    }
  }

  #start() {
    if (prefersReducedMotion()) {
      this.#printValue(this.#endVal);
      return;
    }
    this.#startTime = null;
    this.#rAF = requestAnimationFrame(this.#count.bind(this));
  }
}
customElements.define("counter-component", CounterComponent);

class ParallaxComponent extends HTMLElement {
  #parallax = false;
  #parallaxDirection = "vertical";
  #parallaxMediaElements = [];
  #scrollStop = null;

  connectedCallback() {
    this.#parallax = this.dataset.parallax ? parseFloat(this.dataset.parallax) : false;
    this.#parallaxDirection = this.dataset.parallaxDirection || "vertical";
    this.#parallaxMediaElements = Array.from(this.querySelectorAll("img, video, iframe, svg, deferred-media"));
    this.#init();
  }

  disconnectedCallback() {
    this.#scrollStop?.();
    this.#scrollStop = null;
  }

  #init() {
    const reducedMotion = prefersReducedMotion();
    if (reducedMotion || !this.#parallax) return;

    const { scale: parallaxScale, translate: parallaxTranslate } = this.#getParallaxValues(
      this.#parallax,
      this.#parallaxDirection
    );

    let parallaxTransformProperties = {};

    if (this.#parallaxDirection === "vertical") {
      parallaxTransformProperties = {
        transform: [
          `scale(${parallaxScale}) translateY(0)`,
          `scale(${parallaxScale}) translateY(${parallaxTranslate}%)`,
        ],
        transformOrigin: ["bottom", "bottom"],
      };
    } else if (this.#parallaxDirection === "horizontal") {
      parallaxTransformProperties = {
        transform: [
          `scale(${parallaxScale}) translateX(0)`,
          `scale(${parallaxScale}) translateX(${parallaxTranslate}%)`,
        ],
        transformOrigin: ["right", "right"],
      };
    } else {
      parallaxTransformProperties = {
        transform: [`scale(1)`, `scale(${parallaxScale})`],
        transformOrigin: ["center", "center"],
      };
    }

    this.#scrollStop = scroll(animate(this.#parallaxMediaElements, parallaxTransformProperties, { easing: "linear" }), {
      target: this,
      offset: ["start end", "end start"],
    });
  }

  #getParallaxValues(intensity, direction) {
    if (direction === "zoom") {
      const MAX_ZOOM = 0.35;
      return { scale: 1 + intensity * MAX_ZOOM, translate: 0 };
    }

    const MAX_TRAVEL = direction === "horizontal" ? 30 : 45;
    const translate = intensity * MAX_TRAVEL;
    const scale = 1 + (translate / 100) * (direction === "horizontal" ? 1.5 : 1.35);

    return { scale, translate };
  }
}
customElements.define("parallax-component", ParallaxComponent);
