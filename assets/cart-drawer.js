import { DialogComponent } from "@theme/dialog";
import { ThemeEvents, CartAddEvent, CartUpdateEvent, CartGroupedSections } from "@theme/events";
import { morphSection } from "@theme/section-renderer";
import { getSectionId } from "@theme/utilities";

/**
 * A custom element that manages a cart drawer.
 *
 * @extends {DialogComponent}
 */

class CartDrawerComponent extends DialogComponent {
  /** @type {number | null} */
  #currentCartItemCount = null;

  connectedCallback() {
    super.connectedCallback();

    // Initialize cart count from DOM if available
    this.#initializeCartCount();

    // Listen to cart update events (both CartAddEvent and CartUpdateEvent use ThemeEvents.cartUpdate)
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);

    this.getSectionToRenderListener = this.#getSectionToRender.bind(this);
    document.addEventListener(CartGroupedSections.eventName, this.getSectionToRenderListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(CartGroupedSections.eventName, this.getSectionToRenderListener);
  }

  /**
   * Initialize cart count from DOM or cart-count component
   */
  #initializeCartCount() {
    // Try to get count from cart-count component (not in drawer)
    const cartCountElement = document.querySelector('cart-count:not([data-context="drawer"])');
    if (cartCountElement?.refs?.cartBubbleCount) {
      this.#currentCartItemCount = parseInt(cartCountElement.refs.cartBubbleCount.textContent ?? "0", 10);
      return;
    }

    // Fallback: try to get from cart-bubble__text-count class
    const cartBubbleCount = document.querySelector(".cart-bubble__text-count");
    if (cartBubbleCount) {
      this.#currentCartItemCount = parseInt(cartBubbleCount.textContent ?? "0", 10);
      return;
    }

    // If no count found, initialize to 0
    this.#currentCartItemCount = 0;
  }

  /**
   * Checks if the drawer is currently open
   * @returns {boolean}
   */
  #isDrawerOpen() {
    return this.refs.dialog?.open ?? false;
  }

  /**
   * Handles cart update events (both CartAddEvent and CartUpdateEvent)
   * Only opens drawer if cart item count actually increased
   * @param {CartAddEvent | CartUpdateEvent} event
   */
  #handleCartUpdate = (event) => {
    if (!this.hasAttribute("auto-open")) {
      return;
    }

    // Don't open drawer if event comes from cart-items inside this drawer
    // This prevents drawer from reopening when user updates quantity inside drawer
    const sourceId = event.detail.sourceId;
    const source = event.detail.data?.source;
    if (source === "cart-items-component" && this.#isDrawerOpen()) {
      // Still update count for tracking, but don't open drawer
      this.#updateCartCount(event);
      return;
    }

    const itemCount = event.detail.data?.itemCount;
    const isIncremental = event.detail.data?.isIncremental ?? false;

    // If itemCount is missing or invalid, skip processing
    if (itemCount === undefined || itemCount === null) {
      return;
    }

    let newCartItemCount;

    if (isIncremental) {
      // CartAddEvent: itemCount is the delta (quantity added)
      // Handle negative values (shouldn't happen, but defensive)
      const currentCount = this.#currentCartItemCount ?? 0;
      newCartItemCount = Math.max(0, currentCount + itemCount);
    } else {
      // CartUpdateEvent: itemCount is the absolute total count
      // Ensure non-negative
      newCartItemCount = Math.max(0, itemCount);
    }

    const currentCount = this.#currentCartItemCount ?? 0;

    // Only open drawer if cart count actually increased
    // This handles:
    // - Adding items that exceed max quantity (count doesn't increase)
    // - Updating quantity in drawer (count may increase, but drawer already open)
    // - Removing items (count decreases, drawer shouldn't open)
    if (newCartItemCount > currentCount) {
      // Only open if drawer is not already open
      // This prevents reopening when quantity is updated inside drawer
      if (!this.#isDrawerOpen()) {
        // Pre-morph the drawer section before opening so the user never sees
        // the stale empty state — sections HTML is already in the event response.
        const sections = event.detail.data?.sections;
        const sectionId = getSectionId(this);
        if (sections?.[sectionId]) {
          morphSection(sectionId, sections[sectionId]).catch(() => {});
        }
        this.showDialog();
      }
    }

    // Always update tracked count to stay in sync
    this.#currentCartItemCount = newCartItemCount;
  };

  /**
   * Updates cart count from event without opening drawer
   * Used when event comes from inside drawer
   * @param {CartAddEvent | CartUpdateEvent} event
   */
  #updateCartCount(event) {
    const itemCount = event.detail.data?.itemCount;
    const isIncremental = event.detail.data?.isIncremental ?? false;

    if (itemCount === undefined || itemCount === null) {
      return;
    }

    if (isIncremental) {
      const currentCount = this.#currentCartItemCount ?? 0;
      this.#currentCartItemCount = Math.max(0, currentCount + itemCount);
    } else {
      this.#currentCartItemCount = Math.max(0, itemCount);
    }
  }

  open(event) {
    event.preventDefault();
    this.showDialog();

    /**
     * Close cart drawer when installments CTA is clicked to avoid overlapping dialogs
     */
    customElements.whenDefined("shopify-payment-terms").then(() => {
      const installmentsContent = document.querySelector("shopify-payment-terms")?.shadowRoot;
      const cta = installmentsContent?.querySelector("#shopify-installments-cta");
      cta?.addEventListener("click", this.closeDialog, { once: true });
    });
  }

  close() {
    this.closeDialog();
  }

  #getSectionToRender(event) {
    event.detail.sections.push(getSectionId(this));
  }
}

if (!customElements.get("cart-drawer-component")) {
  customElements.define("cart-drawer-component", CartDrawerComponent);
}
