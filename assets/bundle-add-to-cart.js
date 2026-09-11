/**
 * When a product page's "add to cart" form belongs to a bundle pack (SKU
 * ending in `-NPK`, e.g. "10 stuks"), swap what actually gets submitted:
 * instead of 1x the bundle pack variant, add `quantity * packSize` units of
 * that family's loose (1-stuk) sibling product. The customer still pays
 * that loose product's own price per unit (no bundle discount carried
 * over) — this only changes which variant/quantity is submitted.
 *
 * Implemented as a `handleSubmit` patch on `product-form-component` rather
 * than a competing submit listener: the theme's declarative `on:submit`
 * event system dispatches via a single capture-phase listener on
 * `document` (see assets/component.js), which always runs before any
 * listener attached to the form itself — so intercepting the submit event
 * directly can't reliably run *before* the framework's own handler reads
 * the form's values. Patching the method the framework calls sidesteps
 * that entirely.
 */
customElements.whenDefined("product-form-component").then(() => {
  const ProductFormComponent = customElements.get("product-form-component");
  const originalHandleSubmit = ProductFormComponent?.prototype.handleSubmit;
  if (typeof originalHandleSubmit !== "function") return;

  // Avoid re-patching if this script is loaded more than once (the block
  // that includes it can repeat on a page).
  if (ProductFormComponent.prototype.handleSubmit.__bundleSwapPatched) return;

  function patchedHandleSubmit(event) {
    const swapDataEl = this.querySelector("[data-bundle-add-to-cart-swap]");
    const swap = swapDataEl?.textContent ? JSON.parse(swapDataEl.textContent) : null;

    if (swap?.baseVariantId && swap.packSize > 1) {
      const form = this.querySelector("form");
      const variantInput = form?.querySelector('[name="id"]');
      // Not every buy-buttons block includes a quantity selector — when it's
      // missing, the form has no [name="quantity"] field at all and Shopify
      // defaults a missing quantity to 1 on submit, so start from 1 too.
      let quantityInput = form?.querySelector('[name="quantity"]');

      if (variantInput && form) {
        const requestedQuantity = quantityInput ? parseInt(quantityInput.value, 10) || 1 : 1;

        if (!quantityInput) {
          quantityInput = document.createElement("input");
          quantityInput.type = "hidden";
          quantityInput.name = "quantity";
          form.appendChild(quantityInput);
        }

        variantInput.value = String(swap.baseVariantId);
        quantityInput.value = String(requestedQuantity * swap.packSize);
      }
    }

    return originalHandleSubmit.call(this, event);
  }
  patchedHandleSubmit.__bundleSwapPatched = true;

  ProductFormComponent.prototype.handleSubmit = patchedHandleSubmit;
});
