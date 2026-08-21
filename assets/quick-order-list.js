import { Component } from "@theme/component";
import { CartGroupedSections, CartUpdateEvent, ThemeEvents } from "@theme/events";
import { morph } from "@theme/morph";
import { buildSectionSelector, morphSection } from "@theme/section-renderer";
import { debounce, fetchConfig } from "@theme/utilities";

class QuickOrderListComponent extends Component {
  #debouncedUpdate = debounce(this.#runUpdate.bind(this), 300);
  #pendingUpdates = new Map();
  #errorTimeout = 5000;

  /** @type {AbortController | undefined} */
  #abortController;

  connectedCallback() {
    super.connectedCallback();

    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    // Listen on `this` (not document) so we can stop propagation before
    // sibling cart-items handlers receive it.
    this.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#onQuantityChange, { signal });
    document.addEventListener(ThemeEvents.cartUpdate, this.#onExternalCartUpdate, { signal });
    document.addEventListener(CartGroupedSections.eventName, this.#onGroupedSections, { signal });
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = undefined;
    super.disconnectedCallback();
  }

  /**
   * Synchronously buffers the change and stops the event from reaching the
   * cart-items component. The actual cart mutation is debounced.
   *
   * @param {CustomEvent<{ quantity: number, cartLine?: number }>} event
   */
  #onQuantityChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest("[data-variant-id]");
    if (!(row instanceof HTMLElement) || !this.contains(row)) return;

    event.stopPropagation();

    const variantId = row.dataset.variantId;
    if (!variantId) return;

    this.#pendingUpdates.set(variantId, {
      row,
      quantity: event.detail.quantity,
    });

    this.#debouncedUpdate();
  };

  /**
   * Removes a single variant from the cart.
   * Bound to the per-row remove button via `on:click="/onRemoveVariant/{variantId}"`.
   *
   * @param {number | string} variantId - Parsed from the on:click data segment.
   * @param {Event} [event]
   */
  onRemoveVariant(variantId, event) {
    event?.preventDefault?.();

    const id = String(variantId);
    const row = this.#getRows().find((r) => r.dataset.variantId === id);
    if (!row) return;

    this.#pendingUpdates.set(id, { row, quantity: 0 });
    this.#debouncedUpdate.cancel();
    this.#runUpdate();
  }

  /**
   * Drains the pending updates buffer and POSTs to /cart/update.js.
   */
  async #runUpdate() {
    if (this.#pendingUpdates.size === 0) return;

    const updates = {};
    const rows = [];
    for (const [variantId, payload] of this.#pendingUpdates) {
      updates[variantId] = payload.quantity;
      rows.push(payload.row);
    }
    this.#pendingUpdates.clear();

    rows.forEach((row) => this.#setRowLoading(row, true));
    rows.forEach((row) => this.#hideRowError(row.dataset.variantId));

    const sectionsToUpdate = this.#gatherGroupedSectionIds();
    const body = JSON.stringify({
      updates,
      sections: sectionsToUpdate.join(","),
      sections_url: window.location.pathname,
    });

    try {
      const response = await fetch(`${FoxTheme.routes.cart_update_url}`, fetchConfig("json", { body }));
      const data = await response.json();

      if (data.errors) {
        const message = typeof data.errors === "string" ? data.errors : Object.values(data.errors).join(" ");

        // Without per-line targeting, surface the error in the aside.
        this.#showError(message);
        return;
      }

      this.#applyResponse(data);
    } catch (error) {
      console.error("[quick-order-list] update error:", error);
      this.#showError(this.#defaultErrorMessage());
    } finally {
      rows.forEach((row) => this.#setRowLoading(row, false));
    }
  }

  /** @param {CartGroupedSections} event */
  #onGroupedSections = (event) => {
    event.detail.sections.push(this.sectionId);
  };

  /**
   * Dispatches {@link CartGroupedSections} and returns unique section ids for cart `sections` params.
   * @returns {string[]}
   */
  #gatherGroupedSectionIds() {
    const sections = [];
    document.dispatchEvent(new CartGroupedSections(sections));
    return [...new Set(sections)];
  }

  /**
   * Listens for cart updates triggered by other components (cart-items in the
   * drawer, product forms, etc.) and re-morphs this section so totals stay
   * in sync. Skips updates we just dispatched ourselves.
   *
   * @param {CartUpdateEvent} event
   */
  #onExternalCartUpdate = (event) => {
    if (event.detail?.data?.source === "quick-order-list") return;

    const sections = event.detail?.data?.sections;
    if (sections && sections[this.sectionId]) {
      morphSection(this.sectionId, sections[this.sectionId]);
    }
  };

  /**
   * "Remove all" confirmation flow toggles.
   */
  onRequestRemoveAll() {
    this.refs.totalInfo?.classList.add("hidden");
    this.refs.confirmation?.classList.remove("hidden");
  }

  onCancelRemoveAll() {
    this.refs.totalInfo?.classList.remove("hidden");
    this.refs.confirmation?.classList.add("hidden");
  }

  async onConfirmRemoveAll() {
    const updates = {};
    let touched = 0;
    this.#getRows().forEach((row) => {
      const variantId = row.dataset.variantId;
      const cartQuantity = Number(row.dataset.cartQuantity || 0);
      if (variantId && cartQuantity > 0) {
        updates[variantId] = 0;
        touched++;
      }
    });

    if (touched === 0) {
      this.onCancelRemoveAll();
      return;
    }

    const sectionsToUpdate = this.#gatherGroupedSectionIds();
    const body = JSON.stringify({
      updates,
      sections: sectionsToUpdate.join(","),
      sections_url: window.location.pathname,
    });

    this.classList.add("is-loading");
    try {
      const response = await fetch(`${FoxTheme.routes.cart_update_url}`, fetchConfig("json", { body }));
      const data = await response.json();

      if (data.errors) {
        const message = typeof data.errors === "string" ? data.errors : this.#defaultErrorMessage();
        this.#showError(message);
        return;
      }

      this.#applyResponse(data);
    } catch (error) {
      console.error("[quick-order-list] remove-all error:", error);
      this.#showError(this.#defaultErrorMessage());
    } finally {
      this.classList.remove("is-loading");
    }
  }

  /**
   * Reconciles this element with the server-rendered quick-order list from the
   * section HTML (same as morphSection, but scoped to the component to avoid
   * re-morphing the whole section wrapper).
   *
   * @param {string} html - Section HTML from cart/update `sections` payload.
   * @returns {boolean} True when morph ran; false to fall back to morphSection.
   */
  #morphQuickOrderFromSectionHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nextComponent = doc
      .getElementById(buildSectionSelector(this.sectionId))
      ?.querySelector("quick-order-list-component");
    if (!nextComponent) return false;

    morph(this, nextComponent);
    return true;
  }

  /**
   * Morphs every section returned by /cart/update.js and notifies sibling
   * components via CartUpdateEvent so they can refresh too.
   *
   * @param {object} data - Parsed cart response.
   */
  #applyResponse(data) {
    if (!data?.sections) return;

    const ownSid = this.sectionId;
    let didMorphOwn = false;
    const ownHtml = data.sections[ownSid];

    if (ownHtml) {
      try {
        didMorphOwn = this.#morphQuickOrderFromSectionHtml(ownHtml);
      } catch (e) {
        console.warn("[quick-order-list] component morph failed, using full section morph", e);
        didMorphOwn = false;
      }
    }

    Object.keys(data.sections).forEach((sid) => {
      if (didMorphOwn && sid === ownSid) return;
      morphSection(sid, data.sections[sid]);
    });

    document.dispatchEvent(
      new CartUpdateEvent(data, this.sectionId, {
        itemCount: data.item_count,
        source: "quick-order-list",
        sections: data.sections,
      })
    );

    document.dispatchEvent(new CustomEvent(ThemeEvents.cartUpdated, { detail: { cart: data } }));
  }

  /** @returns {HTMLElement[]} */
  #getRows() {
    const rows = this.refs.variantRows;
    if (!rows) return [];
    return Array.isArray(rows) ? rows : [rows];
  }

  /**
   * @param {HTMLElement} row
   * @param {boolean} isLoading
   */
  #setRowLoading(row, isLoading) {
    row.classList.toggle("is-loading", isLoading);

    row.querySelectorAll(".quick-order-list__remove").forEach((btn) => {
      btn.classList.toggle("btn--loading", isLoading);
    });
  }

  /**
   * @param {string | undefined} variantId
   */
  #hideRowError(variantId) {
    if (!variantId) return;
    const errorRow = this.#findErrorRow(variantId);
    if (errorRow) errorRow.hidden = true;
  }

  /**
   * @param {string} variantId
   * @returns {HTMLElement | undefined}
   */
  #findErrorRow(variantId) {
    const rows = this.refs.errorRows;
    if (!rows) return undefined;
    const arr = Array.isArray(rows) ? rows : [rows];
    return arr.find((r) => r.dataset.variantId === variantId);
  }

  /**
   * @param {string} message
   */
  #showError(message) {
    const { errorContainer, errorMessage } = this.refs;
    if (!errorContainer || !errorMessage) return;

    errorMessage.textContent = message;
    errorContainer.classList.remove("hidden");

    setTimeout(() => {
      errorContainer.classList.add("hidden");
    }, this.#errorTimeout);
  }

  #defaultErrorMessage() {
    return window.FoxTheme?.translations?.cart_error || "Something went wrong. Please try again.";
  }

  /** @returns {string} */
  get sectionId() {
    const { sectionId } = this.dataset;
    if (!sectionId) throw new Error("[quick-order-list] data-section-id is missing");
    return sectionId;
  }
}

if (!customElements.get("quick-order-list-component")) {
  customElements.define("quick-order-list-component", QuickOrderListComponent);
}
