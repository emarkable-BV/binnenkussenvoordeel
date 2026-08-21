import { ThemeEvents } from "@theme/events";

/**
 * Listens for variant section HTML updates and morphs the title container (same pattern as product-badge).
 * Skips product cards; does not skip background sync (title has no optimistic-only path).
 */
class ProductTitle extends HTMLElement {
  #section = null;

  connectedCallback() {
    const closestSection = this.closest(".shopify-section, dialog");
    const closestCard = this.closest("product-card");

    if (!closestSection || closestCard) return;

    this.#section = closestSection;
    closestSection.addEventListener(ThemeEvents.variantUpdate, this.updateTitle);
  }

  disconnectedCallback() {
    this.#section?.removeEventListener(ThemeEvents.variantUpdate, this.updateTitle);
    this.#section = null;
  }

  /**
   * @param {import("@theme/events").VariantUpdateEvent} event
   */
  updateTitle = (event) => {
    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (event.target instanceof HTMLElement && event.target.dataset.productId !== this.dataset.productId) {
      return;
    }

    if (!event.detail.data.html) return;

    const blockId = this.dataset.blockId;
    let newTitleComponent = null;

    if (blockId) {
      for (const el of event.detail.data.html.querySelectorAll("product-title")) {
        if (el.dataset.blockId === blockId) {
          newTitleComponent = el;
          break;
        }
      }
    }

    if (!newTitleComponent) {
      newTitleComponent = event.detail.data.html.querySelector("product-title");
    }

    const newTitle = newTitleComponent?.querySelector(":scope > .text-block");
    const currentTitle = this.querySelector(":scope > .text-block");

    if (!newTitle || !currentTitle) return;

    if (currentTitle.innerHTML !== newTitle.innerHTML) {
      currentTitle.replaceWith(newTitle);
    }
  };
}

if (!customElements.get("product-title")) {
  customElements.define("product-title", ProductTitle);
}
