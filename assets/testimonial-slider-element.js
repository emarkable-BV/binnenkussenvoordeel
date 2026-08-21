import { Component } from "@theme/component";
import { createSlider } from "@theme/testimonial-slider";

export class TestimonialSliderComponent extends Component {
  /** @type {any} */
  sliderInstance = null;

  /** @type {Function|null} */
  #shopifyBlockSelectHandler = null;

  /** @type {Function|null} */
  #shopifySectionLoadHandler = null;

  /**
   * Enforce required refs for slider elements.
   * @type {string[]}
   */
  requiredRefs = ["container", "track"];

  static get observedAttributes() {
    return ["data-options"];
  }

  get sectionId() {
    return this.getAttribute("data-section-id");
  }

  connectedCallback() {
    super.connectedCallback();
    this.#createSlider();

    // Setup Shopify design mode event listeners
    if (Shopify.designMode) {
      // Handle block selection
      this.#shopifyBlockSelectHandler = (e) => {
        if (e.detail.sectionId != this.sectionId) return;
        const slide = e.target.closest(".testimonial-slider__slide");
        if (!slide) return;

        const index = Array.from(slide.parentElement?.children ?? []).indexOf(slide);
        if (this.sliderInstance?.activate) {
          this.sliderInstance.activate(index);
        }
      };
      document.addEventListener("shopify:block:select", this.#shopifyBlockSelectHandler);

      // Handle section load/unload (re-render)
      this.#shopifySectionLoadHandler = (e) => {
        if (e.detail.sectionId != this.sectionId) return;
        // Section was re-rendered, re-initialize slider
        this.#destroySlider();
        // Small delay to ensure DOM is ready
        setTimeout(() => {
          this.#createSlider();
        }, 50);
      };
      document.addEventListener("shopify:section:load", this.#shopifySectionLoadHandler);
    }
  }

  disconnectedCallback() {
    // Remove Shopify event listeners
    if (this.#shopifyBlockSelectHandler) {
      document.removeEventListener("shopify:block:select", this.#shopifyBlockSelectHandler);
      this.#shopifyBlockSelectHandler = null;
    }
    if (this.#shopifySectionLoadHandler) {
      document.removeEventListener("shopify:section:load", this.#shopifySectionLoadHandler);
      this.#shopifySectionLoadHandler = null;
    }

    this.#destroySlider();
    super.disconnectedCallback();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "data-options" && oldValue !== newValue) {
      this.#destroySlider();
      this.#createSlider();
    }
  }

  /**
   * Generate unique ID
   */
  #generateId(prefix) {
    return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Parse options from data-options attribute
   */
  #parseOptions() {
    const dataOptions = this.getAttribute("data-options");
    if (!dataOptions) return {};

    try {
      return JSON.parse(dataOptions);
    } catch (e) {
      console.warn("Invalid JSON in data-options:", dataOptions);
      return {};
    }
  }

  /**
   * Create slider instance
   */
  #createSlider() {
    const container = this.refs.container;
    const track = this.refs.track;

    if (!container || !track) return;

    // Generate unique IDs if not present
    if (!this.id) this.id = this.#generateId("slider");
    if (!container.id) container.id = this.#generateId("slider-container");
    if (!track.id) track.id = this.#generateId("slides-track");

    const options = this.#parseOptions();

    // Create slider instance
    this.sliderInstance = createSlider({
      elId: this.id,
      containerId: container.id,
      trackId: track.id,
      slidesSelector: ".testimonial-slider__slide",
      thumbnailsId: this.refs.thumbnails?.id,
      paginationId: this.refs.pagination?.id,
      prevBtnId: this.refs.prev?.id,
      nextBtnId: this.refs.next?.id,
      counterId: this.refs.counter?.id,
      ...options,
    });
  }

  /**
   * Destroy slider instance
   */
  #destroySlider() {
    if (this.sliderInstance) {
      this.sliderInstance.destroy();
      this.sliderInstance = null;
    }
  }
}

// Register custom element
if (!customElements.get("testimonial-slider")) {
  customElements.define("testimonial-slider", TestimonialSliderComponent);
}
