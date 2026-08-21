import { ThemeEvents, VariantUpdateEvent } from "@theme/events";
import { morph } from "@theme/morph";

class ProductInventory extends HTMLElement {
  connectedCallback() {
    const closestSection = this.closest(".shopify-section, dialog");
    closestSection?.addEventListener(ThemeEvents.variantUpdate, this.updateInventory);
  }

  disconnectedCallback() {
    const closestSection = this.closest(".shopify-section, dialog");
    closestSection?.removeEventListener(ThemeEvents.variantUpdate, this.updateInventory);
  }

  /**
   * Updates the inventory.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updateInventory = (event) => {
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

    // Find the correct product-inventory in HTML by matching productId
    // This prevents taking inventory from wrong product (e.g. recommendations)
    const productId = this.dataset.productId;
    let newInventory = null;

    if (productId) {
      // Find all product-inventory elements and match by productId
      const allInventories = event.detail.data.html.querySelectorAll("product-inventory");
      for (const inventory of allInventories) {
        if (inventory.dataset.productId === productId) {
          newInventory = inventory;
          break;
        }
      }
    }

    // Fallback: if no productId match, use first inventory (for single product pages)
    if (!newInventory) {
      newInventory = event.detail.data.html.querySelector("product-inventory");
    }

    if (!newInventory) return;

    morph(this, newInventory, { childrenOnly: true });
  };
}

if (!customElements.get("product-inventory")) {
  customElements.define("product-inventory", ProductInventory);
}
