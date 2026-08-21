import { requestIdleCallback } from "@theme/utilities";
/*
 * Declarative shadow DOM is only initialized on the initial render of the page.
 * If the component is mounted after the browser finishes the initial render,
 * the shadow root needs to be manually hydrated.
 */
export class DeclarativeShadowElement extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) {
      const template = this.querySelector(':scope > template[shadowrootmode="open"]');

      if (!(template instanceof HTMLTemplateElement)) return;

      const shadow = this.attachShadow({ mode: "open" });
      shadow.append(template.content.cloneNode(true));
    }
  }
}

/**
 * A custom ResizeObserver that only calls the callback when the element is resized.
 * By default the ResizeObserver callback is called when the element is first observed.
 */
export class ResizeNotifier extends ResizeObserver {
  #initialized = false;

  /**
   * @param {ResizeObserverCallback} callback
   */
  constructor(callback) {
    super((entries) => {
      if (this.#initialized) return callback(entries, this);
      this.#initialized = true;
    });
  }

  disconnect() {
    this.#initialized = false;
    super.disconnect();
  }
}

(() => {
  function setScrollbarWidth() {
    requestIdleCallback(() => {
      // Create temporary div to measure scrollbar width
      const outer = document.createElement("div");
      outer.style.cssText = "visibility:hidden;overflow:scroll;position:absolute;width:100px;height:100px;";
      document.body.appendChild(outer);

      const inner = document.createElement("div");
      inner.style.width = "100%";
      outer.appendChild(inner);

      // Batch layout reads
      const scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
      const windowWidth = window.innerWidth;
      const documentWidth = document.documentElement.clientWidth;

      // Clean up
      document.body.removeChild(outer);

      // Calculate final width with fallback for mobile
      const finalWidth = scrollbarWidth > 0 ? scrollbarWidth : Math.max(0, windowWidth - documentWidth);

      // Batch style writes
      document.documentElement.style.setProperty("--scrollbar-width", `${finalWidth}px`);
      // document.documentElement.style.setProperty("--has-scrollbar", finalWidth > 0 ? "1" : "0");
    });
  }

  // Defer until page is fully loaded to avoid blocking render
  if (document.readyState === "complete") {
    setScrollbarWidth();
  } else {
    window.addEventListener("load", setScrollbarWidth, { once: true });
  }

  // Recalculate on resize/orientation change
  let resizeTimeout;
  const debouncedSetScrollbarWidth = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(setScrollbarWidth, 100);
  };

  window.addEventListener("resize", debouncedSetScrollbarWidth);
  window.addEventListener("orientationchange", debouncedSetScrollbarWidth);
})();
