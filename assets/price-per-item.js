import { morph } from "@theme/morph";
import { Component } from "@theme/component";
import { ThemeEvents, CartAddEvent, CartUpdateEvent } from "@theme/events";
import { formatCurrency } from "@theme/utilities";

class PricePerItem extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abort;

  connectedCallback() {
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    const section = this.closest(".shopify-section, dialog");
    const form = this.closest("product-form-component");

    section?.addEventListener(ThemeEvents.variantUpdate, this.#onVariantUpdate, { signal });
    form?.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#onQuantityChange, { signal });

    document.addEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate, { signal });

    const input = this.#getQuantityInput();
    input?.addEventListener("input", this.#sync, { signal });
    input?.addEventListener("change", this.#sync, { signal });

    this.#sync();
  }

  disconnectedCallback() {
    this.#abort?.abort();
    this.#abort = undefined;
  }

  /** @type {EventListener} */
  #onQuantityChange = (e) => {
    const form = this.closest("product-form-component");
    if (!form?.contains(/** @type {Node} */ (e.target))) return;
    this.#sync();
  };

  /** @type {EventListener} */
  #onVariantUpdate = (e) => {
    if (e.type !== ThemeEvents.variantUpdate) return;
    const detail =
      /** @type {{ detail: { resource?: Record<string, unknown>; data?: { productId?: string; html?: Document | null; newProduct?: unknown } } }} */ (
        e
      ).detail;

    // Skip productId filter for combine listing switches (newProduct means a different product loaded)
    const isProductSwitch = !!detail.data?.newProduct;
    const productId = this.closest("product-form-component")?.dataset.productId;
    if (!isProductSwitch && detail.data?.productId && productId && String(detail.data.productId) !== String(productId)) {
      return;
    }

    // Update volume/quantity HTML regardless of variant data availability
    const htmlDoc = detail.data?.html;
    const sectionId = this.dataset.sectionId;
    if (htmlDoc && sectionId) {
      const newRules = htmlDoc.getElementById(`QuantityRules-${sectionId}`);
      const newVol = htmlDoc.getElementById(`Volume-${sectionId}`);
      const curRules = document.getElementById(`QuantityRules-${sectionId}`);
      const curVol = document.getElementById(`Volume-${sectionId}`);

      if (newRules && curRules) morph(curRules, newRules, { childrenOnly: true });
      if (newVol && curVol) morph(curVol, newVol, { childrenOnly: true });
    }

    const variant = detail.resource;
    if (!variant?.id) {
      if (htmlDoc) this.#sync();
      return;
    }

    this.dataset.variantId = String(variant.id);
    const price = /** @type {{ price?: number | string }} */ (variant).price;
    if (price != null) this.dataset.variantPriceCents = String(price);

    this.#syncQuantityInput(variant);
    // Volume tiers stay stale until section HTML arrives; skip price sync until then.
    if (!htmlDoc) return;

    this.#sync();
  };

  /** @param {{ quantity_rule?: { min?: number; max?: number | null; increment?: number } }} variant */
  #syncQuantityInput(variant) {
    const input = this.#getQuantityInput();
    const rule = variant.quantity_rule;
    if (!(input instanceof HTMLInputElement) || !rule) return;

    input.min = String(rule.min ?? 1);
    input.step = String(rule.increment ?? 1);
    if (rule.max != null) input.max = String(rule.max);
    else input.removeAttribute("max");

    const min = rule.min ?? 1;
    let v = parseInt(input.value, 10);
    if (Number.isNaN(v) || v < min) v = min;
    if (rule.max != null && v > rule.max) v = rule.max;
    input.value = String(v);
  }

  /** @type {EventListener} */
  #onCartUpdate = (e) => {
    const form = this.closest("product-form-component");
    const productId = form?.dataset.productId;
    const vid =
      this.dataset.variantId ||
      form?.querySelector('[ref="variantId"]')?.value ||
      /** @type {HTMLInputElement | undefined} */ (form?.querySelector('input[name="id"]'))?.value;

    if (!productId || !vid) return;

    const d = /** @type {CartAddEvent | CartUpdateEvent} */ (e).detail;
    if (e instanceof CartAddEvent && d.data?.productId && String(d.data.productId) !== String(productId)) return;

    const cartQty = qtyForVariantFromCartResource(d.resource, vid);

    const input = this.#getQuantityInput();
    if (input instanceof HTMLInputElement) {
      input.dataset.cartQuantity = String(cartQty);
    }
    this.#sync();
  };

  /** @type {EventListener} */
  #sync = () => {
    const sectionId = this.dataset.sectionId;
    const root = document.getElementById(`Volume-${sectionId}`);
    /** @type {[number, string][]} */
    const pairs = [];
    if (root) {
      root.querySelectorAll("li[data-volume-tier]").forEach((li) => {
        const qty = parseInt(li.getAttribute("data-volume-tier") || "0", 10);
        const priceEl = li.querySelector("[data-text]");
        const text = priceEl?.getAttribute("data-text") || "";
        if (qty > 0 && text) pairs.push([qty, text]);
      });
      pairs.sort((a, b) => b[0] - a[0]);
    }

    const input = this.#getQuantityInput();
    const out = this.querySelector(".price-per-item__current");
    if (!(input instanceof HTMLInputElement) || !out) return;

    const enteredQty = parseInt(input.value, 10) || 0;
    const cartQty = parseInt(input.dataset.cartQuantity || "0", 10);
    const totalForTier = cartQty + enteredQty;

    if (pairs.length > 0) {
      for (const pair of pairs) {
        if (totalForTier >= pair[0]) {
          out.innerHTML = pair[1];
          return;
        }
      }
    }

    const template = this.dataset.priceEachTemplate;
    const centsRaw = this.dataset.variantPriceCents;
    const cents = parseInt(String(centsRaw ?? ""), 10);
    if (template && Number.isFinite(cents)) {
      const moneyFormat = window.FoxTheme?.moneyFormat || "${{amount}}";
      out.innerHTML = template.replace(/@@PRICE@@/g, formatCurrency(cents, moneyFormat));
      return;
    }

    out.innerHTML = "";
  };

  /**
   * @returns {HTMLInputElement | null}
   */
  #getQuantityInput() {
    const sid = this.dataset.sectionId;
    const byId = sid ? document.getElementById(`Quantity-${sid}-pdp`) : null;
    if (byId instanceof HTMLInputElement) return byId;
    const form = this.closest("product-form-component");
    const q = form?.querySelector('quantity-selector-component input[ref="quantityInput"]');
    const q2 = form?.querySelector('input[name="quantity"]');
    return q instanceof HTMLInputElement ? q : q2 instanceof HTMLInputElement ? q2 : null;
  }
}

/**
 * Sum cart line quantities for a variant (multiple lines possible).
 * @param {{ items?: { variant_id: number; quantity: number }[] }} cart
 * @param {string} variantId
 */
function qtyForVariantInCart(cart, variantId) {
  if (!cart?.items?.length) return 0;
  return cart.items
    .filter((it) => String(it.variant_id) === String(variantId))
    .reduce((sum, it) => sum + it.quantity, 0);
}

/**
 * `/cart/change` (and `/cart.js`) return `{ items: [...] }`.
 * `/cart/add` often returns a single line object (no `items`).
 * @param {unknown} resource
 * @param {string} variantId
 * @returns {number}
 */
function qtyForVariantFromCartResource(resource, variantId) {
  if (!resource || typeof resource !== "object") return 0;
  const r = /** @type {{ items?: unknown[]; variant_id?: number; variantId?: number; quantity?: unknown }} */ (
    resource
  );
  if (Array.isArray(r.items)) {
    return qtyForVariantInCart(
      /** @type {{ items: { variant_id: number; quantity: number }[] }} */ (r),
      variantId
    );
  }
  const vid = r.variant_id ?? r.variantId;
  if (vid != null && String(vid) === String(variantId)) {
    const q = r.quantity;
    const n = typeof q === "number" ? q : parseInt(String(q ?? ""), 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

class VolumePricing extends Component {
  connectedCallback() {
    super.connectedCallback();
    this.#resetCollapsed();
  }

  /** @returns {boolean} */
  #isExpanded() {
    return this.dataset.expanded === "true";
  }

  #resetCollapsed() {
    this.dataset.expanded = "false";
    const btn = this.refs.button;
    if (btn instanceof HTMLButtonElement) btn.setAttribute("aria-expanded", "false");
  }

  /** @type {(event: Event) => void} */
  toggle = (event) => {
    event.preventDefault();
    const btn = this.refs.button;
    if (!(btn instanceof HTMLButtonElement)) return;

    const expanded = !this.#isExpanded();
    this.dataset.expanded = expanded ? "true" : "false";
    btn.setAttribute("aria-expanded", String(expanded));
  };
}

class VariantCartQty extends Component {
  /** @type {string[]} */
  requiredRefs = ["cartLabel"];

  /** @type {AbortController | undefined} */
  #abort;

  connectedCallback() {
    super.connectedCallback();

    this.#abort = new AbortController();
    const { signal } = this.#abort;

    document.addEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate, { signal });
    this.section?.addEventListener(ThemeEvents.variantUpdate, this.#onVariantUpdate, { signal });
  }

  disconnectedCallback() {
    this.#abort?.abort();
    this.#abort = undefined;

    super.disconnectedCallback();
  }

  get section() {
    return this.closest(".shopify-section, dialog");
  }

  /** @type {EventListener} */
  #onCartUpdate = (e) => {
    this.#syncFromCart(e);
  };

  /** @type {EventListener} */
  #onVariantUpdate = (e) => {
    if (e.type !== ThemeEvents.variantUpdate) return;
    const detail =
      /** @type {{ detail: { resource?: { id?: string | number }; data?: { productId?: string; html?: Document | null } } }} */ (
        e
      ).detail;

    const productId = this.closest("product-form-component")?.dataset.productId;
    if (detail.data?.productId && productId && String(detail.data.productId) !== String(productId)) {
      return;
    }

    const variant = detail.resource;
    if (!variant?.id) return;

    this.dataset.variantId = String(variant.id);

    const htmlDoc = detail.data?.html;
    const sectionId = this.dataset.sectionId;
    if (htmlDoc && sectionId) {
      const newEl = htmlDoc.getElementById(`QuantityRulesCart-${sectionId}`);
      if (newEl) {
        morph(this, newEl, { childrenOnly: true });
        this.className = newEl.className;
        const vid = newEl.getAttribute("data-variant-id");
        if (vid) this.dataset.variantId = vid;
        return;
      }
    }
  };

  /**
   * @param {Event} [cartEvent]
   */
  #syncFromCart(cartEvent) {
    const variantId = this.dataset.variantId;
    const label = this.refs.cartLabel;
    if (!variantId || !label) return;

    const qty = qtyForVariantFromCartResource(cartEvent?.detail?.resource, variantId);
    const qtyEl = label.querySelector(".count");
    if (qtyEl) {
      qtyEl.textContent = String(qty);
    }

    this.classList.toggle("hidden", qty === 0);
  }
}

if (!customElements.get("price-per-item")) {
  customElements.define("price-per-item", PricePerItem);
}

if (!customElements.get("volume-pricing")) {
  customElements.define("volume-pricing", VolumePricing);
}

if (!customElements.get("variant-cart-qty")) {
  customElements.define("variant-cart-qty", VariantCartQty);
}
