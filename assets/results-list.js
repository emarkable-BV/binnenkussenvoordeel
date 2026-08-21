import { requestIdleCallback } from "@theme/utilities";
import PaginatedList from "@theme/paginated-list";

/**
 * A custom element that renders a pagniated results list
 */
export default class ResultsList extends PaginatedList {
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("initialized", "");
  }

  disconnectedCallback() {}

  /**
   * Updates the layout.
   *
   * @param {Event} event
   */
  updateLayout({ target }) {
    if (!(target instanceof HTMLInputElement)) return;

    this.#setLayout(target.value);
  }

  toggleFiltering() {
    const isOpen = this.getAttribute("show-filtering") === "true";
    this.setAttribute("show-filtering", !isOpen);
  }

  /**
   * Sets the layout.
   *
   * @param {string} value
   */
  #setLayout(value) {
    const { grid } = this.refs;
    if (!grid) return;

    grid.setAttribute("product-grid-view", value);

    requestIdleCallback(() => {
      sessionStorage.setItem(`product-grid-view`, value);
    });
  }
}

if (!customElements.get("results-list")) {
  customElements.define("results-list", ResultsList);
}
