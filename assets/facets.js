import { sectionRenderer } from "@theme/section-renderer";
import { debounce, formatMoney, onAnimationEnd } from "@theme/utilities";
import { FilterUpdateEvent, ThemeEvents } from "@theme/events";
import { Component } from "@theme/component";

const SEARCH_QUERY = "q";

/**
 * Handles the main facets form functionality
 *
 * @typedef {Object} FacetsFormRefs
 * @property {HTMLFormElement} facetsForm - The main facets form element
 * @property {HTMLElement | undefined} facetStatus - The facet status element
 *
 * @extends {Component<FacetsFormRefs>}
 */
class FacetsFormComponent extends Component {
  requiredRefs = ["facetsForm"];

  static #notifyCollectionRerendered = debounce(() => {
    document.dispatchEvent(new CustomEvent(ThemeEvents.collectionRerendered));
  }, 50);

  connectedCallback() {
    super.connectedCallback();
    this.#restoreExpandedState();
  }

  #restoreExpandedState() {
    if (!this.#hasActiveFilterInputs()) return;

    this.#expandActiveAccordions();
  }

  #hasActiveFilterInputs(container = this) {
    return [...container.querySelectorAll('input[name^="filter."], input[name="sort_by"]')].some((input) => {
      switch (input.type) {
        case "checkbox":
        case "radio":
          return input.checked;

        case "text":
        case "number":
        case "search":
          return input.value.trim() !== "";

        default:
          return false;
      }
    });
  }

  #expandActiveAccordions() {
    this.querySelectorAll("accordion-component").forEach((accordion) => {
      const activeAccordion = this.#hasActiveFilterInputs(accordion);
      const showMoreComponent = accordion.querySelector("show-more-component");

      if (activeAccordion) {
        const { item: items, summary: summaries, content: contents } = accordion.refs;

        let item = Array.isArray(items) ? items[0] : items;
        let summary = Array.isArray(summaries) ? summaries[0] : summaries;
        let content = Array.isArray(contents) ? contents[0] : contents;

        if (item && summary && content && !item.open) {
          accordion.toggleOpen({
            willOpen: true,
            item,
            summary,
            content,
          });
        }

        showMoreComponent?.toggleOpen({ willOpen: true });
      }
    });
  }

  /**
   * Creates URL parameters from form data
   * @param {FormData} [formData] - Optional form data to use instead of the main form
   * @returns {URLSearchParams} The processed URL parameters
   */
  createURLParameters(formData = new FormData(this.refs.facetsForm)) {
    let newParameters = new URLSearchParams(/** @type any */ (formData));

    if (newParameters.get("filter.v.price.gte") === "") newParameters.delete("filter.v.price.gte");
    if (newParameters.get("filter.v.price.lte") === "") newParameters.delete("filter.v.price.lte");

    newParameters.delete("page");

    const searchQuery = this.#getSearchQuery();
    if (searchQuery) newParameters.set(SEARCH_QUERY, searchQuery);

    return newParameters;
  }

  /**
   * Gets the search query parameter from the current URL
   * @returns {string} The search query
   */
  #getSearchQuery() {
    const url = new URL(window.location.href);
    return url.searchParams.get(SEARCH_QUERY) ?? "";
  }

  get sectionId() {
    const id = this.getAttribute("section-id");
    if (!id) throw new Error("Section ID is required");
    return id;
  }

  /**
   * Updates the URL hash with current filter parameters
   */
  #updateURLHash() {
    const url = new URL(window.location.href);
    const urlParameters = this.createURLParameters();

    url.search = "";
    for (const [param, value] of urlParameters.entries()) {
      url.searchParams.append(param, value);
    }

    history.pushState({ urlParameters: urlParameters.toString() }, "", url.toString());
  }

  /**
   * Updates filters and renders the section
   */
  updateFilters = () => {
    this.#updateURLHash();
    this.dispatchEvent(new FilterUpdateEvent(this.createURLParameters()));
    this.#updateSection();
  };

  /**
   * Updates the section
   */
  async #updateSection() {
    await sectionRenderer.renderSection(this.sectionId);

    FacetsFormComponent.#notifyCollectionRerendered();

    // Scroll to top after section is updated
    this.#scrollToTop();
  }

  /**
   * Updates filters based on a provided URL
   * @param {string} url - The URL to update filters with
   */
  async updateFiltersByURL(url) {
    history.pushState("", "", url);
    this.dispatchEvent(new FilterUpdateEvent(this.createURLParameters()));
    await this.#updateSection();
  }

  /**
   * Scrolls to the top of the relevant content area with header offset
   */
  #scrollToTop() {
    // Cache header height to avoid repeated getComputedStyle calls
    if (!this.#cachedHeaderHeight) {
      this.#cachedHeaderHeight =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 0;
    }

    // Use more specific selector to reduce DOM queries
    const targetElement = document.querySelector(".main-collection") || document.body;

    if (targetElement) {
      // Calculate target position with header offset
      const targetRect = targetElement.getBoundingClientRect();
      const targetTop = window.scrollY + targetRect.top - this.#cachedHeaderHeight;

      // Smooth scroll to position with header offset
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
      });
    }
  }

  /**
   * Cached header height to avoid repeated CSS variable lookups
   * @type {number}
   */
  #cachedHeaderHeight = null;
}

if (!customElements.get("facets-form-component")) {
  customElements.define("facets-form-component", FacetsFormComponent);
}

/**
 * @typedef {Object} FacetInputsRefs
 * @property {HTMLInputElement[]} facetInputs - The facet input elements
 */

/**
 * Handles individual facet input functionality
 * @extends {Component<FacetInputsRefs>}
 */
class FacetInputsComponent extends Component {
  get sectionId() {
    const id = this.closest(".shopify-section")?.id;
    if (!id) throw new Error("FacetInputs component must be a child of a section");
    return id;
  }

  /**
   * Updates filters and the selected facet summary
   */
  updateFilters() {
    const facetsForm = this.closest("facets-form-component");

    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
    // this.#updateSelectedFacetSummary();
  }

  /**
   * Handles keydown events for the facets form
   * @param {KeyboardEvent} event - The keydown event
   */
  handleKeyDown(event) {
    if (!(event.target instanceof HTMLElement)) return;
    const closestInput = event.target.querySelector("input");

    if (!(closestInput instanceof HTMLInputElement)) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      closestInput.checked = !closestInput.checked;
      this.updateFilters();
    }
  }

  /**
   * Handles mouseover events on facet labels
   * @param {MouseEvent} event - The mouseover event
   */
  prefetchPage = debounce((event) => {
    if (!(event.target instanceof HTMLElement)) return;

    const form = this.closest("form");
    if (!form) return;

    const formData = new FormData(form);
    const inputElement = event.target.querySelector("input");

    if (!(inputElement instanceof HTMLInputElement)) return;

    if (!inputElement.checked) formData.append(inputElement.name, inputElement.value);

    const facetsForm = this.closest("facets-form-component");
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    const urlParameters = facetsForm.createURLParameters(formData);

    const url = new URL(window.location.pathname, window.location.origin);

    for (const [key, value] of urlParameters) url.searchParams.append(key, value);

    if (inputElement.checked) url.searchParams.delete(inputElement.name, inputElement.value);

    sectionRenderer.getSectionHTML(this.sectionId, true, url);
  }, 200);

  cancelPrefetchPage = () => this.prefetchPage.cancel();

  /**
   * Updates the selected facet summary
   */
  #updateSelectedFacetSummary() {
    if (!this.refs.facetInputs) return;

    const checkedInputElements = this.refs.facetInputs.filter((input) => input.checked);
    const details = this.closest("details");
    const statusComponent = details?.querySelector("facet-status-component");

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent.updateListSummary(checkedInputElements);
  }
}

if (!customElements.get("facet-inputs-component")) {
  customElements.define("facet-inputs-component", FacetInputsComponent);
}

/**
 * Handles price facet functionality
 * @extends {Component<PriceFacetRefs>}
 */
class PriceFacetComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("keydown", this.#onKeyDown);
    this.#initializeRangeInputs();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this.#onKeyDown);
    this.#cleanupRangeInputs();
  }

  /**
   * Handles keydown events to restrict input to valid characters
   * @param {KeyboardEvent} event - The keydown event
   */
  #onKeyDown = (event) => {
    if (event.metaKey) return;

    const pattern = /[0-9]|\.|,|'| |Tab|Backspace|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Delete|Escape/;
    if (!event.key.match(pattern)) event.preventDefault();
  };

  /**
   * Updates price filter and results
   */
  updatePriceFilterAndResults() {
    const { minInput, maxInput } = this.refs;

    this.#adjustToValidValues(minInput);
    this.#adjustToValidValues(maxInput);

    const facetsForm = this.closest("facets-form-component");
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
    this.#setMinAndMaxValues();
    // this.#updateSummary();
  }

  /**
   * Adjusts input values to be within valid range
   * @param {HTMLInputElement} input - The input element to adjust
   */
  #adjustToValidValues(input) {
    if (input.value.trim() === "") return;

    const value = Number(input.value);
    const min = Number(formatMoney(input.getAttribute("data-min") ?? ""));
    const max = Number(formatMoney(input.getAttribute("data-max") ?? ""));

    if (value < min) input.value = min.toString();
    if (value > max) input.value = max.toString();
  }

  /**
   * Sets min and max values for the inputs
   */
  #setMinAndMaxValues() {
    const { minInput, maxInput } = this.refs;

    if (maxInput.value) minInput.setAttribute("data-max", maxInput.value);
    if (minInput.value) maxInput.setAttribute("data-min", minInput.value);
    if (minInput.value === "") maxInput.setAttribute("data-min", "0");
    if (maxInput.value === "") minInput.setAttribute("data-max", maxInput.getAttribute("data-max") ?? "");
  }

  /**
   * Updates the price summary
   */
  #updateSummary() {
    const { minInput, maxInput } = this.refs;
    const details = this.closest("details");
    const statusComponent = details?.querySelector("facet-status-component");

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent?.updatePriceSummary(minInput, maxInput);
  }

  /**
   * Initialize range inputs functionality
   */
  #initializeRangeInputs() {
    const { rangeMin, rangeMax, minInput, maxInput } = this.refs;
    if (!rangeMin || !rangeMax) return;

    // Bind range input events
    rangeMin.addEventListener("input", this.#onRangeMinInput);
    rangeMax.addEventListener("input", this.#onRangeMaxInput);
    rangeMin.addEventListener("change", this.#onRangeMinChange);
    rangeMax.addEventListener("change", this.#onRangeMaxChange);

    // Text input change events
    minInput.addEventListener("change", this.#onMinInputChange);
    maxInput.addEventListener("change", this.#onMaxInputChange);

    // Initialize visual range
    this.#updateRangeVisual();
  }

  /**
   * Cleanup range inputs events
   */
  #cleanupRangeInputs() {
    const { rangeMin, rangeMax, minInput, maxInput } = this.refs;

    if (rangeMin) {
      rangeMin.removeEventListener("input", this.#onRangeMinInput);
      rangeMin.removeEventListener("change", this.#onRangeMinChange);
    }
    if (rangeMax) {
      rangeMax.removeEventListener("input", this.#onRangeMaxInput);
      rangeMax.removeEventListener("change", this.#onRangeMaxChange);
    }
    if (minInput) minInput.removeEventListener("change", this.#onMinInputChange);
    if (maxInput) maxInput.removeEventListener("change", this.#onMaxInputChange);
  }

  /**
   * Handle min range input (while dragging)
   */
  #onRangeMinInput = (event) => {
    const { rangeMax, minInput } = this.refs;
    const value = parseInt(event.target.value);
    const maxValue = parseInt(rangeMax.value);

    // Ensure min doesn't exceed max
    if (value >= maxValue) {
      event.target.value = maxValue - 1;
    }

    // Update text input with formatted money
    minInput.value = this.#centsToMoney(parseInt(event.target.value));

    // Update visual
    this.#updateRangeVisual();
  };

  /**
   * Handle max range input (while dragging)
   */
  #onRangeMaxInput = (event) => {
    const { rangeMin, maxInput } = this.refs;
    const value = parseInt(event.target.value);
    const minValue = parseInt(rangeMin.value);

    // Ensure max doesn't go below min
    if (value <= minValue) {
      event.target.value = minValue + 1;
    }

    // Update text input with formatted money
    maxInput.value = this.#centsToMoney(parseInt(event.target.value));

    // Update visual
    this.#updateRangeVisual();
  };

  /**
   * Handle min range change (when drag ends)
   */
  #onRangeMinChange = () => {
    // Trigger filter update when user stops dragging
    this.updatePriceFilterAndResults();
  };

  /**
   * Handle max range change (when drag ends)
   */
  #onRangeMaxChange = () => {
    // Trigger filter update when user stops dragging
    this.updatePriceFilterAndResults();
  };

  /**
   * Convert cents to money format (divide by 100)
   * Returns string formatted to match locale (e.g., "2.629,95" for European)
   */
  #centsToMoney(cents) {
    const value = cents / 100;
    // Format with European style: dot for thousands, comma for decimals
    return value.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Convert money string to cents (multiply by 100)
   * Uses formatMoney utility to handle different number formats (commas, dots, spaces)
   */
  #moneyToCents(money) {
    // formatMoney handles: "2,629.95", "2.629,95", "2 629.95" → "2629.95"
    const cleanNumber = formatMoney(String(money));
    return Math.round(parseFloat(cleanNumber) * 100);
  }

  /**
   * Handle min input change
   */
  #onMinInputChange = (event) => {
    const { rangeMin, maxInput } = this.refs;
    // Convert money input to cents
    const valueInCents = this.#moneyToCents(event.target.value) || 0;
    const maxInCents = this.#moneyToCents(maxInput.value) || parseInt(rangeMin.max);
    const minRange = parseInt(rangeMin.min) || 0;

    const constrainedValue = Math.max(minRange, Math.min(valueInCents, maxInCents - 1));

    // Update text input with formatted money
    event.target.value = this.#centsToMoney(constrainedValue);
    // Update range input with cents
    rangeMin.value = constrainedValue;
    this.#updateRangeVisual();
  };

  /**
   * Handle max input change
   */
  #onMaxInputChange = (event) => {
    const { rangeMax, minInput } = this.refs;
    // Convert money input to cents
    const valueInCents = this.#moneyToCents(event.target.value) || parseInt(rangeMax.max);
    const minInCents = this.#moneyToCents(minInput.value) || 0;
    const maxRange = parseInt(rangeMax.max);

    const constrainedValue = Math.min(maxRange, Math.max(valueInCents, minInCents + 1));

    // Update text input with formatted money
    event.target.value = this.#centsToMoney(constrainedValue);
    // Update range input with cents
    rangeMax.value = constrainedValue;
    this.#updateRangeVisual();
  };

  /**
   * Update range visual CSS custom properties
   */
  #updateRangeVisual() {
    const { rangeMin, rangeMax } = this.refs;
    if (!rangeMin || !rangeMax) return;

    const rangeInputs = this.querySelector(".price-facet__range-inputs");
    if (!rangeInputs) return;

    const minValue = parseInt(rangeMin.value);
    const maxValue = parseInt(rangeMax.value);
    const maxRange = parseInt(rangeMax.max);

    const minPercent = (minValue / maxRange) * 100;
    const maxPercent = (maxValue / maxRange) * 100;

    rangeInputs.style.setProperty("--range-min", `${minPercent}%`);
    rangeInputs.style.setProperty("--range-max", `${maxPercent}%`);

    const intersectThresholdPercent = this.dataset.intersectThresholdPercent;
    const intersectThreshold = (maxRange * intersectThresholdPercent) / 100;
    const isIntersecting = minValue + intersectThreshold >= maxRange;

    if (isIntersecting) {
      this.style.setProperty("--range-min-z-index", "2");
    } else {
      this.style.removeProperty("--range-min-z-index");
    }
  }
}

if (!customElements.get("price-facet-component")) {
  customElements.define("price-facet-component", PriceFacetComponent);
}

/**
 * Handles sorting filter functionality
 *
 * @typedef {Object} SortingFilterRefs
 * @property {HTMLDetailsElement} details - The details element
 * @property {HTMLElement} summary - The summary element
 * @property {HTMLElement} listbox - The listbox element
 *
 * @extends {Component}
 */
class SortingFilterComponent extends Component {
  connectedCallback() {
    super.connectedCallback();

    // Add event listeners for both select and radio inputs
    const select = this.querySelector(".sorting-filter__select");
    const radioInputs = this.querySelectorAll(".sorting-filter__radio");

    if (select) {
      select.addEventListener("change", this.updateFilterAndSorting);
    }

    radioInputs.forEach((radio) => {
      radio.addEventListener("change", this.updateFilterAndSorting);
    });
  }

  /**
   * Updates filter and sorting
   * @param {Event} event - The change event
   */
  updateFilterAndSorting = (event) => {
    const facetsForm =
      this.closest("facets-form-component") || this.closest(".shopify-section")?.querySelector("facets-form-component");

    if (!(facetsForm instanceof FacetsFormComponent)) return;
    facetsForm.updateFilters();
    // this.updateFacetStatus(event);
  };

  /**
   * Updates the facet status
   * @param {Event} event - The change event
   */
  updateFacetStatus(event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;

    const details = this.querySelector("details");
    if (!details) return;

    const facetStatus = details.querySelector("facet-status-component");
    if (!(facetStatus instanceof FacetStatusComponent)) return;

    const value = target.value;
    const defaultSortBy = details.dataset.defaultSortBy;
    const optionName =
      target.dataset.optionName ||
      (target instanceof HTMLSelectElement
        ? target.options[target.selectedIndex]?.text
        : target.closest(".sorting-filter__option")?.querySelector(".facets__checkbox-text")?.textContent);

    facetStatus.textContent = value !== defaultSortBy ? (optionName ?? "") : "";
  }
}

if (!customElements.get("sorting-filter-component")) {
  customElements.define("sorting-filter-component", SortingFilterComponent);
}

/**
 * @typedef {Object} FacetRemoveComponentRefs
 * @property {HTMLInputElement | undefined} clearButton - The button to clear filters
 */

/**
 * Handles removal of individual facet filters
 * @extends {Component<FacetRemoveComponentRefs>}
 */
class FacetRemoveComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  /**
   * Removes the filter
   * @param {Object} data - The data object
   * @param {string} data.form - The form to remove the filter from
   * @param {Event} event - The click event
   */
  removeFilter({ form }, event) {
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
    }

    const url = this.dataset.url;
    if (!url) return;

    let facetsForm;
    if (form) {
      facetsForm = document.getElementById(form);
    } else {
      // First try to find facets-form-component in parent elements
      facetsForm = this.closest("facets-form-component");

      // If not found, search in the entire document
      if (!facetsForm) {
        facetsForm = document.querySelector("facets-form-component");
      }
    }

    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFiltersByURL(url);
  }

  /**
   * Toggle clear button visibility when filters are applied. Happens before the
   * Section Rendering Request resolves.
   *
   * @param {FilterUpdateEvent} event
   */
  #handleFilterUpdate = (event) => {
    const { clearButton } = this.refs;
    if (clearButton instanceof Element) {
      clearButton.classList.toggle("active", event.shouldShowClearAll());
    }
  };
}

if (!customElements.get("facet-remove-component")) {
  customElements.define("facet-remove-component", FacetRemoveComponent);
}
