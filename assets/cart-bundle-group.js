/**
 * For every cart line belonging to a product family (a bundle product, or
 * a standalone product — same styling either way, even at quantity 1),
 * replaces that line's own native quantity selector with a compact +/-
 * stepper showing that line's own pillow count — each pack size keeps its
 * own independent counter; different pack sizes of the same product are
 * never added together into one number. The main row itself is left
 * otherwise untouched (title, image, price all stay).
 *
 * Clicking +/- still calls
 * `cart-items-component#onFamilyPillowAdjust(sku, delta)`, which recomposes
 * the *whole family's* total (summed across every line belonging to it) by
 * that delta into the fewest lines / best bundle mix — the auto-combine
 * behaviour keeps working in the background, it just isn't reflected as one
 * merged number in the UI.
 *
 * Must live outside `<table>` in the DOM (a custom element as a direct
 * table-parsing-context child gets foster-parented out by the HTML parser),
 * so it wraps `cart-products.liquid`'s existing `.cart-items` container
 * instead of the `<tbody>`.
 */
class CartBundleGroup extends HTMLElement {
  #observer;
  #rendering = false;

  connectedCallback() {
    this.#render();
    this.#observer = new MutationObserver(() => this.#render());
    this.#observer.observe(this, {
      childList: true,
      subtree: true,
      attributes: true,
      // "class" is included because morphSection patches row attributes back
      // to match the server-rendered HTML on every cart change, silently
      // stripping classes we add client-side (e.g. the family-divider line,
      // the hidden-native-selector class) — this is what tells us to
      // re-apply them, not just quantity changes.
      attributeFilter: ["data-quantity", "class"],
    });
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
  }

  #render() {
    if (this.#rendering) return;
    this.#rendering = true;
    try {
      this.#renderInner();
    } finally {
      this.#rendering = false;
    }
  }

  #renderInner() {
    const rows = [...this.querySelectorAll("tr[data-bundle-family]")].filter((row) => !row.dataset.bundleGroupSummary);

    this.#sortRowsByPackSize(rows);
    this.#renderFamilyDividers();

    const qualifyingKeys = new Set(
      rows.filter((row) => (Number(row.dataset.quantity) || 0) >= 1).map((row) => row.dataset.key)
    );

    // Drop stale steppers and restore the native selector for lines that no
    // longer qualify (or are gone).
    this.querySelectorAll("[data-bundle-group-stepper]").forEach((el) => {
      if (!qualifyingKeys.has(el.dataset.bundleGroupStepper)) el.remove();
    });
    this.querySelectorAll(".cart-bundle-group__native-qty-hidden").forEach((el) => {
      const row = el.closest("tr[data-key]");
      if (!row || !qualifyingKeys.has(row.dataset.key)) el.classList.remove("cart-bundle-group__native-qty-hidden");
    });

    for (const row of rows) {
      const pillowQty = Number(row.dataset.quantity) || 0;
      if (pillowQty >= 1) this.#renderRowStepper(row, pillowQty);
    }
  }

  /**
   * Reorders same-family rows so the largest pack size is always listed
   * first (e.g. "10 stuks" above "2 stuks"), grouping the family's lines
   * together in the process. Other products' relative order is untouched.
   * @param {HTMLTableRowElement[]} rows
   */
  #sortRowsByPackSize(rows) {
    const byFamily = new Map();
    for (const row of rows) {
      const family = row.dataset.bundleFamily;
      if (!byFamily.has(family)) byFamily.set(family, []);
      byFamily.get(family).push(row);
    }

    for (const familyRows of byFamily.values()) {
      if (familyRows.length < 2) continue;

      const sorted = [...familyRows].sort(
        (a, b) => (Number(b.dataset.packSize) || 0) - (Number(a.dataset.packSize) || 0)
      );
      if (sorted.every((row, i) => row === familyRows[i])) continue;

      let insertAfter = familyRows[0].previousElementSibling;
      for (const row of sorted) {
        if (insertAfter) {
          insertAfter.after(row);
        } else {
          row.closest("tbody")?.prepend(row);
        }
        insertAfter = row;
      }
    }
  }

  /**
   * Inserts a standalone divider row above every row once its predecessor
   * is known — a plain solid line between two distinct products (SKU
   * family, or the SKU itself for a product with no bundle siblings), e.g.
   * between a group of "50x50" lines and the next group of "30x50" lines;
   * a lighter dashed line between two lines of the *same* family, e.g.
   * between a "10 stuks" line and that family's own "2 stuks" line. A
   * dedicated row (rather than a border class on the existing row)
   * sidesteps that row's own CSS Grid layout and morphSection patching its
   * attributes back.
   */
  #renderFamilyDividers() {
    const allRows = [...this.querySelectorAll("tr[data-key]")].filter((row) => !row.dataset.bundleGroupDivider);

    let previousFamily = null;
    for (const row of allRows) {
      const family = row.dataset.bundleFamily || row.dataset.key;
      const needsDivider = previousFamily !== null;
      const isSameFamily = needsDivider && family === previousFamily;
      const existingDivider = row.previousElementSibling?.dataset?.bundleGroupDivider ? row.previousElementSibling : null;

      if (needsDivider) {
        if (!existingDivider) {
          const divider = document.createElement("tr");
          divider.dataset.bundleGroupDivider = "true";
          const dividerClass = isSameFamily
            ? "cart-bundle-group__divider cart-bundle-group__divider--same-family"
            : "cart-bundle-group__divider";
          divider.innerHTML = `<td class="cart-bundle-group__divider-cell"><hr class="${dividerClass}"></td>`;
          row.before(divider);
        } else {
          existingDivider
            .querySelector(".cart-bundle-group__divider")
            ?.classList.toggle("cart-bundle-group__divider--same-family", isSameFamily);
        }
      } else if (existingDivider) {
        existingDivider.remove();
      }

      previousFamily = family;
    }
  }

  /**
   * @param {HTMLTableRowElement} row - The real, still-visible product line.
   * @param {number} pillowQty - This row's own pillow count (its box quantity times its pack size).
   */
  #renderRowStepper(row, pillowQty) {
    const lineKey = row.dataset.key;
    const quantityWrap = row.querySelector(".cart-items__quantity-wrap");
    const nativeSelector = quantityWrap?.querySelector("quantity-selector-component");
    if (!quantityWrap || !nativeSelector) return;

    // Guard with .contains() before .add(): per the DOM spec, classList.add()
    // still queues an attribute mutation even when the class is already
    // present, which — since this runs on every render pass and "class" is
    // in our own MutationObserver's attributeFilter — created an infinite
    // render loop (this observer fires -> re-adds the class -> new mutation
    // queued -> observer fires again -> ...), freezing the page.
    if (!nativeSelector.classList.contains("cart-bundle-group__native-qty-hidden")) {
      nativeSelector.classList.add("cart-bundle-group__native-qty-hidden");
    }

    let stepper = quantityWrap.querySelector(`[data-bundle-group-stepper="${CSS.escape(lineKey)}"]`);
    if (!stepper) {
      stepper = this.#buildStepper(nativeSelector, lineKey);
      nativeSelector.after(stepper);
    } else if (stepper.previousElementSibling !== nativeSelector) {
      // Keep it directly beside the native selector even if morphing reordered things.
      nativeSelector.after(stepper);
    }

    const valueEl = stepper.querySelector("[data-bundle-group-stepper-value]");
    if (valueEl && valueEl.textContent !== String(pillowQty)) valueEl.textContent = String(pillowQty);
  }

  /**
   * @param {Element} nativeSelector - The native selector this stepper replaces; its
   *   icons are cloned (whole `.icon` span, not just the inner `<svg>`, since the
   *   span carries the sizing/color classes the icon needs to actually be visible)
   *   so the stepper matches the theme's icon set with no hardcoding.
   * @param {string} lineKey
   */
  #buildStepper(nativeSelector, lineKey) {
    const minusIcon = nativeSelector.querySelector(".quantity-minus .icon")?.cloneNode(true);
    const plusIcon = nativeSelector.querySelector(".quantity-plus .icon")?.cloneNode(true);

    const wrapper = document.createElement("div");
    wrapper.className = "cart-bundle-group__stepper-wrap inline-flex items-center";
    wrapper.dataset.bundleGroupStepper = lineKey;

    const label = document.createElement("span");
    label.className = "cart-bundle-group__stepper-label";
    label.textContent = "Aantal kussens:";

    const stepper = document.createElement("div");
    stepper.className = "cart-bundle-group__stepper quantity-selector relative inline-flex min-w-0";
    stepper.dataset.context = "cart-items";

    const minusButton = document.createElement("button");
    minusButton.type = "button";
    minusButton.className =
      "quantity-minus quantity-button button-unstyled absolute flex items-center justify-center text-center cursor-pointer";
    minusButton.setAttribute("aria-label", "Verwijder 1 kussen");
    if (minusIcon) minusButton.appendChild(minusIcon);
    minusButton.addEventListener("click", (event) => this.#onStepperClick(event, lineKey, -1));

    const value = document.createElement("span");
    value.className = "quantity-input w-full text-center min-w-0";
    value.setAttribute("aria-live", "polite");
    value.dataset.bundleGroupStepperValue = "";

    const plusButton = document.createElement("button");
    plusButton.type = "button";
    plusButton.className =
      "quantity-plus quantity-button button-unstyled absolute flex items-center justify-center text-center cursor-pointer";
    plusButton.setAttribute("aria-label", "Voeg 1 kussen toe");
    if (plusIcon) plusButton.appendChild(plusIcon);
    plusButton.addEventListener("click", (event) => this.#onStepperClick(event, lineKey, 1));

    stepper.append(minusButton, value, plusButton);
    wrapper.append(label, stepper);
    return wrapper;
  }

  /**
   * @param {MouseEvent} event
   * @param {string} lineKey
   * @param {number} delta
   */
  #onStepperClick(event, lineKey, delta) {
    event.preventDefault();
    const stepper = /** @type {HTMLElement} */ (event.currentTarget).closest("[data-bundle-group-stepper]");
    if (!stepper || stepper.classList.contains("cart-bundle-group__stepper-loading")) return;
    stepper.classList.add("cart-bundle-group__stepper-loading");

    const cartItemsComponent = this.closest("cart-items-component");
    const sku = this.querySelector(`tr[data-key="${CSS.escape(lineKey)}"]`)?.dataset.sku;

    if (typeof cartItemsComponent?.onFamilyPillowAdjust !== "function" || !sku) {
      stepper.classList.remove("cart-bundle-group__stepper-loading");
      return;
    }

    cartItemsComponent.onFamilyPillowAdjust(sku, delta).finally(() => {
      stepper.classList.remove("cart-bundle-group__stepper-loading");
    });
  }
}

if (!customElements.get("cart-bundle-group")) {
  customElements.define("cart-bundle-group", CartBundleGroup);
}
