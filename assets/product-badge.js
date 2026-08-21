import { ThemeEvents, VariantUpdateEvent } from "@theme/events";

class ProductBadge extends HTMLElement {
  connectedCallback() {
    const closestSection = this.closest(".shopify-section, dialog");
    if (!closestSection) return;
    closestSection.addEventListener(ThemeEvents.variantUpdate, this.updateBadge);
  }

  disconnectedCallback() {
    const closestSection = this.closest(".shopify-section, dialog");
    if (!closestSection) return;
    closestSection.removeEventListener(ThemeEvents.variantUpdate, this.updateBadge);
  }

  /**
   * Updates the badge.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updateBadge = (event) => {
    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (
      event.target instanceof HTMLElement &&
      event.target.dataset.productId !== this.dataset.productId
    ) {
      return;
    }

    // Skip if no HTML (cache hit - will sync via background fetch)
    if (!event.detail.data.html) return;

    // Find the correct product-badge in HTML by matching productId
    // This prevents taking badge from wrong product (e.g. recommendations)
    const productId = this.dataset.productId;
    let newBadge = null;

    if (productId) {
      // Find all product-badge elements and match by productId
      const allBadges = event.detail.data.html.querySelectorAll("product-badge");
      for (const badge of allBadges) {
        if (badge.dataset.productId === productId) {
          newBadge = badge.querySelector('[ref="badgesContainer"]');
          break;
        }
      }
    }

    // Fallback: if no productId match, use first badge (for single product pages)
    if (!newBadge) {
      const fallbackBadge = event.detail.data.html.querySelector("product-badge");
      newBadge = fallbackBadge?.querySelector('[ref="badgesContainer"]');
    }

    const currentBadge = this.querySelector('[ref="badgesContainer"]');

    if (!newBadge || !currentBadge) return;

    if (currentBadge.innerHTML !== newBadge.innerHTML) {
      currentBadge.replaceWith(newBadge);
    }
  };
}

if (!customElements.get("product-badge")) {
  customElements.define("product-badge", ProductBadge);
}
