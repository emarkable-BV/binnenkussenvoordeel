import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";
import { morph } from "@theme/morph";
import { getLenis } from "@theme/utilities";

class StickyAddToCart extends Component {
  requiredRefs = ["stickyBar", "addToCartButton", "addToCartSpinner", "addToCartText"];

  #abortController = new AbortController();
  #buyButtonsIntersectionObserver = null;
  #footerSectionObserver = null;
  #isSticky = false;
  #hiddenInFooter = false;

  connectedCallback() {
    super.connectedCallback();

    this.#setupIntersectionObserver();
    const { signal } = this.#abortController;
    const target = this.closest(".shopify-section");

    target?.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate, { signal });
    target?.addEventListener(ThemeEvents.variantSelected, this.#handleVariantSelected, { signal });

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartAddComplete, { signal });
    document.addEventListener(ThemeEvents.cartError, this.#handleCartAddComplete, { signal });
  }

  disconnectedCallback() {
    this.#buyButtonsIntersectionObserver?.disconnect();
    this.#footerSectionObserver?.disconnect();
    this.#abortController.abort();
    super.disconnectedCallback();
  }

  updatedCallback() {
    super.updatedCallback?.();
    // Re-setup observers with fresh DOM references after morph
    this.#buyButtonsIntersectionObserver?.disconnect();
    this.#footerSectionObserver?.disconnect();
    this.#setupIntersectionObserver();
  }

  #setupIntersectionObserver() {
    const productForm = this.#getProductForm();
    if (!productForm) return;

    const buyButtonsBlock = productForm.closest(".buy-buttons-block");
    if (!buyButtonsBlock) return;

    const footer = document.querySelector("footer") ?? document.querySelector(".shopify-section-group-footer-group");
    if (!footer) return;

    this.#buyButtonsIntersectionObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      if (!entry.isIntersecting && !this.#isSticky) {
        const rect = entry.target.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top < 0) {
          this.#show();
        }
      } else if (this.#isSticky && entry.isIntersecting) {
        this.#hiddenInFooter = false;
        this.#hide();
      }
    });

    this.#footerSectionObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry) return;
        if (entry.isIntersecting && this.#isSticky) {
          this.#hiddenInFooter = true;
          this.#hide();
        } else if (!entry.isIntersecting && this.#hiddenInFooter) {
          const rect = buyButtonsBlock.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top < 0) {
            this.#hiddenInFooter = false;
            this.#show();
          }
        }
      },
      {
        rootMargin: "0px 0px -200px 0px",
      }
    );

    this.#buyButtonsIntersectionObserver.observe(buyButtonsBlock);
    this.#footerSectionObserver.observe(footer);
  }

  #handleVariantUpdate = (event) => {
    if (event.detail.data.productId !== this.dataset.productId) return;

    const variant = event.detail.resource;
    const html = event.detail.data?.html;

    if (!html) return;

    const newStickyAddToCart = html.querySelector("sticky-add-to-cart");
    if (!newStickyAddToCart) return;

    const newStickyBar = newStickyAddToCart.querySelector('[ref="stickyBar"]');
    if (!newStickyBar) return;

    const currentSticky = this.refs.stickyBar.getAttribute("data-sticky") || "false";
    const variantAvailable = newStickyAddToCart.dataset.variantAvailable;

    // Use default MORPH_OPTIONS (not a plain object) so onAfterUpdate fires,
    // which triggers updatedCallback on responsive-image and re-adds .loaded/.in-view.
    morph(this.refs.stickyBar, newStickyBar);

    this.refs.stickyBar.setAttribute("data-sticky", currentSticky);
    this.dataset.variantAvailable = variantAvailable;

    if (variant && variant.id) {
      this.dataset.currentVariantId = variant.id;
    }

    const isSoldOut = variant && !variant.available && variant.inventory_management === "shopify";
    this.#updateButtonText(variant?.available, isSoldOut);

    if (variant == null) {
      this.#handleVariantUnavailable();
    }
  };

  #handleVariantSelected = (event) => {
    const variantId = event.detail.resource?.id;
    if (!variantId) return;
    this.dataset.currentVariantId = variantId;
  };

  #handleVariantUnavailable = () => {
    this.dataset.currentVariantId = "";
    const variantTitleElement = this.querySelector(".sticky-add-to-cart__variant");
    const productId = this.dataset.productId;
    const variantPicker = document.querySelector(`variant-picker[data-product-id="${productId}"]`);
    if (!variantTitleElement || !variantPicker) return;

    // Check if variant picker uses input radio buttons or select dropdowns
    // They don't exist simultaneously, so we only need to check one type
    const hasInputs = variantPicker.querySelector("input[type='radio']") !== null;
    let selectedOptions = "";

    if (hasInputs) {
      // Get selected values from input radio buttons
      selectedOptions = Array.from(variantPicker.querySelectorAll("input:checked"))
        .map((option) => option.value)
        .filter((value) => value !== "")
        .join(" / ");
    } else {
      // Get selected values from select dropdowns
      selectedOptions = Array.from(variantPicker.querySelectorAll("select.variant-option__select"))
        .map((select) => {
          const selectedOption = select.options[select.selectedIndex];
          return selectedOption ? selectedOption.value : "";
        })
        .filter((value) => value !== "")
        .join(" / ");
    }

    if (!selectedOptions) return;
    variantTitleElement.textContent = selectedOptions;

    this.#updateButtonText(false);
  };

  /**
   * Viewport offset so the invalid control sits below the sticky header (not flush/covered).
   * Prefers `--header-height` from `BasicHeader` (#setHeight); falls back to
   * measuring `header[is="sticky-header"]` when the variable is unset or still 0 (e.g. first frame).
   *
   * @returns {number}
   */
  #getConstraintScrollClearancePx() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--header-height").trim();
    let headerPx = parseFloat(raw);
    if (!Number.isFinite(headerPx) || headerPx <= 0) {
      const sticky = document.querySelector('header[is="sticky-header"]');
      headerPx = sticky instanceof HTMLElement ? Math.round(sticky.getBoundingClientRect().height) : 0;
    }

    const gapPx = 50;

    return headerPx + gapPx;
  }

  /**
   * @param {HTMLFormElement} form
   * @returns {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null}
   */
  #getFirstInvalidControl(form) {
    for (const el of form.elements) {
      if (
        !(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLSelectElement) &&
        !(el instanceof HTMLTextAreaElement)
      ) {
        continue;
      }
      if (!el.willValidate || el.disabled) continue;
      if (!el.checkValidity()) return el;
    }
    return null;
  }

  /**
   * Browser `requestSubmit` scrolls the invalid field into view while Lenis smooth-scroll is active,
   * which fights native scroll and can jump the page (e.g. toward top) and dismiss the constraint UI.
   * We scroll via Lenis after `focus({ preventScroll: true })`, then call `reportValidity` only after
   * that scroll finishes (`onComplete` when `immediate: false`, or `scrollend` without Lenis).
   *
   * @param {HTMLFormElement} form
   * @param {HTMLButtonElement | undefined} fallbackSubmitter
   */
  #reportInvalidFormConstraints(form, fallbackSubmitter) {
    const invalidEl = this.#getFirstInvalidControl(form);
    if (!invalidEl) {
      if (fallbackSubmitter?.type === "submit") {
        form.requestSubmit(fallbackSubmitter);
      } else {
        form.requestSubmit();
      }
      return;
    }

    const clearancePx = this.#getConstraintScrollClearancePx();

    invalidEl.focus({ preventScroll: true });

    const showBubble = () => {
      requestAnimationFrame(() => {
        invalidEl.reportValidity();
      });
    };

    const lenis = getLenis();
    if (lenis) {
      lenis.scrollTo(invalidEl, {
        offset: -clearancePx,
        immediate: false,
        onComplete: showBubble,
      });
      return;
    }

    const rect = invalidEl.getBoundingClientRect();
    const targetTop = rect.top + window.scrollY - clearancePx;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });

    let settled = false;
    const finishAfterScroll = () => {
      if (settled) return;
      settled = true;
      if (fallbackTimer !== 0) {
        window.clearTimeout(fallbackTimer);
      }
      showBubble();
    };

    let fallbackTimer = 0;
    if ("onscrollend" in window) {
      window.addEventListener("scrollend", finishAfterScroll, { once: true, passive: true });
      fallbackTimer = window.setTimeout(finishAfterScroll, 1200);
    } else {
      fallbackTimer = window.setTimeout(finishAfterScroll, 450);
    }
  }

  handleAddToCartClick = () => {
    const productForm = this.#getProductForm();
    const form = productForm?.querySelector("form");
    const targetButton = productForm?.querySelector('[ref="addToCartButton"]');
    const submitter =
      targetButton instanceof HTMLButtonElement && targetButton.type === "submit" ? targetButton : undefined;

    if (form && !form.checkValidity()) {
      this.#reportInvalidFormConstraints(form, submitter);
      return;
    }

    if (!targetButton) return;
    this.#addLoading();
    targetButton.click();
  };

  #handleCartAddComplete = () => {
    this.#removeLoading();
  };

  #updateButtonText = (isAvailable, isSoldOut = false) => {
    const { addToCartText, addToCartButton } = this.refs;
    if (!addToCartText) return;

    if (isAvailable) {
      addToCartText.textContent = addToCartButton.dataset.addToCartText;
    } else if (isSoldOut) {
      addToCartText.textContent = addToCartButton.dataset.soldOutText;
    } else {
      addToCartText.textContent = addToCartButton.dataset.unavailableText;
    }
  };

  #getProductForm() {
    const productId = this.dataset.productId;
    if (!productId) return null;

    const sectionElement = this.closest(".shopify-section");
    if (!sectionElement) return null;

    const sectionId = sectionElement.id.replace("shopify-section-", "");
    return document.querySelector(
      `#shopify-section-${sectionId} product-form-component[data-product-id="${productId}"]`
    );
  }

  #show() {
    const { stickyBar } = this.refs;
    this.#isSticky = true;
    stickyBar.dataset.sticky = "true";

    // The global reveal IntersectionObserver excludes the bottom 50px (rootMargin -50px),
    // so the fixed sticky bar is never detected as in-viewport by it.
    // Force-add .in-view when the bar becomes visible so zoom-reveal images display correctly.
    const mediaWrapper = stickyBar.querySelector(".sticky-add-to-cart__image .media");
    if (mediaWrapper?.classList.contains("loaded")) {
      mediaWrapper.classList.add("in-view");
    }
  }

  #hide() {
    const { stickyBar } = this.refs;
    this.#isSticky = false;
    stickyBar.dataset.sticky = "false";
  }

  #addLoading() {
    this.refs.addToCartButton.classList.add("btn--loading");
    this.refs.addToCartSpinner.classList.remove("hidden");
  }

  #removeLoading() {
    this.refs.addToCartButton.classList.remove("btn--loading");
    this.refs.addToCartSpinner.classList.add("hidden");
  }
}

if (!customElements.get("sticky-add-to-cart")) {
  customElements.define("sticky-add-to-cart", StickyAddToCart);
}
