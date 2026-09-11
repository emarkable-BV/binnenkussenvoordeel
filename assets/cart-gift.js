import { Component } from "@theme/component";
import { fetchConfig } from "@theme/utilities";
import { morphSection } from "@theme/section-renderer";
import { CartUpdateEvent, ThemeEvents } from "@theme/events";

/**
 * Automatically adds/removes a configured "gift" product as soon as the
 * cart's pre-discount value crosses a merchant-configured threshold.
 *
 * Making the line item actually free at checkout is left entirely to a
 * native Shopify "Buy X get Y" automatic discount configured on the same
 * product/threshold — this component only manages whether the line item
 * is present, it never touches pricing itself.
 */
class CartGiftComponent extends Component {
  #busy = false;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    this.#evaluate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
  }

  get #variantId() {
    return Number(this.dataset.giftVariantId);
  }

  get #minimumAmountCents() {
    return Number(this.dataset.minimumAmountCents);
  }

  #handleCartUpdate = () => {
    this.#evaluate();
  };

  async #evaluate() {
    if (this.#busy || !this.#variantId || !this.#minimumAmountCents) return;

    this.#busy = true;
    try {
      const cart = await this.#fetchCart();
      const giftLine = cart.items.find((item) => Number(item.variant_id) === this.#variantId);
      // original_total_price mirrors what Shopify's own discount prerequisite
      // evaluates against (pre-discount), so this stays in sync even once the
      // gift line itself is discounted to zero. Exclude one gifted unit's own
      // original price first though — otherwise the gift's own value would
      // count towards keeping itself qualified once it's already in the cart.
      const qualifyingTotal = cart.original_total_price - (giftLine ? giftLine.original_price : 0);
      const qualifies = qualifyingTotal >= this.#minimumAmountCents;

      if (qualifies && !giftLine) {
        await this.#addGift();
      } else if (!qualifies && giftLine) {
        await this.#removeGift(giftLine.key);
      }
    } catch (error) {
      console.error(error);
    } finally {
      this.#busy = false;
    }
  }

  async #fetchCart() {
    const res = await fetch(FoxTheme.routes.cart);
    return res.json();
  }

  #getSectionPayload() {
    const ids = [];
    document.querySelectorAll("cart-items-component").forEach((el) => {
      if (el instanceof HTMLElement && el.dataset.sectionId) {
        ids.push(el.dataset.sectionId);
      }
    });
    return {
      sections: ids.join(","),
      sections_url: window.location.pathname,
    };
  }

  /**
   * @param {object} parsed
   */
  async #applyCartJsonResponse(parsed) {
    if (!parsed || !parsed.sections) return;

    const sections = parsed.sections;
    const cartItemsComponents = document.querySelectorAll("cart-items-component");
    let itemCount = 0;

    for (const sectionId of Object.keys(sections)) {
      await morphSection(sectionId, sections[sectionId]);
      const doc = new DOMParser().parseFromString(sections[sectionId], "text/html");
      const countEl = doc.querySelector('[ref="cartItemCount"]');
      if (countEl?.textContent) {
        itemCount = parseInt(countEl.textContent, 10) || itemCount;
      }
    }

    cartItemsComponents.forEach((comp) => {
      const sid = comp.dataset.sectionId;
      if (sid && sections[sid]) {
        comp.dispatchEvent(
          new CartUpdateEvent({}, sid, {
            itemCount,
            source: "cart-gift-component",
            sections,
          })
        );
      }
    });
  }

  async #addGift() {
    const body = JSON.stringify({
      items: [{ id: this.#variantId, quantity: 1 }],
      ...this.#getSectionPayload(),
    });

    const res = await fetch(FoxTheme.routes.cart_add_url, fetchConfig("json", { body }));
    const parsed = await res.json();

    // Gift product unavailable (sold out, etc.) — nothing more we can do here.
    if (parsed.status) return;

    await this.#applyCartJsonResponse(parsed);
  }

  /**
   * @param {string} lineKey
   */
  async #removeGift(lineKey) {
    const body = JSON.stringify({
      id: lineKey,
      quantity: 0,
      ...this.#getSectionPayload(),
    });

    const res = await fetch(FoxTheme.routes.cart_change_url, fetchConfig("json", { body }));
    const parsed = await res.json();
    await this.#applyCartJsonResponse(parsed);
  }
}

if (!customElements.get("cart-gift-component")) {
  customElements.define("cart-gift-component", CartGiftComponent);
}
