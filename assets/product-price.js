import { ThemeEvents, VariantUpdateEvent } from "@theme/events";
import { formatCurrency } from "@theme/utilities";

/**
 * A custom element that displays a product price.
 * This component listens for variant update events and updates the price display accordingly.
 * It handles price updates from two different sources:
 * 1. Variant picker (in quick add modal or product page)
 * 2. Swatches variant picker (in product cards)
 */
class ProductPrice extends HTMLElement {
  #currentVariantId = null;
  #section = null;

  connectedCallback() {
    const closestSection = this.closest(".shopify-section, dialog");
    const closestCard = this.closest("product-card");

    if (!closestSection || closestCard) return;

    this.#section = closestSection;
    closestSection.addEventListener(ThemeEvents.variantUpdate, this.updatePrice);
    this.addEventListener("price:update-optimistic", this.updatePriceOptimistic);
  }

  disconnectedCallback() {
    this.#section?.removeEventListener(ThemeEvents.variantUpdate, this.updatePrice);
    this.#section = null;
    this.removeEventListener("price:update-optimistic", this.updatePriceOptimistic);
  }

  /**
   * Updates the price.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updatePrice = (event) => {
    const incomingVariantId = event.detail.resource?.id;
    const variant = event.detail.resource;

    // Skip if this is from cache - optimistic update already handled it
    if (event.detail.data.isOptimistic) {
      // Update tracking ID for cache hit
      this.#currentVariantId = incomingVariantId;
      return;
    }

    const isProductSwitch = !!event.detail.data.newProduct;

    // Skip background sync only for same-product updates (optimistic already handled it).
    // For combine listing switches (isProductSwitch), there is no optimistic path so we must update here.
    if (event.detail.data.isBackgroundSync && !isProductSwitch) {
      return;
    }

    // 🛡️ RACE CONDITION FIX: Check if this HTML is for current variant
    // Skip for product switches — different product means variant IDs are unrelated.
    if (!isProductSwitch && this.#currentVariantId && incomingVariantId && String(this.#currentVariantId) !== String(incomingVariantId)) {
      console.warn(
        `Skipping outdated price morph (current: ${this.#currentVariantId}, incoming: ${incomingVariantId})`
      );
      return;
    }

    // Update tracking ID
    this.#currentVariantId = incomingVariantId;

    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (event.target instanceof HTMLElement && event.target.dataset.productId !== this.dataset.productId) {
      return;
    }

    // Check if HTML exists (might be null from cache)
    if (!event.detail.data.html) {
      console.warn("No HTML in event data");
      return;
    }

    const newPrice = event.detail.data.html.querySelector('product-price [ref="priceContainer"]');
    const currentPrice = this.querySelector('[ref="priceContainer"]');

    if (!newPrice || !currentPrice) return;

    // Handle case when variant is null (no valid selection)
    // This happens when fallback HTML fetch is triggered without variantId
    if (!variant) {
      // For product switches: replace container so the new product's HTML structure
      // (incl. data-quantity-breaks) is in place for subsequent optimistic updates.
      if (isProductSwitch && currentPrice.innerHTML !== newPrice.innerHTML) {
        currentPrice.replaceWith(newPrice);
      }
      this.style.display = "none";
      return;
    }

    // Variant exists - show price and morph if needed
    this.style.display = "";

    if (currentPrice.innerHTML !== newPrice.innerHTML) {
      currentPrice.replaceWith(newPrice);
    }
  };

  /**
   * ⚡ Optimistic price update from cached variant data (instant, no network delay)
   *
   * This method updates the price UI immediately using variant data from cache/JSON,
   * without waiting for a full HTML fetch. This provides instant feedback to users.
   *
   * Updates:
   * - Toggle .price--on-sale class on container (CSS handles show/hide)
   * - Main price value in .price__sale and .price__regular
   * - Compare-at-price value in .price__sale
   *
   * Race condition protection: Updates #currentVariantId to prevent stale HTML from
   * overriding this optimistic update (see updatePrice method).
   *
   * @param {CustomEvent} event - The optimistic update event with variant data
   */
  updatePriceOptimistic = (event) => {
    const variant = event.detail.variant;

    // Find price container first
    const priceContainer = this.querySelector('[ref="priceContainer"]');
    if (!priceContainer) {
      console.warn("Price container not found");
      return;
    }

    // Hide price if variant doesn't exist (no valid selection)
    if (!variant) {
      this.style.display = "none";
      return;
    }

    // Track current variant ID to prevent race conditions
    // This ensures stale HTML responses won't override this optimistic update
    this.#currentVariantId = variant.id;

    try {
      // Restore visibility (variant exists; hide case is handled above)
      this.style.display = "";

      // If product has volume/quantity rules, price is a range (product-level).
      // Skip DOM price updates — background HTML handles the range correctly.
      if (priceContainer.dataset.quantityBreaks === "true") {
        return;
      }

      // Get money format from theme settings
      const moneyFormat = window.FoxTheme?.moneyFormat || "${{amount}}";

      // Format prices using theme's money format
      const price = formatCurrency(variant.price, moneyFormat);
      const comparePrice =
        variant.compare_at_price > variant.price ? formatCurrency(variant.compare_at_price, moneyFormat) : null;

      const isOnSale = Boolean(comparePrice);

      // Toggle class .price--on-sale to let CSS handle show/hide
      if (isOnSale) {
        priceContainer.classList.add("price--on-sale");
      } else {
        priceContainer.classList.remove("price--on-sale");
      }

      // Update .price__sale (only 1 div exists at a time)
      const salePriceDiv = priceContainer.querySelector(".price__sale");
      if (salePriceDiv) {
        const salePriceEl = salePriceDiv.querySelector(".price");
        const comparePriceEl = salePriceDiv.querySelector(".compare-at-price");

        if (salePriceEl) salePriceEl.textContent = price;
        if (comparePriceEl && comparePrice) {
          comparePriceEl.textContent = comparePrice;
        }
      }

      // Update .price__regular (only 1 div exists, but be careful with price range)
      const regularPriceDiv = priceContainer.querySelector(".price__regular");
      if (regularPriceDiv) {
        const regularPriceEl = regularPriceDiv.querySelector(".price");
        // Only update if not a price range (check for range indicators)
        if (
          regularPriceEl &&
          !regularPriceEl.textContent.includes("–") &&
          !regularPriceEl.textContent.includes("from")
        ) {
          regularPriceEl.textContent = price;
        }
      }

      // Update unit price
      const unitPriceEl = priceContainer.querySelector(".unit-price");

      if (variant.unit_price && variant.unit_price_measurement) {
        const unitPrice = formatCurrency(variant.unit_price, moneyFormat);
        const { reference_value, reference_unit } = variant.unit_price_measurement;
        const unitLabel = reference_value !== 1 ? `${reference_value}${reference_unit}` : reference_unit;
        const unitPriceText = ` ${unitPrice}/${unitLabel} `;

        if (unitPriceEl) {
          // Element exists — update the non-whitespace text node (skip leading whitespace nodes)
          const textNode = [...unitPriceEl.childNodes].find(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== ""
          );
          if (textNode) {
            textNode.textContent = unitPriceText;
          } else {
            unitPriceEl.appendChild(document.createTextNode(unitPriceText));
          }
          unitPriceEl.style.display = "";
        } else {
          // Element doesn't exist yet — create and append (variant had no unit price initially)
          const small = document.createElement("small");
          small.className = "unit-price color-subtext";
          small.innerHTML = `<span class="visually-hidden">${window.FoxTheme?.translations?.unit_price || "Unit price"}</span>${unitPriceText}`;
          priceContainer.appendChild(small);
        }
      } else if (unitPriceEl) {
        unitPriceEl.style.display = "none";
      }
    } catch (error) {
      console.error("Error updating price:", error);
    }
  };
}

if (!customElements.get("product-price")) {
  customElements.define("product-price", ProductPrice);
}
