import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";

/**
 * A custom element that displays a cart icon.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} cartBubbleCount - The cart bubble count element.
 *
 * @extends {Component<Refs>}
 */
class CartCount extends Component {
  requiredRefs = ["cartBubbleCount"];

  /** @type {number} */
  get currentCartCount() {
    return parseInt(this.refs.cartBubbleCount.textContent ?? "0", 10);
  }

  set currentCartCount(value) {
    this.refs.cartBubbleCount.textContent = value < 100 ? String(value) : "99+";
  }

  get inDrawer() {
    return this.dataset.context === "drawer";
  }

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    document.removeEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
  }

  /**
   * Handles the cart update event
   * Supports both incremental (CartAddEvent) and absolute (CartUpdateEvent) count updates
   * @param {Event} event - The cart update event.
   */
  onCartUpdate = async (event) => {
    const itemCount = event.detail.data?.itemCount ?? 0;
    const isIncremental = event.detail.data?.isIncremental ?? false;

    if (isIncremental) {
      // Incremental update: add delta to current count
      let currentCount = parseInt(this.refs.cartBubbleCount.textContent ?? "0", 10);

      if (!this.inDrawer) {
        currentCount += itemCount;
      }

      this.renderCartBubble(currentCount);
    } else {
      // Absolute update: set count directly from server
      this.renderCartBubble(itemCount);
    }
  };

  /**
   * Renders the cart bubble.
   * @param {number} itemCount - The number of items in the cart.
   */
  renderCartBubble = async (itemCount) => {
    this.currentCartCount = itemCount;

    this.classList.toggle("hidden", itemCount === 0);
    this.classList.toggle("cart-count--small-medium", itemCount > 99);
    document.body.classList.toggle("cart-has-items", itemCount > 0);
  };
}

if (!customElements.get("cart-count")) {
  customElements.define("cart-count", CartCount);
}
