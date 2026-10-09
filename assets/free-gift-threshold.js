import { Component } from "@theme/component";
import { CartGroupedSections, CartUpdateEvent, ThemeEvents } from "@theme/events";
import { morphSection } from "@theme/section-renderer";
import { fetchConfig } from "@theme/utilities";

/**
 * Free Gift Threshold Component
 *
 * Adds a configured gift product to the cart the first time the cart total
 * reaches the configured goal amount. If the gift later disappears from the
 * cart while the goal is still met (the customer removed it, or the cart
 * dipped below the goal and came back up), it is not silently re-added -
 * instead a subtle "add your free gift" prompt is shown so the customer
 * stays in control. If the cart drops below the goal, the gift line is
 * removed automatically since it's no longer earned.
 *
 * @typedef {object} Refs
 * @property {HTMLButtonElement} addButton - The prompt's add button.
 *
 * @extends {Component<Refs>}
 */
export class FreeGiftThreshold extends Component {
  #busy = false;

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);

    this.#setupCurrencyConversion();
    this.#evaluate({
      giftInCart: this.dataset.giftInCart === "true",
      giftQuantity: parseInt(this.dataset.giftQuantity, 10) || 0,
      cartTotal: parseInt(this.dataset.cartTotal, 10) || 0,
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
  }

  /**
   * Handles the prompt button click: the customer explicitly asked for the gift.
   * @param {Event} event
   */
  addGiftFromPrompt = async (event) => {
    event.preventDefault();
    if (this.#busy) return;

    const button = this.refs.addButton;
    button?.classList.add("btn--loading");

    try {
      await this.#addGift();
    } finally {
      button?.classList.remove("btn--loading");
    }
  };

  /**
   * Reads the up-to-date state from the freshly rendered section HTML rather
   * than `event.detail.resource` - that resource is the raw `/cart/add.js` or
   * `/cart/change.js` response, which for `add.js` only contains the added
   * line(s), not the full cart (no `total_price`). The re-rendered section
   * always reflects the authoritative server-side cart state.
   * @param {CartUpdateEvent} event
   */
  #handleCartUpdate = (event) => {
    if (this.#busy) return;

    const sections = event.detail?.data?.sections;
    if (!sections) return;

    const sectionId = this.closest("[data-section-id]")?.dataset.sectionId;
    if (!sectionId || !sections[sectionId]) return;

    const newDoc = new DOMParser().parseFromString(sections[sectionId], "text/html");
    const newElement = newDoc.querySelector("free-gift-threshold");
    if (!newElement) return;

    const cartTotal = parseInt(newElement.dataset.cartTotal, 10) || 0;
    const giftInCart = newElement.dataset.giftInCart === "true";
    const giftQuantity = parseInt(newElement.dataset.giftQuantity, 10) || 0;

    this.dataset.cartTotal = String(cartTotal);
    this.#evaluate({ giftInCart, giftQuantity, cartTotal });
  };

  /**
   * @param {{ giftInCart: boolean, giftQuantity: number, cartTotal: number }} state
   */
  async #evaluate({ giftInCart, giftQuantity, cartTotal }) {
    const qualifies = this.#convertedAmountInCents > 0 && cartTotal >= this.#convertedAmountInCents;

    if (!qualifies) {
      this.#hidePrompt();
      if (giftInCart) {
        await this.#removeGift();
      }
      return;
    }

    if (giftInCart) {
      this.#hidePrompt();
      // Only ever one free gift per cart, regardless of how a second one
      // might have slipped in (quick add, admin edit, a race between tabs).
      if (giftQuantity > 1) {
        await this.#clampGiftQuantity();
      }
      return;
    }

    if (this.#hasBeenAddedBefore) {
      this.#showPrompt();
      return;
    }

    this.#hidePrompt();
    await this.#addGift();
  }

  #showPrompt() {
    this.classList.remove("hidden");
  }

  #hidePrompt() {
    this.classList.add("hidden");
  }

  async #addGift() {
    if (this.#busy) return;
    this.#busy = true;

    try {
      const body = JSON.stringify({
        items: [{ id: this.#giftVariantId, quantity: 1 }],
        ...this.#getCartSectionsPayload(),
      });

      const response = await fetch(FoxTheme.routes.cart_add_url, fetchConfig("json", { body }));
      const parsed = await response.json();

      if (parsed?.status) {
        console.error(parsed.message || "FreeGiftThreshold: failed to add gift");
        return;
      }

      this.#rememberAdded();
      this.dataset.giftInCart = "true";
      this.#hidePrompt();
      await this.#applyCartResponse(parsed);
    } catch (error) {
      console.error("FreeGiftThreshold: failed to add gift", error);
    } finally {
      this.#busy = false;
    }
  }

  async #removeGift() {
    if (this.#busy) return;
    this.#busy = true;

    try {
      const cart = await this.#fetchCartJson();
      const giftVariantId = this.#giftVariantId;
      const giftItem = cart.items?.find((item) => Number(item.variant_id) === giftVariantId);
      if (!giftItem) return;

      const body = JSON.stringify({
        id: giftItem.key,
        quantity: 0,
        ...this.#getCartSectionsPayload(),
      });

      const response = await fetch(FoxTheme.routes.cart_change_url, fetchConfig("json", { body }));
      const parsed = await response.json();

      this.dataset.giftInCart = "false";
      await this.#applyCartResponse(parsed);
    } catch (error) {
      console.error("FreeGiftThreshold: failed to remove gift", error);
    } finally {
      this.#busy = false;
    }
  }

  async #clampGiftQuantity() {
    if (this.#busy) return;
    this.#busy = true;

    try {
      const cart = await this.#fetchCartJson();
      const giftVariantId = this.#giftVariantId;
      const giftItem = cart.items?.find((item) => Number(item.variant_id) === giftVariantId);
      if (!giftItem || giftItem.quantity <= 1) return;

      const body = JSON.stringify({
        id: giftItem.key,
        quantity: 1,
        ...this.#getCartSectionsPayload(),
      });

      const response = await fetch(FoxTheme.routes.cart_change_url, fetchConfig("json", { body }));
      const parsed = await response.json();

      await this.#applyCartResponse(parsed);
    } catch (error) {
      console.error("FreeGiftThreshold: failed to clamp gift quantity", error);
    } finally {
      this.#busy = false;
    }
  }

  async #fetchCartJson() {
    const response = await fetch(FoxTheme.routes.cart);
    return response.json();
  }

  /**
   * @param {{ sections?: Record<string, string>, items?: object[] } | undefined} parsed
   */
  async #applyCartResponse(parsed) {
    if (!parsed?.sections) return;

    for (const sectionId of Object.keys(parsed.sections)) {
      await morphSection(sectionId, parsed.sections[sectionId]);
    }

    document.dispatchEvent(
      new CartUpdateEvent(parsed, this.id || "free-gift-threshold", {
        sections: parsed.sections,
      })
    );
  }

  #getCartSectionsPayload() {
    /** @type {string[]} */
    const sections = [];
    this.dispatchEvent(new CartGroupedSections(sections));

    return {
      sections: [...new Set(sections)].join(","),
      sections_url: window.location.pathname,
    };
  }

  get #giftVariantId() {
    return Number(this.dataset.giftVariantId) || 0;
  }

  get #hasBeenAddedBefore() {
    try {
      return sessionStorage.getItem(this.#storageKey) === "true";
    } catch {
      return false;
    }
  }

  #rememberAdded() {
    try {
      sessionStorage.setItem(this.#storageKey, "true");
    } catch {
      // Ignore storage errors (private browsing, quota, etc.) - worst case
      // the gift gets auto-added again instead of showing the prompt.
    }
  }

  get #storageKey() {
    return `fox-free-gift-threshold-added-${this.#giftVariantId}`;
  }

  /**
   * Mirrors the currency conversion logic used by the free shipping goal bar.
   */
  #setupCurrencyConversion() {
    const minimumAmount = parseFloat(this.dataset.minimumAmount);
    const isSingleCurrency = this.dataset.isSingleCurrency === "true";
    const shopCurrency = this.dataset.shopCurrency;
    const currentCurrency = this.dataset.currentCurrency;

    if (isNaN(minimumAmount) || minimumAmount <= 0) {
      console.warn("FreeGiftThreshold: Invalid minimum amount", this.dataset.minimumAmount);
      this.#convertedAmountInCents = 0;
      return;
    }

    if (isSingleCurrency && currentCurrency !== shopCurrency) {
      const rate = parseFloat(window.Shopify?.currency?.rate);
      if (!isNaN(rate) && rate > 0) {
        this.#convertedAmountInCents = Math.round(minimumAmount * rate * 100);
      } else {
        this.#convertedAmountInCents = Math.round(minimumAmount * 100);
      }
    } else {
      this.#convertedAmountInCents = Math.round(minimumAmount * 100);
    }
  }

  /** @type {number} */
  #convertedAmountInCents = 0;
}

if (!customElements.get("free-gift-threshold")) {
  customElements.define("free-gift-threshold", FreeGiftThreshold);
}
