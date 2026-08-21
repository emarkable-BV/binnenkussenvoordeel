import VariantPicker from "@theme/variant-picker";
import { Component } from "@theme/component";
import { ThemeEvents, VariantSelectedEvent, VariantUpdateEvent } from "@theme/events";
import { morph } from "@theme/morph";

export class ProductCard extends Component {
  getSelectedVariantId() {
    const checkedInput = /** @type {HTMLInputElement | null} */ (
      this.querySelector('input[type="radio"]:checked[data-variant-id]')
    );
    return checkedInput?.dataset.variantId || null;
  }

  getProductCardLink() {
    return this.refs.productCardLink || null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate);
    this.addEventListener(ThemeEvents.variantSelected, this.#handleVariantSelected);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  #handleVariantSelected = (event) => {
    if (event.target !== this.variantPicker) {
      this.variantPicker?.updateSelectedOption(event.detail.resource.id);
    }
    requestAnimationFrame(() => {
      this.#updateVariantImages();
    });
  };

  #updateProductUrl(event) {
    // Combined listing: update from newProduct data (works with cache)
    if (event.detail.data.newProduct?.url) {
      const productUrl = event.detail.data.newProduct.url;
      const { productCardLink, productTitleLink, cardGalleryLink } = this.refs;

      if (productCardLink) productCardLink.href = productUrl;
      if (cardGalleryLink instanceof HTMLAnchorElement) cardGalleryLink.href = productUrl;
      if (productTitleLink instanceof HTMLAnchorElement) productTitleLink.href = productUrl;

      const featuredMediaUrl = event.detail.resource?.featured_media?.preview_image?.src;
      if (featuredMediaUrl && this.closest("product-card-link")) {
        this.closest("product-card-link")?.setAttribute("data-featured-media-url", featuredMediaUrl);
      }
      return;
    }

    // Fallback: get URL from HTML (cache miss)
    if (!event.detail.data.html) return;

    const anchorElement = event.detail.data.html.querySelector("product-card a");
    const featuredMediaUrl = event.detail.data.html
      ?.querySelector("product-card-link")
      ?.getAttribute("data-featured-media-url");

    if (featuredMediaUrl && this.closest("product-card-link")) {
      this.closest("product-card-link")?.setAttribute("data-featured-media-url", featuredMediaUrl);
    }

    if (anchorElement instanceof HTMLAnchorElement) {
      if (anchorElement.getAttribute("href")?.trim() === "") return;

      const productUrl = anchorElement.href;
      const { productCardLink, productTitleLink, cardGalleryLink } = this.refs;

      if (productCardLink) productCardLink.href = productUrl;
      if (cardGalleryLink instanceof HTMLAnchorElement) cardGalleryLink.href = productUrl;
      if (productTitleLink instanceof HTMLAnchorElement) productTitleLink.href = productUrl;
    }
  }

  #updateVariantImages(event) {
    const mainImage = this.refs.cardGalleryLink?.querySelector(".product-card-main-image");
    if (!mainImage) return;

    const selectedSwatch = this.querySelector('input[type="radio"]:checked');
    if (!selectedSwatch) return;

    // Combined listing: check product match
    const swatchProductId = this.variantPicker?.dataset.productId;
    const currentProductId = this.dataset.productId || this.closest("product-card")?.dataset.productId;
    if (swatchProductId && currentProductId && swatchProductId !== currentProductId) {
      return;
    }

    const selectedLabel = selectedSwatch.closest("label");
    if (!selectedLabel) return;

    // Skip if swatch is hidden
    const swatchItem = selectedLabel.closest(".variant-option__swatch");
    if (swatchItem?.classList.contains("hidden")) return;

    let selectedImage = selectedLabel.querySelector(".media__image");

    // Unavailable variant: if swatch doesn't match event variant, try HTML first
    const swatchVariantId = selectedSwatch.dataset.variantId;
    const eventVariantId = event?.detail.resource?.id;
    if (eventVariantId && swatchVariantId && swatchVariantId !== eventVariantId && event?.detail.data.html) {
      if (this.#updateImageFromHTML(mainImage, event.detail.data.html)) {
        return;
      }
    }

    // Wait for image if not found yet
    if (!selectedImage) {
      const mediaId = selectedLabel.dataset.mediaId || selectedSwatch.dataset.optionMediaId;
      if (mediaId) {
        this.#waitForImageAndUpdate(mainImage, selectedLabel);
      }
      return;
    }

    // Apply image immediately if src exists
    if (selectedImage.src || selectedImage.currentSrc) {
      this.#applyImageToMain(mainImage, selectedImage);
      if (!selectedImage.complete) {
        selectedImage.addEventListener(
          "load",
          () => {
            if (selectedImage.srcset && mainImage.srcset !== selectedImage.srcset) {
              mainImage.srcset = selectedImage.srcset;
            }
          },
          { once: true }
        );
      }
    } else {
      selectedImage.addEventListener(
        "load",
        () => {
          this.#applyImageToMain(mainImage, selectedImage);
        },
        { once: true }
      );
    }
  }

  #waitForImageAndUpdate(mainImage, label) {
    const checkImage = () => {
      const img = label.querySelector(".media__image");
      if (img && (img.complete || img.naturalWidth > 0)) {
        this.#applyImageToMain(mainImage, img);
        return true;
      }
      return false;
    };

    if (checkImage()) return;

    requestAnimationFrame(() => {
      if (checkImage()) return;
      const img = label.querySelector(".media__image");
      if (img) {
        img.addEventListener("load", () => this.#applyImageToMain(mainImage, img), { once: true });
      }
    });
  }

  #updateImageFromHTML(mainImage, html) {
    const newCard = html.querySelector(`product-card[data-product-id="${this.dataset.productId}"]`);
    if (!newCard) return false;

    const newMainImage = newCard.querySelector(".product-card-main-image");
    if (!newMainImage) return false;

    let updated = false;
    if (newMainImage.srcset && mainImage.srcset !== newMainImage.srcset) {
      mainImage.srcset = newMainImage.srcset;
      updated = true;
    }
    if (newMainImage.src && mainImage.src !== newMainImage.src) {
      mainImage.src = newMainImage.src;
      updated = true;
    }
    return updated;
  }

  #applyImageToMain(mainImage, sourceImage) {
    if (!mainImage || !sourceImage) return;

    const newSrcset = sourceImage.srcset || "";
    const newSrc = sourceImage.currentSrc || sourceImage.src;

    if (newSrcset && mainImage.srcset !== newSrcset) {
      mainImage.srcset = newSrcset;
    }
    if (newSrc && mainImage.src !== newSrc) {
      mainImage.src = newSrc;
    }
  }

  #handleVariantUpdate = (event) => {
    event.stopPropagation();

    this.#updateProductUrl(event);

    if (event.target !== this.variantPicker && event.detail.data.html) {
      this.variantPicker?.updateVariantPicker(event.detail.data.html);
    }

    // Restore swatches expanded state after morph
    if (this.variantPicker instanceof SwatchesVariantPicker && event.detail.data.html) {
      const expandedKey = this.variantPicker.getStorageKey();
      if (sessionStorage.getItem(expandedKey) === "true") {
        requestAnimationFrame(() => {
          this.variantPicker.restoreExpandedState();
        });
      }
    }

    // Update images: immediate for cache, deferred for cache miss
    if (event.detail.data.isOptimistic || event.detail.data.isBackgroundSync) {
      this.#updateVariantImages(event);
    } else {
      requestAnimationFrame(() => {
        this.#updateVariantImages(event);
      });
    }
  };

  get variantPicker() {
    return this.querySelector("swatches-variant-picker");
  }
}

if (!customElements.get("product-card")) {
  customElements.define("product-card", ProductCard);
}

class SwatchesVariantPicker extends VariantPicker {
  connectedCallback() {
    super.connectedCallback();

    // Cache the parent product card
    this.parentProductCard = this.closest("product-card");

    // Clear storage on page load (not on morph) - detect by checking if component is new
    if (!this.dataset.initialized) {
      const expandedKey = this.getStorageKey();
      sessionStorage.removeItem(expandedKey);
      this.dataset.initialized = "true";
    }
  }

  updatedCallback() {
    super.updatedCallback?.();

    // Restore expanded state after component update (morph)
    const expandedKey = this.getStorageKey();
    const shouldExpand = sessionStorage.getItem(expandedKey) === "true";

    if (shouldExpand) {
      this.restoreExpandedState();
    }
  }

  getStorageKey() {
    const productId = this.dataset.productId || "unknown";
    return `swatches-expanded-${productId}`;
  }

  restoreExpandedState() {
    const hiddenSwatches = this.querySelectorAll(".variant-option__swatch.hidden");
    const showMoreButton = this.querySelector(".variant-option__swatch--show-more");

    hiddenSwatches.forEach((swatch) => swatch.classList.remove("hidden"));
    if (showMoreButton) showMoreButton.classList.add("hidden");
  }

  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const isSwatchInput = event.target instanceof HTMLInputElement && event.target.name?.includes("-swatch");
    const clickedSwatch = event.target;
    const availableCount = parseInt(clickedSwatch.dataset.availableCount || "0");
    const firstAvailableVariantId = clickedSwatch.dataset.firstAvailableOrFirstVariantId;

    // Unavailable variant with alternatives: load available variant instead
    if (isSwatchInput && availableCount > 0 && firstAvailableVariantId) {
      event.stopPropagation();
      this.updateSelectedOption(clickedSwatch);

      const productUrl = this.dataset.productUrl?.split("?")[0];
      if (!productUrl) return;

      const url = new URL(productUrl, window.location.origin);
      url.searchParams.set("variant", firstAvailableVariantId);
      url.searchParams.set("section_id", "section-rendering-product-card");

      const fetchToken = this.beginVariantFetch();
      this.fetchUpdatedSection(url.href, false, false, fetchToken);
      return;
    }

    super.variantChanged(event);
  }

  showAllSwatches(event) {
    event?.preventDefault();
    const hiddenSwatches = this.querySelectorAll(".variant-option__swatch.hidden");
    if (hiddenSwatches.length === 0) return;

    hiddenSwatches.forEach((swatch) => swatch.classList.remove("hidden"));
    this.querySelector(".variant-option__swatch--show-more")?.classList.add("hidden");
    sessionStorage.setItem(this.getStorageKey(), "true");
  }
}
if (!customElements.get("swatches-variant-picker")) {
  customElements.define("swatches-variant-picker", SwatchesVariantPicker);
}
