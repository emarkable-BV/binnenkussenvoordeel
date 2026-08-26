class ProductCardQuantityPicker extends HTMLElement {
  connectedCallback() {
    this.options = Array.from(this.querySelectorAll("[data-option]"));
    this.moreOption = this.querySelector("[data-more]");

    if (!this.options.length || !this.moreOption) return;

    this.resizeObserver = new ResizeObserver(() => this.update());
    this.resizeObserver.observe(this);
    this.update();
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
  }

  update() {
    const gap = parseFloat(getComputedStyle(this).gap) || 4;
    const containerWidth = this.clientWidth;

    this.options.forEach((option) => (option.hidden = false));
    this.moreOption.hidden = false;
    // Worst-case digit count so the reserved width never underestimates the final "+N" pill.
    this.moreOption.textContent = `+${this.options.length}`;

    let usedWidth = 0;
    let visibleCount = 0;

    for (let i = 0; i < this.options.length; i++) {
      const optionWidth = this.options[i].offsetWidth;
      const nextWidth = usedWidth + (i > 0 ? gap : 0) + optionWidth;

      if (nextWidth <= containerWidth) {
        usedWidth = nextWidth;
        visibleCount++;
      } else {
        break;
      }
    }

    if (visibleCount === this.options.length) {
      this.moreOption.hidden = true;
      return;
    }

    const moreWidth = this.moreOption.offsetWidth;

    while (
      visibleCount > 0 &&
      usedWidth + gap + moreWidth > containerWidth
    ) {
      visibleCount--;
      const option = this.options[visibleCount];
      usedWidth -= option.offsetWidth + (visibleCount > 0 ? gap : 0);
    }

    this.options.forEach((option, i) => {
      option.hidden = i >= visibleCount;
    });

    const hiddenCount = this.options.length - visibleCount;
    const firstHidden = this.options[visibleCount];

    this.moreOption.textContent = `+${hiddenCount}`;
    if (firstHidden?.dataset.url) {
      this.moreOption.href = firstHidden.dataset.url;
    }
    this.moreOption.hidden = false;
  }
}

if (!customElements.get("product-card-quantity-picker")) {
  customElements.define("product-card-quantity-picker", ProductCardQuantityPicker);
}
