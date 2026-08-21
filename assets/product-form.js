import { Component } from "@theme/component";
import {
  CartAddEvent,
  CartErrorEvent,
  CartGroupedSections,
  CartUpdateEvent,
  ThemeEvents,
  VariantUpdateEvent,
} from "@theme/events";
import { fetchConfig } from "@theme/utilities";

/**
 * A custom element that manages an add to cart button.
 *
 * @typedef {object} AddToCartRefs
 * @property {HTMLButtonElement} addToCartButton - The add to cart button.
 * @extends Component<AddToCartRefs>
 */
export class AddToCartComponent extends Component {
  requiredRefs = ["addToCartButton"];

  connectedCallback() {
    // Listen for cart add events to remove loading state
    document.addEventListener(CartAddEvent.eventName, this.#onCartAddDone.bind(this));

    // Listen for cart error events to remove loading state
    document.addEventListener(CartErrorEvent.eventName, this.#onCartAddDone.bind(this));

    super.connectedCallback();
  }

  disconnectedCallback() {
    // Remove event listeners
    document.removeEventListener(CartAddEvent.eventName, this.#onCartAddDone.bind(this));
    document.removeEventListener(CartErrorEvent.eventName, this.#onCartAddDone.bind(this));
    super.disconnectedCallback();
  }

  /**
   * Disables the add to cart button.
   */
  disable() {
    this.refs.addToCartButton.disabled = true;
  }

  /**
   * Enables the add to cart button.
   */
  enable() {
    this.refs.addToCartButton.disabled = false;
  }

  /**
   * Adds loading class to the add to cart button.
   */
  addLoading() {
    this.refs.addToCartButton.classList.add("btn--loading");
    this.refs.addToCartSpinner.classList.remove("hidden");
  }

  /**
   * Removes loading class from the add to cart button.
   */
  removeLoading() {
    this.refs.addToCartButton.classList.remove("btn--loading");
    this.refs.addToCartSpinner.classList.add("hidden");
  }

  /**
   * Handles cart add completion (success or error).
   * Removes loading state from the button.
   */
  #onCartAddDone() {
    this.removeLoading();
  }
}

if (!customElements.get("add-to-cart-component")) {
  customElements.define("add-to-cart-component", AddToCartComponent);
}

/**
 * A custom element that manages a product form.
 *
 * @typedef {object} ProductFormRefs
 * @property {HTMLInputElement} variantId - The form input for submitting the variant ID.
 * @property {AddToCartComponent | undefined} addToCartButtonContainer - The add to cart button container element.
 * @property {HTMLElement | undefined} addToCartTextError - The add to cart text error.
 * @property {HTMLElement | undefined} acceleratedCheckoutButtonContainer - The accelerated checkout button container element.
 * @property {HTMLElement} liveRegion - The live region.
 *
 * @extends Component<ProductFormRefs>
 */
class ProductFormComponent extends Component {
  requiredRefs = ["variantId", "liveRegion"];
  #abortController = new AbortController();

  /** @type {number | undefined} */
  #timeout;

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    const target = this.closest(".shopify-section, dialog, product-card");
    target?.addEventListener(ThemeEvents.variantUpdate, this.#onVariantUpdate, {
      signal,
    });
    target?.addEventListener(ThemeEvents.variantSelected, this.#onVariantSelected, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
  }

  /**
   * Dispatches {@link CartGroupedSections} and returns unique section ids for cart `sections` params.
   *
   * @returns {string[]}
   */
  #gatherGroupedSectionIds() {
    const sections = [];
    document.dispatchEvent(new CartGroupedSections(sections));
    return [...new Set(sections)];
  }

  /**
   * Handles the submit event for the product form.
   *
   * @param {Event} event - The submit event.
   */
  handleSubmit(event) {
    const { addToCartTextError } = this.refs;
    // Stop default behaviour from the browser
    event.preventDefault();

    if (this.#timeout) clearTimeout(this.#timeout);

    // Check if the add to cart button is disabled and do an early return if it is
    if (this.refs.addToCartButtonContainer?.refs.addToCartButton?.getAttribute("disabled") === "true") return;

    // Add loading state to the add to cart button
    this.refs.addToCartButtonContainer?.addLoading();

    // Send the add to cart information to the cart
    const form = this.querySelector("form");

    if (!form) throw new Error("Product form element missing");

    const formData = new FormData(form);

    const groupedSectionIds = this.#gatherGroupedSectionIds();
    if (groupedSectionIds.length > 0) {
      formData.append("sections", groupedSectionIds.join(","));
    }

    const fetchCfg = fetchConfig("javascript", { body: formData });

    fetch(FoxTheme.routes.cart_add_url, {
      ...fetchCfg,
      headers: {
        ...fetchCfg.headers,
        Accept: "text/html",
      },
    })
      .then((response) => response.json())
      .then((response) => {
        if (response.status) {
          this.dispatchEvent(
            new CartErrorEvent(form.getAttribute("id") || "", response.message, response.description, response.errors)
          );

          document.dispatchEvent(
            new CustomEvent(ThemeEvents.productAjaxError, {
              detail: { errorMessage: response.description || response.message },
            })
          );

          this.refs.addToCartButtonContainer?.removeLoading();

          if (!addToCartTextError) return;

          // Clear existing timeout to reset the 5s timer
          if (this.#timeout) {
            clearTimeout(this.#timeout);
          }

          // Set error message (replaces any existing message)
          addToCartTextError.textContent = response.description || response.message;
          addToCartTextError.classList.remove("hidden");

          // Announce error for screen readers
          this.#setLiveRegionText(response.message);

          // Hide error message after 5 seconds
          this.#timeout = setTimeout(() => {
            if (!addToCartTextError) return;
            addToCartTextError.classList.add("hidden");
            this.#clearLiveRegionText();
          }, 5000);

          // When error occurs (e.g. adding more items than available),
          // backend still adds the max allowed amount to cart.
          // Dispatch CartUpdateEvent with actual count for cart count sync.
          if (response.sections) {
            let actualItemCount = 0;
            let foundCount = false;

            for (const section of Object.values(response.sections)) {
              const tempDiv = document.createElement("div");
              tempDiv.innerHTML = section;

              // Try cart-items ref first, fallback to cart-count bubble
              let itemCountElement = tempDiv.querySelector('[ref="cartItemCount"]');
              if (!itemCountElement) {
                itemCountElement = tempDiv.querySelector(".cart-bubble__text-count");
              }

              if (itemCountElement) {
                actualItemCount = parseInt(itemCountElement.textContent || "0", 10);
                foundCount = true;
                break;
              }
            }
            if (foundCount) {
              this.dispatchEvent(
                new CartUpdateEvent({}, this.id, {
                  itemCount: actualItemCount,
                  source: "product-form-component",
                  productId: this.dataset.productId,
                  sections: response.sections,
                })
              );
            }
          } else {
            // Shopify doesn't return sections on 422 errors
            // Fetch cart.js AND section HTML in parallel for instant morph
            const sectionsData = {};
            const sectionPromises = this.#gatherGroupedSectionIds().map(async (sectionId) => {
              const sectionUrl = `${window.location.pathname.split("?")[0]}?section_id=${sectionId}`;
              const res = await fetch(sectionUrl);
              sectionsData[sectionId] = await res.text();
            });

            const cartPromise = fetch(FoxTheme.routes.cart).then((res) => res.json());

            Promise.all([cartPromise, ...sectionPromises])
              .then(([cart]) => {
                this.dispatchEvent(
                  new CartUpdateEvent(cart, this.id, {
                    itemCount: cart.item_count || 0,
                    source: "product-form-component",
                    productId: this.dataset.productId,
                    sections: Object.keys(sectionsData).length > 0 ? sectionsData : undefined,
                  })
                );
              })
              .catch((error) => {
                console.error("Failed to fetch cart count:", error);
              });
          }

          return;
        } else {
          const id = formData.get("id");

          if (addToCartTextError) {
            addToCartTextError.classList.add("hidden");
            addToCartTextError.removeAttribute("aria-live");
          }

          if (!id) throw new Error("Form ID is required");

          // Add aria-live region to inform screen readers that the item was added
          if (this.refs.addToCartButtonContainer?.refs.addToCartButton) {
            const addedText = FoxTheme.translations.added;
            this.#setLiveRegionText(addedText);

            setTimeout(() => {
              this.#clearLiveRegionText();
            }, 5000);
          }

          this.dispatchEvent(
            new CartAddEvent(response, id.toString(), {
              source: "product-form-component",
              itemCount: Number(formData.get("quantity")) || Number(this.dataset.quantityDefault),
              productId: this.dataset.productId,
              sections: response.sections,
            })
          );

          document.dispatchEvent(
            new CustomEvent(ThemeEvents.productAjaxAdded, {
              detail: { product: response },
            })
          );
        }
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        // add more thing to do in here if needed.
        // cartPerformance.measureFromEvent("add:user-action", event);
      });
  }

  /**
   * @param {*} text
   */
  #setLiveRegionText(text) {
    const liveRegion = this.refs.liveRegion;
    liveRegion.textContent = text;
  }

  #clearLiveRegionText() {
    const liveRegion = this.refs.liveRegion;
    liveRegion.textContent = "";
  }

  /**
   * @param {VariantUpdateEvent} event
   */
  #onVariantUpdate = (event) => {
    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (event.detail.data.productId !== this.dataset.productId) {
      return;
    }

    const { variantId, addToCartButtonContainer } = this.refs;

    const currentAddToCartButton = addToCartButtonContainer?.refs.addToCartButton;

    if (!currentAddToCartButton) return;

    // Update the button state and text optimistically (always do this, even from cache)
    const variant = event.detail.resource;
    const isAvailable = variant?.available ?? false;

    // Determine correct unavailable state
    // Sold out: Has inventory management (shopify) → inventory = 0
    // Unavailable: No inventory management OR variant is null/undefined → other reasons
    const isSoldOut = !isAvailable && variant && variant.inventory_management === "shopify";

    if (!isAvailable) {
      addToCartButtonContainer.disable();
      this.refs.acceleratedCheckoutButtonContainer?.setAttribute("hidden", "true");
    } else {
      addToCartButtonContainer.enable();
      this.refs.acceleratedCheckoutButtonContainer?.removeAttribute("hidden");
    }

    // Update button text optimistically (works for both available and unavailable)
    // This handles ALL cases: cache hit, JSON fetch, and HTML fallback
    this.#updateButtonTextOptimistic(currentAddToCartButton, isAvailable, isSoldOut);

    // Update the variant ID (always do this)
    if (event.detail.resource?.id) {
      variantId.value = event.detail.resource.id ?? "";
    } else {
      variantId.value = "";
    }
  };

  /**
   * Updates button text optimistically based on variant availability
   * @param {HTMLElement} button - The add to cart button element
   * @param {boolean} isAvailable - Whether the variant is available
   * @param {boolean} isSoldOut - Whether the variant is sold out (has inventory_management = "shopify")
   */
  #updateButtonTextOptimistic(button, isAvailable, isSoldOut = false) {
    if (!button) return;

    const textElement = button.querySelector(".add-to-cart-text__content");
    const iconTextElement = button.querySelector(".btn__icon-text");

    if (!textElement) return;

    // Get text from data attributes (translations from Liquid)
    const availableText = button.dataset.addToCartText || "Add to cart";
    const soldOutText = button.dataset.soldOutText || "Sold out";
    const unavailableText = button.dataset.unavailableText || "Unavailable";

    // Determine correct text based on state
    // - Available: variant.available = true → "Add to cart"
    // - Sold out: variant.available = false + inventory_management = "shopify" → "Sold out"
    // - Unavailable: variant.available = false + no inventory_management → "Unavailable"
    let newText;
    if (isAvailable) {
      newText = availableText;
    } else if (isSoldOut) {
      newText = soldOutText;
    } else {
      newText = unavailableText;
    }

    // Update both text content and icon text (if present)
    textElement.textContent = newText;
    if (iconTextElement) {
      iconTextElement.textContent = newText;
    }
  }

  /**
   * Disable the add to cart button while the UI is updating before #onVariantUpdate is called.
   * Accelerated checkout button is also disabled via its own event listener not exposed to the theme.
   */
  #onVariantSelected = () => {
    this.refs.addToCartButtonContainer?.disable();
  };
}

if (!customElements.get("product-form-component")) {
  customElements.define("product-form-component", ProductFormComponent);
}
