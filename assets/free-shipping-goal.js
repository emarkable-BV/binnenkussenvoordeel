import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";
import { formatCurrency } from "@theme/utilities";

/**
 * Progress Bar Component
 *
 * Reusable progress bar component that can be used anywhere
 * Later can be moved to separate file
 */
class ProgressBar extends Component {
  static get observedAttributes() {
    return ["percent", "label"];
  }

  #isReady = false;

  connectedCallback() {
    super.connectedCallback();
    this.#updateDisplay();
    this.#isReady = true;

    // Dispatch ready event
    this.dispatchEvent(
      new CustomEvent("progress-bar-ready", {
        bubbles: true,
        detail: { element: this },
      })
    );
  }

  attributeChangedCallback() {
    if (this.#isReady) {
      this.#updateDisplay();
    }
  }

  /**
   * Update progress bar display
   */
  #updateDisplay() {
    const percent = this.getAttribute("percent") || "0";
    const label = this.getAttribute("label") || "";

    // Update progress fill
    const fill = this.querySelector(".progress-bar__fill");
    if (fill) {
      const percentValue = Math.min(Math.max(parseFloat(percent), 0), 100);
      fill.style.setProperty("--percent", `${percentValue}%`);
    }

    // Update label if present
    const labelElement = this.querySelector(".progress-bar__label");
    if (labelElement && label) {
      labelElement.textContent = label;
    }
  }

  /**
   * Update progress programmatically
   * @param {number|string} percent - Progress percentage
   * @param {string} label - Optional label
   */
  update(percent, label = "") {
    this.setAttribute("percent", percent.toString());
    if (label) {
      this.setAttribute("label", label);
    }
  }
}

/**
 * Free Shipping Goal Component
 *
 * Displays free shipping progress and updates in real-time when cart changes.
 * Supports both single currency (with conversion) and multiple currency formats.
 *
 * @extends {Component}
 */
export class FreeShippingGoal extends Component {
  #progressBarElement = null;

  connectedCallback() {
    super.connectedCallback();

    // Listen to cart targets
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener("progress-bar-ready", this.#handleProgressBarReady);

    // Initialize on load
    this.#initialize();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener("progress-bar-ready", this.#handleProgressBarReady);
  }

  /**
   * Handle progress bar ready event
   * @param {CustomEvent} event - Progress bar ready event
   */
  #handleProgressBarReady = (event) => {
    // Check if this progress bar belongs to us
    if (event.detail.element.closest("free-shipping-goal") === this) {
      this.#progressBarElement = event.detail.element;
    }
  };

  /**
   * Handle cart update events
   * @param {CustomEvent} event - Cart update event
   */
  #handleCartUpdate = (event) => {
    const { data } = event.detail;

    // Update component data from cart response
    if (data.sections) {
      this.#updateCartTotalFromEvent(data);

      // Re-setup currency conversion in case currency changed
      this.#setupCurrencyConversion();

      // Update display immediately after data extraction
      this.#updateDisplay();
    }
  };

  /**
   * Initialize the component
   */
  #initialize() {
    this.#setupCurrencyConversion();

    // Try to get progress bar element immediately
    this.#progressBarElement = this.querySelector("progress-bar");

    requestAnimationFrame(() => {
      this.#updateDisplay();
    });
  }

  /**
   * Update cart data from cart update event
   * @param {Object} cartData - Cart update event data
   */
  #updateCartTotalFromEvent(cartData) {
    if (!cartData.sections) return;

    const sectionId = this.closest("[data-section-id]")?.dataset.sectionId;
    if (!sectionId || !cartData.sections[sectionId]) return;

    const newSectionHTML = new DOMParser().parseFromString(
      cartData.sections[sectionId],
      "text/html"
    );
    const newFreeShippingGoal = newSectionHTML.querySelector("free-shipping-goal");

    if (!newFreeShippingGoal) return;

    // Update all relevant data attributes
    const newData = {
      cartTotal: newFreeShippingGoal.dataset.cartTotal,
      currentCurrency: newFreeShippingGoal.dataset.currentCurrency,
      minimumAmount: newFreeShippingGoal.dataset.minimumAmount,
      isSingleCurrency: newFreeShippingGoal.dataset.isSingleCurrency,
      shopCurrency: newFreeShippingGoal.dataset.shopCurrency,
    };

    // Only update if data actually changed to avoid unnecessary re-renders
    let hasChanges = false;
    for (const [key, value] of Object.entries(newData)) {
      if (this.dataset[key] !== value) {
        this.dataset[key] = value;
        hasChanges = true;
      }
    }

    // Data updated successfully
  }

  /**
   * Setup currency conversion logic
   */
  #setupCurrencyConversion() {
    const minimumAmount = parseFloat(this.dataset.minimumAmount);
    const isSingleCurrency = this.dataset.isSingleCurrency === "true";
    const shopCurrency = this.dataset.shopCurrency;
    const currentCurrency = this.dataset.currentCurrency;

    // Validate minimum amount
    if (isNaN(minimumAmount) || minimumAmount <= 0) {
      console.warn("FreeShippingGoal: Invalid minimum amount", this.dataset.minimumAmount);
      this.convertedAmountInCents = 0;
      return;
    }

    // Cache key for conversion to avoid recalculation
    const cacheKey = `${minimumAmount}-${currentCurrency}-${window.Shopify?.currency?.rate || 1}`;

    if (this.conversionCache?.key === cacheKey) {
      return; // Use cached value
    }

    // If single currency and current currency differs from shop currency
    if (isSingleCurrency && currentCurrency !== shopCurrency) {
      // Use Shopify currency rate for conversion
      if (window.Shopify?.currency?.rate) {
        const rate = parseFloat(window.Shopify.currency.rate);
        if (!isNaN(rate) && rate > 0) {
          this.convertedAmount = minimumAmount * rate;
          this.convertedAmountInCents = Math.round(this.convertedAmount * 100);
        } else {
          console.warn("FreeShippingGoal: Invalid currency rate", window.Shopify.currency.rate);
          this.convertedAmountInCents = Math.round(minimumAmount * 100);
        }
      } else {
        // Fallback if no rate available
        this.convertedAmountInCents = Math.round(minimumAmount * 100);
      }
    } else {
      // No conversion needed
      this.convertedAmountInCents = Math.round(minimumAmount * 100);
    }

    // Cache the conversion result
    this.conversionCache = {
      key: cacheKey,
      convertedAmountInCents: this.convertedAmountInCents,
      minimumAmount,
      isSingleCurrency,
      shopCurrency,
      currentCurrency,
      rate: window.Shopify?.currency?.rate,
    };
  }

  /**
   * Update the display based on current cart state
   */
  #updateDisplay() {
    const cartTotal = parseInt(this.dataset.cartTotal);

    // Validate cart total
    if (isNaN(cartTotal) || cartTotal < 0) {
      console.warn("FreeShippingGoal: Invalid cart total", this.dataset.cartTotal);
      return;
    }

    // Don't show if minimum amount is invalid
    if (this.convertedAmountInCents <= 0) {
      return;
    }

    const isQualified = cartTotal >= this.convertedAmountInCents;
    this.#toggleStates(isQualified, cartTotal);
  }

  /**
   * Get debug information for troubleshooting
   * @returns {Object} Debug information
   */
  getDebugInfo() {
    return {
      cartTotal: parseInt(this.dataset.cartTotal),
      convertedAmountInCents: this.convertedAmountInCents,
      isQualified: parseInt(this.dataset.cartTotal) >= this.convertedAmountInCents,
      remainingAmount: this.convertedAmountInCents - parseInt(this.dataset.cartTotal),
      moneyFormat: window.FoxTheme?.moneyFormat || window.Shopify?.currency?.money_format,
      conversionInfo: this.conversionInfo,
    };
  }

  /**
   * Update progress bar with current percentage
   * @param {number} cartTotal - Current cart total in cents
   */
  #updateProgressBar(cartTotal) {
    // Use cached element or find new one
    const progressBarElement = this.#progressBarElement || this.querySelector("progress-bar");
    if (!progressBarElement) return;

    const percent = Math.min((cartTotal / this.convertedAmountInCents) * 100, 100);

    // Always use attribute update - safer and more reliable
    progressBarElement.setAttribute("percent", percent.toString());
  }

  /**
   * Toggle between qualified and remaining states
   * @param {boolean} isQualified - Whether customer qualifies for free shipping
   * @param {number} cartTotal - Current cart total in cents
   */
  #toggleStates(isQualified, cartTotal) {
    const congratulations = this.querySelector(".free-shipping-goal__congratulations");
    const remaining = this.querySelector(".free-shipping-goal__remaining");

    // Always update progress bar
    this.#updateProgressBar(cartTotal);

    if (isQualified) {
      congratulations?.classList.remove("hidden");
      remaining?.classList.add("hidden");
      // Keep progress bar visible but at 100%
    } else {
      congratulations?.classList.add("hidden");
      remaining?.classList.remove("hidden");

      // Update remaining amount
      const remainingAmount = this.convertedAmountInCents - cartTotal;
      const remainingElement = this.querySelector(".free-shipping-goal__remaining-amount");

      if (remainingElement && remainingAmount > 0) {
        const moneyFormat = window.FoxTheme?.moneyFormat || window.Shopify?.currency?.money_format;
        remainingElement.textContent = formatCurrency(remainingAmount, moneyFormat);
      }
    }
  }
}

// Register components
customElements.define("progress-bar", ProgressBar);
customElements.define("free-shipping-goal", FreeShippingGoal);
