class AccordionImageSync extends HTMLElement {
  connectedCallback() {
    this.imageEl = this.querySelector('[ref="displayImage"]');
    this.handleMutations = this.handleMutations.bind(this);
    this.observer = new MutationObserver(this.handleMutations);

    this.querySelectorAll("details").forEach((details) => {
      this.observer.observe(details, { attributes: true, attributeFilter: ["open"] });

      if (details.open && details.dataset.syncImage) {
        this.updateImage(details.dataset.syncImage);
      }
    });
  }

  disconnectedCallback() {
    this.observer?.disconnect();
  }

  handleMutations(mutations) {
    for (const mutation of mutations) {
      const details = mutation.target;
      if (details.open && details.dataset.syncImage) {
        this.updateImage(details.dataset.syncImage);
      }
    }
  }

  updateImage(url) {
    if (this.imageEl && url) {
      this.imageEl.src = url;
    }
  }
}

if (!customElements.get("accordion-image-sync")) {
  customElements.define("accordion-image-sync", AccordionImageSync);
}
