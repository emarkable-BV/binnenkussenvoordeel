import { Component } from "@theme/component";
import { morphSection } from "@theme/section-renderer";
import { DiscountUpdateEvent } from "@theme/events";
import { fetchConfig } from "@theme/utilities";

/**
 * A custom element that applies a discount to the cart.
 *
 * @typedef {Object} CartDiscountComponentRefs
 * @property {HTMLElement} cartDiscountError - The error element.
 * @property {HTMLElement} cartDiscountErrorDiscountCode - The discount code error element.
 * @property {HTMLElement} cartDiscountErrorShipping - The shipping error element.
 */

/**
 * @extends {Component<CartDiscountComponentRefs>}
 */
class CartDiscount extends Component {
  requiredRefs = [
    "cartDiscountError",
    "cartDiscountErrorDiscountCode",
    "cartDiscountErrorShipping",
  ];

  /** @type {AbortController | null} */
  #activeFetch = null;

  updatedCallback() {
    super.updatedCallback();

    // Cleanup any pending fetch if morph occurs during an active request
    // This ensures component is in a clean state after DOM morph
    if (this.#activeFetch) {
      this.#activeFetch.abort();
      this.#activeFetch = null;
    }

    // Reset button loading state after morph (if button exists)
    if (this.refs.cartDiscountButton) {
      this.#toggleButtonLoading(false);
    }
  }

  #createAbortController() {
    if (this.#activeFetch) {
      this.#activeFetch.abort();
    }

    const abortController = new AbortController();
    this.#activeFetch = abortController;
    return abortController;
  }

  /**
   * Handles updates to the cart note.
   * @param {SubmitEvent} event - The submit event on our form.
   */
  applyDiscount = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const discountCode = form.querySelector('input[name="discount"]');
    if (!(discountCode instanceof HTMLInputElement) || typeof this.dataset.sectionId !== "string")
      return;

    const {
      cartDiscountError,
      cartDiscountErrorDiscountCode,
      cartDiscountErrorShipping,
      cartDiscountErrorExists,
      cartDiscountButton,
    } = this.refs;

    if (cartDiscountButton.getAttribute("disabled")) {
      return;
    }

    cartDiscountError.classList.add("hidden");
    cartDiscountErrorDiscountCode.classList.add("hidden");
    cartDiscountErrorShipping.classList.add("hidden");
    cartDiscountErrorExists.classList.add("hidden");

    const discountCodeValue = discountCode.value.trim().toLowerCase();

    const abortController = this.#createAbortController();

    try {
      const existingDiscounts = this.#existingDiscounts();
      const existingDiscountsLS = existingDiscounts.map((code) => code.trim().toLowerCase());
      if (existingDiscountsLS.includes(discountCodeValue)) {
        this.#handleDiscountErrorExists();
        return;
      }

      this.#toggleButtonLoading(true);

      const config = fetchConfig("json", {
        body: JSON.stringify({
          discount: [...existingDiscounts, discountCodeValue].join(","),
          sections: [this.dataset.sectionId],
        }),
      });

      const response = await fetch(FoxTheme.routes.cart_update_url, {
        ...config,
        signal: abortController.signal,
      });

      const data = await response.json();

      this.#toggleButtonLoading(false);

      if (
        data.discount_codes.find(
          (/** @type {{ code: string; applicable: boolean; }} */ discount) => {
            return discount.code === discountCodeValue && discount.applicable === false;
          }
        )
      ) {
        discountCode.value = "";
        this.#handleDiscountError("discount_code");
        return;
      }

      const newHtml = data.sections[this.dataset.sectionId];
      const parsedHtml = new DOMParser().parseFromString(newHtml, "text/html");
      const section = parsedHtml.getElementById(`shopify-section-${this.dataset.sectionId}`);
      const discountCodes = section?.querySelectorAll(".cart-discount__pill") || [];
      if (section) {
        const codes = Array.from(discountCodes)
          .map((element) =>
            element instanceof HTMLLIElement ? element.dataset.discountCode : null
          )
          .filter(Boolean);
        // Before morphing, we need to check if the shipping discount is applicable in the UI
        // we check the liquid logic compared to the cart payload to assess whether we leveraged
        // a valid shipping discount code.
        if (
          codes.length === existingDiscounts.length &&
          codes.every((/** @type {string} */ code) => existingDiscounts.includes(code)) &&
          data.discount_codes.find(
            (/** @type {{ code: string; applicable: boolean; }} */ discount) => {
              return discount.code === discountCodeValue && discount.applicable === true;
            }
          )
        ) {
          this.#handleDiscountError("shipping");
          discountCode.value = "";
          return;
        }
      }

      document.dispatchEvent(new DiscountUpdateEvent(data, this.dataset.sectionId));
      morphSection(this.dataset.sectionId, newHtml);
    } catch (error) {
    } finally {
      this.#activeFetch = null;
      // cartPerformance.measureFromEvent("discount-update:user-action", event);
    }
  };

  /**
   * Handles removing a discount from the cart.
   * @param {MouseEvent | KeyboardEvent} event - The mouse or keyboard event in our pill.
   */
  removeDiscount = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (
      (event instanceof KeyboardEvent && event.key !== "Enter") ||
      !(event instanceof MouseEvent) ||
      !(event.target instanceof HTMLElement) ||
      typeof this.dataset.sectionId !== "string"
    ) {
      return;
    }

    const pill = event.target.closest(".cart-discount__pill");
    if (!(pill instanceof HTMLLIElement)) return;

    const discountCode = pill.dataset.discountCode;
    if (!discountCode) return;

    const existingDiscounts = this.#existingDiscounts();
    const index = existingDiscounts.indexOf(discountCode);
    if (index === -1) return;

    existingDiscounts.splice(index, 1);

    const abortController = this.#createAbortController();

    try {
      const config = fetchConfig("json", {
        body: JSON.stringify({
          discount: existingDiscounts.join(","),
          sections: [this.dataset.sectionId],
        }),
      });

      const response = await fetch(FoxTheme.routes.cart_update_url, {
        ...config,
        signal: abortController.signal,
      });

      const data = await response.json();

      document.dispatchEvent(new DiscountUpdateEvent(data, this.dataset.sectionId));
      morphSection(this.dataset.sectionId, data.sections[this.dataset.sectionId]);
    } catch (error) {
    } finally {
      this.#activeFetch = null;
    }
  };

  /**
   * Handles the discount error.
   *
   * @param {'discount_code' | 'shipping'} type - The type of discount error.
   */
  #handleDiscountError(type) {
    const { cartDiscountError, cartDiscountErrorDiscountCode, cartDiscountErrorShipping } =
      this.refs;
    const target =
      type === "discount_code" ? cartDiscountErrorDiscountCode : cartDiscountErrorShipping;
    cartDiscountError.classList.remove("hidden");
    target.classList.remove("hidden");
  }

  #handleDiscountErrorExists() {
    const { cartDiscountErrorExists, cartDiscountError } = this.refs;
    cartDiscountError.classList.remove("hidden");
    cartDiscountErrorExists.classList.remove("hidden");
  }

  /**
   * Returns an array of existing discount codes.
   * @returns {string[]}
   */
  #existingDiscounts() {
    /** @type {string[]} */
    const discountCodes = [];
    const discountPills = this.querySelectorAll(".cart-discount__pill");
    for (const pill of discountPills) {
      if (pill instanceof HTMLLIElement && typeof pill.dataset.discountCode === "string") {
        discountCodes.push(pill.dataset.discountCode);
      }
    }

    return discountCodes;
  }

  #toggleButtonLoading(isLoading = true) {
    const { cartDiscountButton } = this.refs;

    cartDiscountButton.classList.toggle("btn--loading", isLoading);

    if (isLoading) {
      cartDiscountButton.setAttribute("disabled", true);
    } else {
      cartDiscountButton.removeAttribute("disabled");
    }
  }
}

if (!customElements.get("cart-discount")) {
  customElements.define("cart-discount", CartDiscount);
}
