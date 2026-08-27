/**
 * For every cart line that represents 2+ pillows (a bundle product, or a
 * loose line with quantity 2+), appends individually removable pillow icons
 * right after that line's own quantity selector — the main row itself is
 * left otherwise untouched (title, image, price all stay). Whichever real
 * lines a product family ends up split across (`cart-items.js` keeps that
 * split to the fewest lines possible) each get their own pillow icons here.
 *
 * Removing a pillow calls `cart-items-component#onLinePillowRemove(lineKey)`,
 * which recomposes the *whole family's* total down by one pillow into the
 * fewest lines / best bundle mix.
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
      // stripping classes we add client-side (e.g. the family-divider line)
      // — this is what tells us to re-apply them, not just quantity changes.
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
      rows.filter((row) => (Number(row.dataset.quantity) || 0) >= 2).map((row) => row.dataset.key)
    );

    // Drop stale pillow containers for lines that no longer qualify (or are gone).
    this.querySelectorAll("[data-bundle-group-pillows]").forEach((el) => {
      if (!qualifyingKeys.has(el.dataset.bundleGroupPillows)) el.remove();
    });

    for (const row of rows) {
      const pillowQty = Number(row.dataset.quantity) || 0;
      if (pillowQty >= 2) this.#renderPillows(row, pillowQty);
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
   * Inserts a standalone divider row above the first row of each distinct
   * product (SKU family, or the SKU itself for a product with no bundle
   * siblings) once it differs from the previous row's — e.g. between a group
   * of "50x50" lines and the next group of "30x50" lines. A dedicated row
   * (rather than a border class on the existing row) sidesteps that row's
   * own CSS Grid layout and morphSection patching its attributes back.
   */
  #renderFamilyDividers() {
    const allRows = [...this.querySelectorAll("tr[data-key]")].filter((row) => !row.dataset.bundleGroupDivider);

    let previousFamily = null;
    for (const row of allRows) {
      const family = row.dataset.bundleFamily || row.dataset.key;
      const needsDivider = previousFamily !== null && family !== previousFamily;
      const existingDivider = row.previousElementSibling?.dataset?.bundleGroupDivider ? row.previousElementSibling : null;

      if (needsDivider && !existingDivider) {
        const divider = document.createElement("tr");
        divider.dataset.bundleGroupDivider = "true";
        divider.innerHTML = '<td class="cart-bundle-group__divider-cell"><hr class="cart-bundle-group__divider"></td>';
        row.before(divider);
      } else if (!needsDivider && existingDivider) {
        existingDivider.remove();
      }

      previousFamily = family;
    }
  }

  /**
   * @param {HTMLTableRowElement} row - The real, still-visible product line.
   * @param {number} pillowQty
   */
  #renderPillows(row, pillowQty) {
    const lineKey = row.dataset.key;
    const quantityWrap = row.querySelector(".cart-items__quantity-wrap");
    const quantitySelector = quantityWrap?.querySelector("quantity-selector-component");
    if (!quantityWrap || !quantitySelector) return;

    let pillows = quantityWrap.querySelector(`[data-bundle-group-pillows="${CSS.escape(lineKey)}"]`);
    const existingPillowCount = pillows?.querySelectorAll(".cart-bundle-group__pillow").length ?? -1;

    if (!pillows) {
      pillows = document.createElement("div");
      pillows.dataset.bundleGroupPillows = lineKey;
      pillows.className = "cart-bundle-group__pillows";
      pillows.setAttribute("role", "list");
      quantitySelector.after(pillows);
    } else if (pillows.previousElementSibling !== quantitySelector) {
      // Keep it directly beside the quantity selector even if morphing reordered things.
      quantitySelector.after(pillows);
    }

    if (existingPillowCount === pillowQty) return;

    pillows.innerHTML = "";
    for (let i = 0; i < pillowQty; i++) {
      pillows.appendChild(this.#buildPillow(lineKey));
    }
  }

  /**
   * @param {string} lineKey
   */
  #buildPillow(lineKey) {
    const pillow = document.createElement("button");
    pillow.type = "button";
    pillow.className = "cart-bundle-group__pillow button-unstyled relative";
    pillow.setAttribute("role", "listitem");
    pillow.setAttribute("aria-label", "Verwijder 1 kussen");
    pillow.style.setProperty("--loading-size", "1.4rem");
    pillow.innerHTML = `
      <span class="cart-bundle-group__pillow-icon" aria-hidden="true"></span>
      <span class="cart-bundle-group__pillow-remove" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="10" height="10">
          <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </span>
    `;
    pillow.addEventListener("click", (event) => this.#onPillowClick(event, lineKey));
    return pillow;
  }

  /**
   * @param {MouseEvent} event
   * @param {string} lineKey
   */
  #onPillowClick(event, lineKey) {
    event.preventDefault();
    const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
    if (button.classList.contains("btn--loading")) return;
    button.classList.add("btn--loading");

    const cartItemsComponent = this.closest("cart-items-component");
    if (typeof cartItemsComponent?.onLinePillowRemove !== "function") {
      button.classList.remove("btn--loading");
      return;
    }

    cartItemsComponent.onLinePillowRemove(lineKey).finally(() => {
      button.classList.remove("btn--loading");
    });
  }
}

if (!customElements.get("cart-bundle-group")) {
  customElements.define("cart-bundle-group", CartBundleGroup);
}
