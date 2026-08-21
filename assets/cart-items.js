import { Component } from "@theme/component";
import {
  CartGroupedSections,
  CartUpdateEvent,
  DiscountUpdateEvent,
  QuantitySelectorUpdateEvent,
  ThemeEvents,
} from "@theme/events";
import { morphSection, sectionRenderer } from "@theme/section-renderer";
import { debounce, fetchConfig, resetLoading } from "@theme/utilities";

/** @typedef {import('./utilities').TextComponent} TextComponent */

/**
 * A custom element that displays a cart items component.
 *
 * @typedef {object} Refs
 * @property {HTMLElement[]} quantitySelectors - The quantity selector elements.
 * @property {HTMLTableRowElement[]} cartItemRows - The cart item rows.
 * @property {TextComponent} cartTotal - The cart total.
 *
 * @extends {Component<Refs>}
 */
class CartItemsComponent extends Component {
  #debouncedOnChange = debounce(this.#onQuantityChange, 300).bind(this);
  #timeout = 5000;

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
    document.addEventListener(CartGroupedSections.eventName, this.#onGroupedSections);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
    document.removeEventListener(CartGroupedSections.eventName, this.#onGroupedSections);
  }

  /**
   * Handles QuantitySelectorUpdateEvent change event.
   * @param {QuantitySelectorUpdateEvent} event - The event.
   */
  async #onQuantityChange(event) {
    const { quantity, cartLine: line } = event.detail;

    if (!line) return;

    if (quantity === 0) {
      return this.onLineItemRemove(line);
    }

    const lineItemRow = this.#getRowByLine(line);
    const parentKey = lineItemRow?.dataset.key;

    if (lineItemRow) {
      const removeButtons = lineItemRow.querySelectorAll(".cart-items__remove-button");
      removeButtons?.forEach((button) => {
        button?.classList.add("btn--loading");
      });
    }

    // 1. Update parent first; Shopify may clamp the quantity to available stock.
    await this.updateQuantity({
      ...(parentKey ? { id: parentKey } : { line }),
      line,
      quantity,
      action: "change",
    });

    // 2. Sync gift wrap lines using the actual quantity that Shopify accepted,
    // not the requested one (otherwise gift line could exceed stock-clamped parent).
    // Skip the entire roundtrip when the sync-quantity setting is off, otherwise
    // the spinner would spin while inner sync calls early-return for nothing.
    if (parentKey && this.#giftSyncQuantity) {
      // Parent line key may have changed after update (e.g. discount re-allocation
      // recomputes the line key hash), so re-read it from the morphed DOM and the
      // refreshed cart before syncing gift lines.
      const refreshedRow = this.#getRowByLine(line);
      const currentParentKey = refreshedRow?.dataset.key || parentKey;

      this.#setGiftLinesLoading(true, currentParentKey);
      try {
        const cart = await this.#fetchCartJson();
        const parentItem = cart.items.find((i) => i.key === currentParentKey) || cart.items[line - 1];
        const actualQuantity = parentItem?.quantity ?? 0;
        const effectiveParentKey = parentItem?.key || currentParentKey;
        const cartAfterPerLine = await this.#updateAssociatedGiftLines(effectiveParentKey, actualQuantity, cart);
        const cartForWholeOrder = cartAfterPerLine ?? cart;
        await this.#syncWholeOrderGiftLine(effectiveParentKey, actualQuantity, cartForWholeOrder);
      } finally {
        this.#setGiftLinesLoading(false, currentParentKey);
      }
    }
  }

  /**
   * Handles the line item removal.
   * @param {number} line - The line item index.
   */
  async onLineItemRemove(line, event) {
    event?.preventDefault();

    const cartItemRowToRemove = this.#getRowByLine(line);

    if (cartItemRowToRemove) {
      const removeButtons = cartItemRowToRemove.querySelectorAll(".cart-items__remove-button");
      removeButtons.forEach((button) => {
        button?.classList.add("btn--loading");
      });
    }

    // Remove parent first using `line` only. Do not sync whole-order gift before
    // remove: syncing can recompute line keys when automatic discounts apply/unapply,
    // then clear fails with "no valid id or line parameter". Nested per-line gift
    // children are auto-removed with the parent; reconcile whole-order gift qty
    // after remove (same order as #onQuantityChange: parent first, then sync).
    await this.updateQuantity({
      line,
      quantity: 0,
      action: "clear",
    });

    if (!this.#giftWrapPerProduct) {
      this.#setGiftLinesLoading(true);
      try {
        await this.#reconcileWholeOrderGiftAfterLineRemoval();
      } finally {
        this.#setGiftLinesLoading(false);
      }
    }
  }

  /**
   * Handles the per-line gift wrap checkbox toggle on a product row.
   * @param {Event} event
   */
  onPerLineGiftToggle = async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;

    const parentRow = input.closest("tr[data-line]");
    const lineIndex = Number(parentRow?.dataset.line);
    if (!lineIndex) return;

    const wrapper = input.closest(".cart-items__gift-wrap-line");
    wrapper?.classList.add("cart-items__gift-wrap-line--loading");

    try {
      if (input.checked) {
        await this.#addPerLineGift(lineIndex, input);
      } else {
        await this.#removePerLineGift(lineIndex);
      }
    } finally {
      wrapper?.classList.remove("cart-items__gift-wrap-line--loading");
    }
  };

  /**
   * Adds a gift-wrap child line nested under the given parent.
   *
   * Strategy: remove the parent line, then re-add parent + child together in
   * a single /cart/add.js request using `parent_id = parent.variant_id`.
   * We can't reuse the existing parent via `parent_line_key` because
   * discounted lines have volatile keys that Shopify recomputes mid-request,
   * which would break the parent-child link.
   *
   * @param {number} lineIndex - 1-based index of the parent in cart.items.
   * @param {HTMLInputElement} lineInput
   */
  async #addPerLineGift(lineIndex, lineInput) {
    await this.#removeWholeOrderFeeLinesOnly();

    const cart = await this.#fetchCartJson();
    const parentItem = cart.items[lineIndex - 1];
    if (!parentItem) {
      console.warn("Parent line not found for gift wrap toggle");
      lineInput.checked = false;
      return;
    }

    const giftVariantId = this.#giftVariantId;
    const already = cart.items.some(
      (i) => Number(i.variant_id) === giftVariantId && i.parent_relationship?.parent_key === parentItem.key
    );
    if (already) {
      await this.#refreshCartSections();
      return;
    }

    const giftQuantity = this.#giftSyncQuantity ? parentItem.quantity || 1 : 1;

    const parentPayload = {
      id: parentItem.variant_id,
      quantity: parentItem.quantity,
      properties: { ...(parentItem.properties || {}) },
    };
    const sellingPlanId = parentItem.selling_plan_allocation?.selling_plan?.id;
    if (sellingPlanId) parentPayload.selling_plan = sellingPlanId;

    await fetch(
      FoxTheme.routes.cart_change_url,
      fetchConfig("json", {
        body: JSON.stringify({ id: parentItem.key, quantity: 0 }),
      })
    );

    const body = JSON.stringify({
      items: [
        parentPayload,
        {
          id: giftVariantId,
          quantity: giftQuantity,
          parent_id: parentItem.variant_id,
        },
      ],
      ...this.#getCartSectionsPayload(),
    });

    const res = await fetch(FoxTheme.routes.cart_add_url, fetchConfig("json", { body }));
    const parsed = await res.json();

    if (parsed.status && parsed.message) {
      /**
       * status: 422 "only N items were added" still mutates the cart; only treat as hard
       * failure when the response has no items/sections to render.
       **/
      if (parsed.status === 422) {
        if (this.#giftSyncQuantity) {
          const cartAfter = await this.#fetchCartJson();
          const giftInCart = cartAfter.items.find((i) => {
            if (Number(i.variant_id) !== giftVariantId || !i.parent_relationship?.parent_key) return false;
            const p = cartAfter.items.find((x) => x.key === i.parent_relationship.parent_key);
            return p && Number(p.variant_id) === Number(parentItem.variant_id);
          });
          const parentInCart =
            giftInCart && cartAfter.items.find((i) => i.key === giftInCart.parent_relationship.parent_key);

          if (parentInCart && giftInCart && parentInCart.quantity !== giftInCart.quantity) {
            await this.#refreshCartSections();
            this.#setGiftLinesLoading(true, parentInCart.key);
            try {
              await this.#updateAssociatedGiftLines(parentInCart.key, parentInCart.quantity, cartAfter);
            } finally {
              this.#setGiftLinesLoading(false, parentInCart.key);
            }
            return;
          }
        } else {
          // Fetch cart.js AND section HTML in parallel for instant morph
          const sectionIds = this.#gatherGroupedSectionIds();
          const sectionsData = {};
          const sectionPromises = sectionIds.map(async (sectionId) => {
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
                  sections: Object.keys(sectionsData).length > 0 ? sectionsData : undefined,
                })
              );
            })
            .catch((error) => {
              console.error("Failed to fetch cart count:", error);
            });
        }
      }

      console.error(parsed.message);
      lineInput.checked = false;
      await fetch(
        FoxTheme.routes.cart_add_url,
        fetchConfig("json", { body: JSON.stringify({ items: [parentPayload] }) })
      );
      await this.#refreshCartSections();
      return;
    }

    await this.#applyPerLineCartResponse(parsed);
  }

  /**
   * Removes the nested gift-wrap child of a parent line.
   *
   * We resolve the child via `parent_relationship.parent_key` against the
   * parent at `lineIndex`, so a stale DOM attribute can't point us at a
   * wrong/volatile key after a discount recompute.
   *
   * @param {number} lineIndex - 1-based index of the parent in cart.items.
   */
  async #removePerLineGift(lineIndex) {
    if (!lineIndex) return;

    const cart = await this.#fetchCartJson();
    const parent = cart.items[lineIndex - 1];
    if (!parent) return;

    const giftVariantId = this.#giftVariantId;
    const child = cart.items.find(
      (i) => Number(i.variant_id) === giftVariantId && i.parent_relationship?.parent_key === parent.key
    );
    if (!child) return;

    const body = JSON.stringify({
      id: child.key,
      quantity: 0,
      ...this.#getCartSectionsPayload(),
    });
    const res = await fetch(FoxTheme.routes.cart_change_url, fetchConfig("json", { body }));
    const parsed = await res.json();
    await this.#applyPerLineCartResponse(parsed);
  }

  /**
   * Removes standalone (whole-order) gift-wrap fee lines. Nested per-line
   * children are untouched. Called before adding a per-line gift so the cart
   * cannot end up in a mixed state when the setting was previously the other mode.
   */
  async #removeWholeOrderFeeLinesOnly() {
    const variantId = this.#giftVariantId;
    if (!variantId) return;

    while (true) {
      const cart = await this.#fetchCartJson();
      const item = cart.items.find(
        (i) => Number(i.variant_id) === variantId && i.parent_relationship?.parent_key == null
      );
      if (!item) break;

      const body = JSON.stringify({
        id: item.key,
        quantity: 0,
        ...this.#getCartSectionsPayload(),
      });
      const res = await fetch(FoxTheme.routes.cart_change_url, fetchConfig("json", { body }));
      const parsed = await res.json();
      await this.#applyPerLineCartResponse(parsed);
    }
  }

  async #fetchCartJson() {
    const res = await fetch(FoxTheme.routes.cart);
    return res.json();
  }

  /**
   * Shopify cart/change + cart/add JSON includes `items` when successful.
   * Passing it as CartUpdateEvent resource avoids extra `/cart.js` in listeners (e.g. price-per-item).
   * @param {object | undefined} parsed
   * @returns {object}
   */
  #cartResourceFromParsed(parsed) {
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
      return parsed;
    }
    return {};
  }

  /**
   * After removing a cart line, reconcile whole-order gift wrap: when no non-gift
   * items remain, always strip fee lines (even if gift_wrap_sync_quantity is off).
   * Otherwise match fee qty to product totals only when sync-quantity is enabled.
   * Same-instance CartUpdateEvent skips #handleCartUpdate gift sync (event.target === this),
   * so removal flows must reconcile here.
   */
  async #reconcileWholeOrderGiftAfterLineRemoval() {
    if (this.#giftWrapPerProduct) return;

    const giftVariantId = this.#giftVariantId;
    if (!giftVariantId) return;

    const cart = await this.#fetchCartJson();

    let nonGiftQuantityTotal = 0;
    for (const item of cart.items) {
      if (Number(item.variant_id) === giftVariantId) continue;
      nonGiftQuantityTotal += item.quantity;
    }

    if (nonGiftQuantityTotal === 0) {
      await this.#removeWholeOrderFeeLinesOnly();
      return;
    }

    if (this.#giftSyncQuantity) {
      await this.#syncWholeOrderGiftLine("", 0, cart);
    }
  }

  /**
   * Parses `item_count` from returned section HTML and dispatches {@link CartUpdateEvent}
   * so `cart-count` and sibling surfaces update (mirrors the notification half of
   * {@link #applyPerLineCartResponse}). Call after morphing `parsed.sections`.
   * @param {object | undefined} parsed - Parsed JSON from cart_change / cart_add.
   */
  #dispatchCartUpdateFromParsedResponse(parsed) {
    if (!parsed?.sections) return;

    let itemCount = 0;
    for (const sid of Object.keys(parsed.sections)) {
      const doc = new DOMParser().parseFromString(parsed.sections[sid], "text/html");
      const countEl = doc.querySelector('[ref="cartItemCount"]');
      if (countEl?.textContent) {
        itemCount = parseInt(countEl.textContent, 10) || itemCount;
      }
    }

    const resource = this.#cartResourceFromParsed(parsed);

    document.querySelectorAll("cart-items-component").forEach((comp) => {
      if (!(comp instanceof HTMLElement)) return;
      const sid = comp.dataset.sectionId;
      if (sid && parsed.sections[sid]) {
        comp.dispatchEvent(
          new CartUpdateEvent(resource, sid, {
            itemCount,
            source: "cart-items-component",
            sections: parsed.sections,
          })
        );
      }
    });
  }

  /**
   * Morphs sections + dispatches cartUpdate event. Used after per-line gift
   * mutations so sibling cart surfaces (drawer, page) stay in sync and the
   * cart count badge updates.
   * @param {object | undefined} parsed
   */
  async #applyPerLineCartResponse(parsed) {
    if (!parsed?.sections) return;

    for (const sid of Object.keys(parsed.sections)) {
      await morphSection(sid, parsed.sections[sid]);
    }

    this.#dispatchCartUpdateFromParsedResponse(parsed);
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
   * Re-fetches cart-related sections and morphs them in place. Used when we
   * short-circuit without hitting a cart-mutating endpoint (e.g. already-wrapped).
   */
  async #refreshCartSections() {
    const ids = this.#gatherGroupedSectionIds();
    await Promise.all(
      ids.map(async (sid) => {
        const url = `${window.location.pathname.split("?")[0]}?section_id=${sid}`;
        const res = await fetch(url);
        const html = await res.text();
        await morphSection(sid, html);
      })
    );
  }

  /**
   * Look up a cart item row by its 1-based line index. DOM order may not match
   * `cart.items` order (e.g. gift wrap rows are rendered last), so we resolve by
   * the `data-line` attribute instead of array index.
   *
   * @param {number} line - 1-based line index from cart.items.
   * @returns {HTMLTableRowElement | undefined}
   */
  #getRowByLine(line) {
    const rows = this.refs.cartItemRows;
    if (!Array.isArray(rows)) return undefined;
    return /** @type {HTMLTableRowElement | undefined} */ (rows.find((row) => Number(row.dataset.line) === line));
  }

  /**
   * Toggles loading on gift wrap rows via `is-quantity-syncing` on the `<tr>`
   * (gift lines use the quantity sync spinner only; no remove control). Mirrors
   * the parent line's loading state while gift sync is in flight, since the morph
   * from the gift sync request may not run when nothing needs to change.
   *
   * Only toggles:
   * - The per-line nested gift row whose `data-parent-key` matches `parentKey`
   *   (the gift line nested under the parent being changed).
   * - Any whole-order gift row (no `data-parent-key`), because its quantity may
   *   sync on every parent line change when sync-quantity is enabled.
   *
   * @param {boolean} on
   * @param {string} [parentKey]
   */
  #setGiftLinesLoading(on, parentKey = "") {
    const rows = this.refs.cartItemRows;
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      if (!row.classList.contains("cart-items__table-row--gift-wrap")) return;

      const rowParentKey = row.dataset.parentKey || "";
      const isWholeOrderGift = !rowParentKey;
      const isLinkedNestedGift = parentKey && rowParentKey === parentKey;

      if (!isWholeOrderGift && !isLinkedNestedGift) return;

      row.classList.toggle("is-quantity-syncing", on);
    });
  }

  /**
   * Builds the Shopify `sections` payload via {@link CartGroupedSections} listeners.
   */
  #getCartSectionsPayload() {
    return {
      sections: this.#gatherGroupedSectionIds().join(","),
      sections_url: window.location.pathname,
    };
  }

  /**
   * Morphs each rendered section returned by a `/cart/*.js` response.
   * @param {object | undefined} parsed - Parsed JSON from cart_change_url / cart_add_url.
   */
  #morphSectionsFromResponse(parsed) {
    if (!parsed?.sections) return;
    Object.keys(parsed.sections).forEach((sid) => morphSection(sid, parsed.sections[sid]));
  }

  get #giftVariantId() {
    return Number(this.dataset.giftVariantId) || 0;
  }

  get #giftWrapPerProduct() {
    return this.dataset.giftWrapPerProduct === "true";
  }

  get #giftSyncQuantity() {
    return this.dataset.giftSyncQuantity === "true";
  }

  /**
   * Updates quantity of the per-line gift wrap child nested under the given parent.
   * Uses Shopify's native `parent_relationship.parent_key` to resolve linkage.
   *
   * @param {string} parentKey - The parent line's stable cart line key.
   * @param {number} quantity - The new quantity (0 to remove).
   * @param {{ items?: unknown[] } | undefined} [preloadedCart]
   * @returns {Promise<{ items?: unknown[] } | undefined>} Full cart from last `/cart/change` when lines were updated; otherwise `undefined` (caller may reuse `preloadedCart`).
   */
  async #updateAssociatedGiftLines(parentKey, quantity, preloadedCart) {
    if (!this.#giftWrapPerProduct) return undefined;
    if (quantity > 0 && !this.#giftSyncQuantity) return undefined;
    if (!parentKey) return undefined;

    const giftVariantId = this.#giftVariantId;
    if (!giftVariantId) return undefined;

    const cart = preloadedCart && Array.isArray(preloadedCart.items) ? preloadedCart : await this.#fetchCartJson();
    const giftItems = cart.items.filter(
      (i) => Number(i.variant_id) === giftVariantId && i.parent_relationship?.parent_key === parentKey
    );

    const sectionsPayload = this.#getCartSectionsPayload();
    let lastParsed;
    for (const giftItem of giftItems) {
      if (giftItem.quantity === quantity) continue;
      const res = await fetch(
        FoxTheme.routes.cart_change_url,
        fetchConfig("json", {
          body: JSON.stringify({ id: giftItem.key, quantity, ...sectionsPayload }),
        })
      );
      lastParsed = await res.json();
    }

    this.#morphSectionsFromResponse(lastParsed);
    this.#dispatchCartUpdateFromParsedResponse(lastParsed);

    return lastParsed && Array.isArray(lastParsed.items) ? lastParsed : undefined;
  }

  /**
   * Syncs the whole-order gift wrap line quantity to the total non-gift quantity.
   * @param {string} changingItemKey - The key of the item being changed.
   * @param {number} newQuantity - The new quantity for that item.
   * @param {{ items?: { variant_id?: number; quantity?: number; key?: string; parent_relationship?: { parent_key?: string | null } }[] } | undefined} [preloadedCart] - When set (e.g. from a just-fetched /cart.js), skip a duplicate fetch.
   */
  async #syncWholeOrderGiftLine(changingItemKey, newQuantity, preloadedCart) {
    if (this.#giftWrapPerProduct) return;
    if (newQuantity > 0 && !this.#giftSyncQuantity) return;

    const giftVariantId = this.#giftVariantId;
    if (!giftVariantId) return;

    const cart = preloadedCart && Array.isArray(preloadedCart.items) ? preloadedCart : await this.#fetchCartJson();

    const giftItem = cart.items.find(
      (i) => Number(i.variant_id) === giftVariantId && i.parent_relationship?.parent_key == null
    );
    if (!giftItem) return;

    let totalQuantity = 0;
    for (const item of cart.items) {
      if (Number(item.variant_id) === giftVariantId) continue;
      totalQuantity += item.key === changingItemKey ? newQuantity : item.quantity;
    }

    if (giftItem.quantity === totalQuantity) return;

    const res = await fetch(
      FoxTheme.routes.cart_change_url,
      fetchConfig("json", {
        body: JSON.stringify({
          id: giftItem.key,
          quantity: totalQuantity,
          ...this.#getCartSectionsPayload(),
        }),
      })
    );
    const parsed = await res.json();
    this.#morphSectionsFromResponse(parsed);
    this.#dispatchCartUpdateFromParsedResponse(parsed);
  }

  /**
   * Updates the quantity.
   * @param {Object} config - The config.
   * @param {number} [config.line] - The 1-based line index.
   * @param {string} [config.id] - The line item key (used instead of line when provided).
   * @param {number} config.quantity - The quantity.
   * @param {string} config.action - The action.
   */
  updateQuantity(config) {
    this.#disableCartItems();

    const { line, quantity, id } = config;

    const sectionsToUpdate = this.#gatherGroupedSectionIds();

    const body = JSON.stringify({
      ...(id ? { id } : { line }),
      line: line,
      quantity: quantity,
      sections: sectionsToUpdate.join(","),
      sections_url: window.location.pathname,
    });

    return fetch(`${FoxTheme.routes.cart_change_url}`, fetchConfig("json", { body }))
      .then((response) => {
        return response.text();
      })
      .then(async (responseText) => {
        const parsedResponseText = JSON.parse(responseText);

        resetLoading(this);

        // Even with errors, backend may have updated cart to max available
        // Update UI and cart count if we have sections
        if (parsedResponseText.sections && parsedResponseText.sections[this.sectionId]) {
          const newSectionHTML = new DOMParser().parseFromString(
            parsedResponseText.sections[this.sectionId],
            "text/html"
          );

          // Grab the new cart item count from a hidden element
          const newCartHiddenItemCount = newSectionHTML.querySelector('[ref="cartItemCount"]')?.textContent;
          const newCartItemCount = newCartHiddenItemCount ? parseInt(newCartHiddenItemCount, 10) : 0;

          const resource = this.#cartResourceFromParsed(parsedResponseText);

          this.dispatchEvent(
            new CartUpdateEvent(resource, this.sectionId, {
              itemCount: newCartItemCount,
              source: "cart-items-component",
              sections: parsedResponseText.sections,
            })
          );

          morphSection(this.sectionId, parsedResponseText.sections[this.sectionId]);

          this.#dispatchCartUpdated(parsedResponseText);
        } else if (parsedResponseText.errors) {
          // No sections in error response - fetch cart.js for accurate count and quantity

          const cartSectionsData = {};
          let cartJson = null;
          const cartSectionsPromises = sectionsToUpdate.map(async (sectionId) => {
            const sectionUrl = `${window.location.pathname.split("?")[0]}?section_id=${sectionId}`;

            const res = await fetch(sectionUrl);
            const html = await res.text();

            cartSectionsData[sectionId] = html;
          });

          const cartJsonPromises = fetch(FoxTheme.routes.cart)
            .then((res) => res.json())
            .then((data) => {
              cartJson = data;
            });

          await Promise.all([...cartSectionsPromises, cartJsonPromises]);

          cartJson["sections"] = cartSectionsData;

          this.dispatchEvent(
            new CartUpdateEvent(cartJson, "", {
              itemCount: cartJson.item_count || 0,
              sections: cartJson.sections,
            })
          );

          morphSection(this.sectionId, cartJson.sections[this.sectionId]);

          this.#dispatchCartUpdated(cartJson);
        }

        /**
         * Show error message if exists (e.g. quantity exceeds available)
         * Call after morph section to avoid message disappear
         */
        if (parsedResponseText.errors && line != null) {
          this.#handleCartError(line, parsedResponseText);
        }
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        this.#enableCartItems();
        // cartPerformance.measureFromMarker(cartPerformaceUpdateMarker);
      });
  }

  /**
   * Handles the discount update.
   * @param {DiscountUpdateEvent} event - The event.
   */
  handleDiscountUpdate = (event) => {
    if (event?.detail?.sourceId === this.sectionId) return;
    this.#handleCartUpdate(event);
  };

  /**
   * Handles the cart error.
   * @param {number} line - The line.
   * @param {Object} parsedResponseText - The parsed response text.
   * @param {string} parsedResponseText.errors - The errors.
   */
  #handleCartError = (line, parsedResponseText) => {
    const cartItemError = this.refs[`cartItemError-${line}`];
    const cartItemErrorContainer = this.refs[`cartItemErrorContainer-${line}`];

    if (!(cartItemError instanceof HTMLElement)) throw new Error("Cart item error not found");
    if (!(cartItemErrorContainer instanceof HTMLElement)) throw new Error("Cart item error container not found");

    cartItemError.textContent = parsedResponseText.errors;
    cartItemErrorContainer.classList.remove("hidden");

    setTimeout(() => {
      cartItemErrorContainer.classList.add("hidden");
    }, this.#timeout);
  };

  /**
   * Handles the cart update.
   *
   * @param {DiscountUpdateEvent | CartUpdateEvent | import("@theme/events").CartAddEvent} event
   */
  #handleCartUpdate = async (event) => {
    // Self-dispatched: updateQuantity() already morphed sections and called #dispatchCartUpdated.
    if (event.target === this) return;

    // Reuse cart data already present in the event (from cart/change or cart/add response)
    // to avoid an extra /cart.js round-trip. Fall back to fetch only when not available.
    const preloadedResource = event.detail?.resource;
    const hasPreloadedCart =
      preloadedResource && typeof preloadedResource === "object" && Array.isArray(preloadedResource.items);

    const cartJson = hasPreloadedCart ? preloadedResource : await this.#fetchCartJson();
    cartJson["sections"] = event.detail?.data?.sections;
    this.#dispatchCartUpdated(cartJson);

    if (event instanceof DiscountUpdateEvent) {
      if (event?.detail?.sourceId === this.sectionId) return;
      sectionRenderer.renderSection(this.sectionId, { cache: false });
      return;
    }

    const cartItemsHtml = event.detail?.data?.sections?.[this.sectionId];
    if (cartItemsHtml) {
      morphSection(this.sectionId, cartItemsHtml);
    } else {
      await sectionRenderer.renderSection(this.sectionId, { cache: false });
    }

    // External cart updates (add to cart, AJAX errors with partial cart, etc.) do not
    // run #onQuantityChange. Reconcile whole-order gift qty when sync mode is on.
    // #syncWholeOrderGiftLine no-ops when there is no fee line or qty already matches.
    if (!this.#giftWrapPerProduct && this.#giftSyncQuantity) {
      this.#setGiftLinesLoading(true);
      try {
        await this.#syncWholeOrderGiftLine("", 0, cartJson);
      } finally {
        this.#setGiftLinesLoading(false);
      }
    }
  };

  /**
   * Dispatches a cart updated event for 3rd party.
   * @param {Object} cart - The cart data.
   */
  #dispatchCartUpdated(cart) {
    document.dispatchEvent(
      new CustomEvent(ThemeEvents.cartUpdated, {
        detail: { cart },
      })
    );
  }

  /**
   * Disables the cart items.
   */
  #disableCartItems() {
    this.classList.add("cart-items-disabled");
  }

  /**
   * Enables the cart items.
   */
  #enableCartItems() {
    this.classList.remove("cart-items-disabled");
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error("Section id missing");

    return sectionId;
  }
}

if (!customElements.get("cart-items-component")) {
  customElements.define("cart-items-component", CartItemsComponent);
}
