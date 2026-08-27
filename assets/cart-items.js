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
  // Shared across every cart-items-component instance (drawer + full page can
  // both be mounted at once) so a single external cart change never triggers
  // two overlapping swap requests against the same cart.
  static #isSwappingBundles = false;
  #bundleToastTimeout;

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

    // updateQuantity() dispatches its CartUpdateEvent on `this`, which every
    // instance's own #handleCartUpdate deliberately ignores (self-dispatch
    // guard) to avoid double-processing — so quantity changes made directly
    // in the cart (the +/- stepper) never reach #syncBundleSwaps unless we
    // call it here explicitly, using the post-update (possibly stock-clamped) cart.
    await this.#syncBundleSwaps(await this.#fetchCartJson());
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

    await this.#syncBundleSwaps(cartJson);
  };

  /**
   * Normalizes each product family's *total* quantity (summed across every
   * line that belongs to it) to the fewest possible lines — e.g. an existing
   * "10 stuks" line plus a separately-added "4 stuks" and "2 stuks" line
   * (16 pillows total, 3 lines) gets consolidated into "10 stuks" + "6
   * stuks" (16 pillows, 2 lines). Runs after every cart change, in either
   * direction (a stepper increase/decrease on any line, bundle or loose).
   * Manual per-pillow removal uses {@link #composeFamily} directly instead,
   * targeting the family total minus one rather than the current total.
   *
   * @param {{ items?: { key: string; sku?: string; quantity: number }[] } | undefined} cartJson
   */
  async #syncBundleSwaps(cartJson) {
    if (CartItemsComponent.#isSwappingBundles) return;
    if (!cartJson || !Array.isArray(cartJson.items)) return;

    const stepsBySku = this.#readBundleStepsData();
    if (!stepsBySku) return;

    const processedFamilies = new Set();
    for (const item of cartJson.items) {
      const sku = item.sku;
      if (!sku) continue;

      const family = this.#familyOf(sku);
      if (processedFamilies.has(family)) continue;

      const steps = stepsBySku[sku];
      if (!Array.isArray(steps) || steps.length === 0) continue;

      let familyPillowQty = 0;
      for (const otherItem of cartJson.items) {
        if (otherItem.sku && this.#familyOf(otherItem.sku) === family) {
          familyPillowQty += otherItem.quantity * this.#packSizeOf(otherItem.sku);
        }
      }
      if (familyPillowQty < 2) continue;

      processedFamilies.add(family);
      const result = await this.#composeFamily(sku, familyPillowQty, cartJson);
      if (result) this.#showBundleSwapToast(result.target);
    }
  }

  /**
   * Divides `targetQty` by the largest available bundle size that fits, then
   * repeats for whatever remains with the next-largest size, cascading down
   * to loose (qty:1) units for any final leftover — e.g. 12 -> 1x "10 stuks"
   * + 1x "2 stuks"; 9 -> 1x "6 stuks" + 1x "2 stuks" + 1 loose.
   *
   * @param {number} targetQty
   * @param {{ qty: number; variantId: number }[]} steps
   * @returns {Map<number, number> | null} variantId -> quantity, or null if unrepresentable.
   */
  #minimalComposition(targetQty, steps) {
    if (targetQty <= 0) return new Map();

    const sortedSteps = [...steps].filter((s) => s.qty > 0).sort((a, b) => b.qty - a.qty);
    let remaining = targetQty;
    const target = new Map();
    for (const step of sortedSteps) {
      const count = Math.floor(remaining / step.qty);
      if (count > 0) {
        target.set(step.variantId, (target.get(step.variantId) || 0) + count);
        remaining -= count * step.qty;
      }
    }

    return remaining > 0 ? null : target;
  }

  /**
   * Recomputes the ideal set of bundle/loose lines for a product family to
   * total exactly `targetQty` units, then applies the minimal diff via
   * `cart/change.js` + `cart/add.js`. Shared by the auto-combine-upward path
   * ({@link #syncBundleSwaps}) and the manual per-pillow removal path
   * ({@link onLinePillowRemove}).
   *
   * @param {string} familySku - Any SKU belonging to the family (loose or an "N stuks" pack).
   * @param {number} targetQty - Desired total unit count for the family.
   * @param {{ items?: { key: string; sku?: string; quantity: number; variant_id: number }[] }} cartJson
   * @returns {Promise<{ target: Map<number, number> } | null>} The applied composition, or null if nothing changed / it couldn't be represented.
   */
  async #composeFamily(familySku, targetQty, cartJson) {
    if (CartItemsComponent.#isSwappingBundles) return null;

    const stepsBySku = this.#readBundleStepsData();
    const steps = stepsBySku?.[familySku];
    if (!Array.isArray(steps) || steps.length === 0) return null;

    const target = this.#minimalComposition(Math.max(0, targetQty), steps);
    if (!target) return null;

    const family = this.#familyOf(familySku);
    const current = new Map();
    for (const item of cartJson.items) {
      if (!item.sku || this.#familyOf(item.sku) !== family) continue;
      current.set(item.variant_id, { key: item.key, quantity: item.quantity });
    }

    const changes = [];
    for (const [variantId, info] of current) {
      const wanted = target.get(variantId) || 0;
      if (wanted !== info.quantity) changes.push({ id: info.key, quantity: wanted });
    }
    const toAdd = [];
    for (const [variantId, wanted] of target) {
      if (!current.has(variantId) && wanted > 0) toAdd.push({ id: variantId, quantity: wanted });
    }

    if (changes.length === 0 && toAdd.length === 0) return null;

    const startedAt = Date.now();
    const MIN_LOADING_MS = 500;

    CartItemsComponent.#isSwappingBundles = true;
    this.#setFamilyLoading(family, true);
    try {
      for (const change of changes) {
        await fetch(FoxTheme.routes.cart_change_url, fetchConfig("json", { body: JSON.stringify(change) }));
      }

      let parsed = null;
      if (toAdd.length > 0) {
        const body = JSON.stringify({ items: toAdd, ...this.#getCartSectionsPayload() });
        const res = await fetch(FoxTheme.routes.cart_add_url, fetchConfig("json", { body }));
        parsed = await res.json();
      }

      // The morph below swaps in fresh server HTML, which wipes the loading
      // class immediately — on a fast connection the whole round trip can
      // finish in well under one shimmer sweep, so without this the effect
      // barely has time to become visible before the content just changes.
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS - elapsed));
      }

      if (parsed) {
        await this.#applyPerLineCartResponse(parsed);
      } else {
        await this.#refreshCartSections();
      }

      return { target };
    } catch (error) {
      console.error("Bundle composition failed:", error);
      return null;
    } finally {
      CartItemsComponent.#isSwappingBundles = false;
      // The morph above replaces these rows' markup wholesale, so the loading
      // class is naturally gone already on success; only a thrown error
      // leaves it needing an explicit removal here.
      this.#setFamilyLoading(family, false);
    }
  }

  /**
   * Toggles a loading look (dimmed, non-interactive) on every current row
   * belonging to a product family while its bundle composition is being
   * recomputed on the server.
   * @param {string} family
   * @param {boolean} on
   */
  #setFamilyLoading(family, on) {
    this.querySelectorAll("tr[data-bundle-family]").forEach((row) => {
      if (this.#familyOf(row.dataset.bundleFamily) === family) {
        row.classList.toggle("cart-bundle-group__row-loading", on);
      }
    });
  }

  /**
   * Removes exactly one pillow from a product family's total (across every
   * line belonging to it, not just the one the pillow icon was shown under),
   * recomposing the remainder into the fewest lines / best bundle mix.
   * Called by the pillow icons rendered by `assets/cart-bundle-group.js`.
   *
   * @param {string} lineKey - The cart line's `key` (stable per-line id) the clicked pillow belonged to.
   */
  async onLinePillowRemove(lineKey) {
    // Show the loading skeleton immediately, before the /cart.js round trip
    // below even starts — otherwise that first fetch's old content is still
    // visible for a moment with no loading state at all.
    const clickedRow = this.querySelector(`tr[data-key="${CSS.escape(lineKey)}"]`);
    const familyFromDom = clickedRow?.dataset.bundleFamily;
    if (familyFromDom) this.#setFamilyLoading(familyFromDom, true);

    // Force the browser to paint the loading state before the fetch below
    // starts — otherwise, when that request resolves fast enough, the class
    // change and the resulting content swap can land in the same frame and
    // the loading state never actually gets shown on screen.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    try {
      const cart = await this.#fetchCartJson();
      const item = cart.items.find((i) => i.key === lineKey);
      if (!item?.sku) return;

      const family = this.#familyOf(item.sku);
      let familyPillowQty = 0;
      for (const otherItem of cart.items) {
        if (otherItem.sku && this.#familyOf(otherItem.sku) === family) {
          familyPillowQty += otherItem.quantity * this.#packSizeOf(otherItem.sku);
        }
      }
      if (familyPillowQty <= 0) return;

      await this.#composeFamily(item.sku, familyPillowQty - 1, cart);
    } finally {
      // #composeFamily's own success path already clears this (implicitly,
      // via the morph); this covers early returns above and the error path.
      if (familyFromDom) this.#setFamilyLoading(familyFromDom, false);
    }
  }

  /**
   * Strips a trailing `-NPK` pack-size segment (mirrors
   * `bundle-quantity-family.liquid`), so a loose SKU and any of its bundle
   * siblings resolve to the same family key.
   * @param {string} sku
   */
  #familyOf(sku) {
    const parts = sku.split("-");
    if (parts.length === 4 && parts[3].includes("PK")) {
      return `${parts[0]}-${parts[1]}-${parts[2]}`;
    }
    return sku;
  }

  /**
   * Parses the pack size from a `-NPK` SKU suffix (mirrors
   * `cart-pillow-count.liquid`); 1 for a loose SKU.
   * @param {string} sku
   */
  #packSizeOf(sku) {
    const parts = sku.split("-");
    if (parts.length === 4 && parts[3].includes("PK")) {
      return parseInt(parts[3], 10) || 1;
    }
    return 1;
  }

  /**
   * Reads the qty->variant bundle map rendered by `cart-bundle-data.liquid`.
   * @returns {Record<string, { qty: number; variantId: number }[]> | null}
   */
  #readBundleStepsData() {
    // Scoped to this instance, not `document`: the drawer and the full cart
    // page can both be mounted at once, each with its own (independently
    // morphed) copy of this data — reading from `document` risked grabbing a
    // stale one from the *other* surface instead of the one that was just
    // updated.
    const script = this.querySelector("[data-cart-bundle-steps]");
    if (!script?.textContent) return null;
    try {
      return JSON.parse(script.textContent);
    } catch (error) {
      console.error("Failed to parse cart bundle steps data:", error);
      return null;
    }
  }

  /**
   * Briefly shows a toast confirming which bundle(s) the cart was combined into.
   * @param {Map<number, number>} target - variantId -> quantity, as applied by #composeFamily.
   */
  #showBundleSwapToast(target) {
    const stepsBySku = this.#readBundleStepsData();
    const qtyByVariant = new Map();
    for (const steps of Object.values(stepsBySku || {})) {
      for (const step of steps) qtyByVariant.set(step.variantId, step.qty);
    }

    const fragments = [];
    for (const [variantId, count] of target) {
      const qty = qtyByVariant.get(variantId);
      if (!qty || qty <= 1 || count <= 0) continue;
      fragments.push(count > 1 ? `${count}x ${qty} stuks` : `${qty} stuks`);
    }
    if (fragments.length === 0) return;

    const message =
      fragments.length === 1
        ? `We hebben je ${fragments[0]} samengevoegd tot 1 voordeelbundel`
        : `We hebben je items samengevoegd tot voordeelbundels (${fragments.join(", ")})`;

    let toast = document.querySelector(".cart-bundle-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "cart-bundle-toast alert alert--success";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("cart-bundle-toast--visible");
    clearTimeout(this.#bundleToastTimeout);
    this.#bundleToastTimeout = setTimeout(() => {
      toast.classList.remove("cart-bundle-toast--visible");
    }, 4000);
  }

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
