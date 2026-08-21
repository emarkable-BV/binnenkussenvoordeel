import { Component } from "@theme/component";
import { QuantitySelectorUpdateEvent } from "@theme/events";

/**
 * A custom element that allows the user to select a quantity.
 *
 * @typedef {Object} Refs
 * @property {HTMLInputElement} quantityInput
 * @property {HTMLButtonElement[]} quantityButtons
 *
 * @extends {Component<Refs>}
 */
class QuantitySelectorComponent extends Component {
  requiredRefs = ["quantityInput"];
  /** @type {boolean} */
  #hasValueChanged = false;

  /**
   * Last quantity dispatched via {@link QuantitySelectorUpdateEvent}; avoids redundant cart updates when clamp restores the same value.
   * @type {number | null}
   */
  #lastNotifiedQuantity = null;

  connectedCallback() {
    super.connectedCallback();

    // Track when user actually types in the input
    this.refs.quantityInput.addEventListener("input", () => {
      this.#hasValueChanged = true;
      this.#updateQuantityButtonStates();
    });

    this.#syncLastNotifiedFromInput();
    this.#updateQuantityButtonStates();
  }

  updatedCallback() {
    super.updatedCallback();
    this.#syncLastNotifiedFromInput();
    this.#updateQuantityButtonStates();
  }

  /**
   * Handles the quantity increase event.
   * @param {Event} event - The event.
   */
  increaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;

    event.preventDefault();
    this.refs.quantityInput.stepUp();
    this.#hasValueChanged = true;
    this.#onQuantityChange();
  }

  /**
   * Handles the quantity decrease event.
   * @param {Event} event - The event.
   */
  decreaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;

    event.preventDefault();
    this.refs.quantityInput.stepDown();
    this.#hasValueChanged = true;
    this.#onQuantityChange();
  }

  /**
   * When our input gets focused, we want to fully select the value.
   * @param {FocusEvent} event
   */
  selectInputValue(event) {
    const { quantityInput } = this.refs;
    if (!(event.target instanceof HTMLInputElement) || document.activeElement !== quantityInput) return;

    // Use setTimeout to avoid interfering with focus management
    setTimeout(() => {
      quantityInput.select();
    }, 0);

    // Reset the change flag when focusing (user might just be navigating)
    this.#hasValueChanged = false;
  }

  /**
   * Commits the quantity when the input loses focus (blur).
   * @param {FocusEvent} event - Blur event; `event.target` is the quantity input.
   */
  setQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;

    event.preventDefault();
    if (event.target instanceof HTMLInputElement) {
      const oldValue = this.refs.quantityInput.value;
      const newValue = event.target.value;

      // Only trigger change if value actually changed or was changed by user interaction
      if (oldValue !== newValue || this.#hasValueChanged) {
        this.refs.quantityInput.value = newValue;
        this.#onQuantityChange();
      }

      // Reset the flag after processing
      this.#hasValueChanged = false;
    }
  }

  /**
   * Handles the quantity change event.
   */
  #onQuantityChange() {
    const { quantityInput } = this.refs;

    this.#checkQuantityRules();
    this.#updateQuantityButtonStates();
    const newValue = parseInt(quantityInput.value, 10);

    if (Number.isFinite(newValue) && this.#lastNotifiedQuantity !== null && newValue === this.#lastNotifiedQuantity) {
      return;
    }

    if (Number.isFinite(newValue)) {
      this.#lastNotifiedQuantity = newValue;
    }

    quantityInput.dispatchEvent(new QuantitySelectorUpdateEvent(newValue, Number(quantityInput.dataset.cartLine)));
  }

  #syncLastNotifiedFromInput() {
    const n = parseInt(this.refs.quantityInput.value, 10);
    this.#lastNotifiedQuantity = Number.isFinite(n) ? n : null;
  }

  /**
   * Checks the quantity rules are met
   */
  #checkQuantityRules = () => {
    const { quantityInput } = this.refs;
    const { min, max, value: newValue } = quantityInput;

    if (min != "" && parseFloat(newValue) < parseFloat(min)) quantityInput.value = min;
    if (max != "" && parseFloat(newValue) > parseFloat(max)) quantityInput.value = max;
  };

  /**
   * Disables minus at min, plus at max, respecting input disabled.
   */
  #updateQuantityButtonStates() {
    const { quantityInput, quantityButtons } = this.refs;
    const buttons = Array.isArray(quantityButtons) ? quantityButtons : [];
    const [minusButton, plusButton] = buttons;

    if (!(minusButton instanceof HTMLButtonElement) || !(plusButton instanceof HTMLButtonElement)) return;

    const inputDisabled = quantityInput.disabled;
    const rawValue = parseFloat(quantityInput.value);

    let atMin = false;
    let atMax = false;

    if (!Number.isNaN(rawValue)) {
      const { min: minAttr, max: maxAttr } = quantityInput;
      if (minAttr !== "") {
        const minNum = parseFloat(minAttr);
        if (!Number.isNaN(minNum)) atMin = rawValue <= minNum;
      }
      if (maxAttr !== "") {
        const maxNum = parseFloat(maxAttr);
        if (!Number.isNaN(maxNum)) atMax = rawValue >= maxNum;
      }
    }

    minusButton.disabled = inputDisabled || atMin;
    plusButton.disabled = inputDisabled || atMax;
  }
}

if (!customElements.get("quantity-selector-component")) {
  customElements.define("quantity-selector-component", QuantitySelectorComponent);
}
