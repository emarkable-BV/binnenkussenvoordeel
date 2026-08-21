import { Component } from "@theme/component";
import { fetchConfig, debounce } from "@theme/utilities";
import { morphSection } from "@theme/section-renderer";
import { CartUpdateEvent } from "@theme/events";

/**
 * Gift wrapping fee (cart line) + optional cart attribute `Gift note`.
 *
 * Linkage between a parent product and its gift-wrap line is done via Shopify's
 * native Nested Cart Lines API (`parent_line_key` on add, `parent_relationship`
 * on read). No custom UUID tracking.
 */
class GiftWrappingComponent extends Component {
  #debouncedMessage;

  constructor() {
    super();
    this.#debouncedMessage = debounce(this.#flushGiftMessage.bind(this), 300);
  }

  /**
   * @param {Event} event
   */
  onWholeOrderGiftToggle = async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;

    const wrap = /** @type {HTMLElement | undefined} */ (this.refs.wholeOrderLoadingWrap);
    wrap?.classList.add("is-loading");
    try {
      if (input.checked) {
        await this.#addWholeOrderGift(input);
      } else {
        await this.#removeAllGiftVariantLines();
      }
    } finally {
      wrap?.classList.remove("is-loading");
    }
  };

  /**
   * @param {Event} event
   */
  onGiftMessageInput = (event) => {
    this.#debouncedMessage(event);
  };

  /**
   * @param {Event} event
   */
  async #flushGiftMessage(event) {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;

    try {
      await fetch(
        FoxTheme.routes.cart_update_url,
        fetchConfig("json", {
          body: JSON.stringify({
            attributes: { "Gift note": target.value },
          }),
        })
      );
    } catch (error) {
      console.error(error);
    }
  }

  get #giftVariantId() {
    return Number(this.dataset.giftVariantId);
  }

  get #syncQuantity() {
    return this.dataset.syncQuantity === "true";
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
            source: "gift-wrapping-component",
            sections,
          })
        );
      }
    });
  }

  /**
   * @returns {Promise<object>}
   */
  async #fetchCart() {
    const res = await fetch(FoxTheme.routes.cart);
    return res.json();
  }

  /**
   * Removes every cart line whose variant matches the gift fee variant (both the
   * whole-order line and any nested per-line children).
   */
  async #removeAllGiftVariantLines() {
    const variantId = this.#giftVariantId;
    while (true) {
      const cart = await this.#fetchCart();
      const item = cart.items.find((i) => Number(i.variant_id) === variantId);
      if (!item) break;

      const body = JSON.stringify({
        id: item.key,
        quantity: 0,
        ...this.#getSectionPayload(),
      });

      const res = await fetch(FoxTheme.routes.cart_change_url, fetchConfig("json", { body }));
      const parsed = await res.json();
      await this.#applyCartJsonResponse(parsed);
    }
  }

  /**
   * @param {HTMLInputElement} wholeOrderInput
   */
  async #addWholeOrderGift(wholeOrderInput) {
    await this.#removeAllGiftVariantLines();

    let giftQuantity = 1;
    if (this.#syncQuantity) {
      const cart = await this.#fetchCart();
      giftQuantity = cart.items.reduce((sum, i) => sum + i.quantity, 0) || 1;
    }

    const body = JSON.stringify({
      items: [
        {
          id: this.#giftVariantId,
          quantity: giftQuantity,
        },
      ],
      ...this.#getSectionPayload(),
    });

    const res = await fetch(FoxTheme.routes.cart_add_url, fetchConfig("json", { body }));
    const parsed = await res.json();

    if (parsed.status && parsed.message) {
      console.error(parsed.message);
      wholeOrderInput.checked = false;
      return;
    }

    await this.#applyCartJsonResponse(parsed);
  }
}

if (!customElements.get("gift-wrapping-component")) {
  customElements.define("gift-wrapping-component", GiftWrappingComponent);
}
