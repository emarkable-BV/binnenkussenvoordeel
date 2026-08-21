import { Component } from "@theme/component";
import { DialogCloseEvent, DialogComponent } from "@theme/dialog";
import { CartAddEvent, CartUpdateEvent, ThemeEvents } from "@theme/events";
import { getIOSVersion } from "@theme/utilities";

export class QuickAddComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {Map<string, Element>} */
  #cachedContent = new Map();

  get productUrl() {
    return this.dataset?.productUrl;
  }

  get productPageUrl() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest("product-card"));
    const productLink = productCard?.getProductCardLink();

    if (!productLink?.href) return "";

    const url = new URL(productLink.href);

    if (url.searchParams.has("variant")) {
      return url.toString();
    }

    const selectedVariantId = this.#getSelectedVariantId();
    if (selectedVariantId) {
      url.searchParams.set("variant", selectedVariantId);
    }

    return url.toString();
  }

  /**
   * Gets the currently selected variant ID from the product card
   * @returns {string | null} The variant ID or null
   */
  #getSelectedVariantId() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest("product-card"));
    return productCard?.getSelectedVariantId() || null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.quickAddButtonSpinner = this.querySelector(".quick-add__button-spinner");
    this.quickAddButton = this.querySelector(".button-choose-options");
    document.addEventListener(ThemeEvents.variantSelected, this.#updateQuickAddButtonState.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.variantSelected, this.#updateQuickAddButtonState.bind(this));
    this.#abortController?.abort();
  }

  #updateQuickAddButtonState(event) {
    if (!(event.target instanceof HTMLElement)) return;
    if (this.dataset.quickAddMode === "view") return;
    if (event.target.closest("product-card") !== this.closest("product-card")) return;
    const productOptionsCount = this.dataset.productOptionsCount;
    const quickAddButton = productOptionsCount === "1" ? "add" : "choose";
    this.setAttribute("data-quick-add-button", quickAddButton);
  }

  /** @param {QuickAddDialog} dialogComponent */
  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute("stay-visible", true);

    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute("stay-visible", false), {
      once: true,
    });
  }

  #openQuickAddModal = () => {
    const dialogComponent = document.getElementById("quick-add-dialog");
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    this.#stayVisibleUntilDialogCloses(dialogComponent);

    dialogComponent.showDialog();
  };

  #closeQuickAddModal = () => {
    const dialogComponent = document.getElementById("quick-add-dialog");
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    dialogComponent.closeDialog();
  };

  /**
   * Handles quick add button click
   * @param {Event} event - The click event
   */
  handleClick = async (event) => {
    event.preventDefault();

    // Use the product URL with section_id to get product context
    const currentUrl = `${this.productPageUrl.split("?")[0]}?section_id=${this.quickAddDrawerId}&${this.productPageUrl.split("?")[1]}`;

    let quickAddContent = this.#cachedContent.get(currentUrl);

    if (!quickAddContent) {
      this.addLoading();
      // Fetch and cache the content
      const html = await this.fetchProductPage(currentUrl);
      if (html) {
        const quickAddContentElement = html.querySelector("[data-quick-add-content]");
        if (quickAddContentElement) {
          quickAddContent = /** @type {Element} */ (quickAddContentElement.cloneNode(true));
          this.#cachedContent.set(currentUrl, quickAddContent);
        }
      }
      this.removeLoading();
    }

    if (quickAddContent) {
      const freshContent = /** @type {Element} */ (quickAddContent.cloneNode(true));
      await this.updateQuickAddModal(freshContent);
    }

    this.#openQuickAddModal();
  };

  /**
   * Fetches the product page content
   * @param {string} productPageUrl - The URL of the product page to fetch
   * @returns {Promise<Document | null>}
   */
  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return null;

    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(productPageUrl, {
        signal: this.#abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch product page: HTTP error ${response.status}`);
      }

      const responseText = await response.text();
      const html = new DOMParser().parseFromString(responseText, "text/html");

      document.dispatchEvent(
        new CustomEvent(ThemeEvents.quickViewLoaded, {
          detail: { productUrl: this.productUrl },
        })
      );

      return html;
    } catch (error) {
      if (error.name === "AbortError") {
        return null;
      } else {
        throw error;
      }
    } finally {
      this.#abortController = null;
    }
  }

  async updateQuickAddModal(quickAddContent) {
    const quickAddDrawerContent = document.getElementById("quick-add-drawer-content");
    if (!quickAddContent || !quickAddDrawerContent) return;

    quickAddDrawerContent.innerHTML = quickAddContent.innerHTML;
    this.#syncVariantSelection(quickAddContent);
  }

  /**
   * Syncs the variant selection from the product card to the modal
   * @param {Element} modalContent - The modal content element
   */
  #syncVariantSelection(modalContent) {
    const selectedVariantId = this.#getSelectedVariantId();
    if (!selectedVariantId) return;

    // Find and check the corresponding input in the modal
    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement && input.dataset.variantId === selectedVariantId && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
    }
  }

  /**
   * Adds loading class to the add to cart button.
   */
  addLoading() {
    this.quickAddButton?.classList.add("btn--loading");
    this.quickAddButtonSpinner?.classList.remove("hidden");
  }

  /**
   * Removes loading class from the add to cart button.
   */
  removeLoading() {
    this.quickAddButton?.classList.remove("btn--loading");
    this.quickAddButtonSpinner?.classList.add("hidden");
  }

  get quickAddDrawerId() {
    const quickAddDrawer = document.getElementById("quick-add-drawer");
    return quickAddDrawer?.dataset.sectionId;
  }
}
if (!customElements.get("quick-add-component")) {
  customElements.define("quick-add-component", QuickAddComponent);
}

class QuickAddDialog extends DialogComponent {
  #abortController = new AbortController();
  /** @type {number | null} */
  #currentCartItemCount = null;

  connectedCallback() {
    super.connectedCallback();

    // Initialize cart count from DOM if available
    this.#initializeCartCount();

    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, {
      signal: this.#abortController.signal,
    });
    // this.addEventListener(ThemeEvents.variantUpdate, this.#updateProductTitleLink);

    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  get productUrl() {
    return this.querySelector(".quick-add__content")?.dataset?.productUrl;
  }

  showDialog() {
    super.showDialog();

    document.dispatchEvent(
      new CustomEvent(ThemeEvents.quickViewOpened, {
        detail: { productUrl: this.productUrl },
      })
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
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
   * Closes the dialog only if cart item count actually increased
   * @param {CartAddEvent | CartUpdateEvent} event - The cart update event
   */
  handleCartUpdate = (event) => {
    // Don't close if there was an error
    if (event.detail.data?.didError) {
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

    // Only close drawer if cart count actually increased
    // This handles:
    // - Adding items that exceed max quantity (count doesn't increase) -> don't close
    // - Adding items successfully (count increases) -> close drawer
    // - Removing items (count decreases) -> don't close
    if (newCartItemCount > currentCount) {
      this.closeDialog();
    }

    // Always update tracked count to stay in sync
    this.#currentCartItemCount = newCartItemCount;
  };

  #updateProductTitleLink = (/** @type {CustomEvent} */ event) => {
    const anchorElement = /** @type {HTMLAnchorElement} */ (
      event.detail.data.html?.querySelector(".view-product-title a")
    );
    const viewMoreDetailsLink = /** @type {HTMLAnchorElement} */ (this.querySelector(".view-product-title a"));
    const mobileProductTitle = /** @type {HTMLAnchorElement} */ (this.querySelector(".product-header a"));

    if (!anchorElement) return;

    if (viewMoreDetailsLink) viewMoreDetailsLink.href = anchorElement.href;
    if (mobileProductTitle) mobileProductTitle.href = anchorElement.href;
  };

  #handleDialogClose = () => {
    const iosVersion = getIOSVersion();
    /**
     * This is a patch to solve an issue with the UI freezing when the dialog is closed.
     * To reproduce it, use iOS 16.0.
     */
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;

    requestAnimationFrame(() => {
      /** @type {HTMLElement | null} */
      const grid = document.querySelector("#ResultsList [product-grid-view]");
      if (grid) {
        const currentWidth = grid.getBoundingClientRect().width;
        grid.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => {
          grid.style.width = "";
        });
      }
    });
  };
}

if (!customElements.get("quick-add-dialog")) {
  customElements.define("quick-add-dialog", QuickAddDialog);
}
