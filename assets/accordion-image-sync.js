class AccordionImageSync extends HTMLElement {
  connectedCallback() {
    this.imageEl = this.querySelector('[ref="displayImage"]');
    const detailsEls = this.querySelectorAll("details");

    console.log("[accordion-image-sync] connected", {
      imageFound: !!this.imageEl,
      detailsCount: detailsEls.length,
      detailsWithSyncImage: Array.from(detailsEls).filter((d) => d.dataset.syncImage).length,
    });

    this.handleMutations = this.handleMutations.bind(this);
    this.observer = new MutationObserver(this.handleMutations);

    detailsEls.forEach((details) => {
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
    console.log("[accordion-image-sync] mutation", mutations);
    for (const mutation of mutations) {
      const details = mutation.target;
      console.log("[accordion-image-sync] details toggled", {
        open: details.open,
        syncImage: details.dataset.syncImage,
      });
      if (details.open && details.dataset.syncImage) {
        this.updateImage(details.dataset.syncImage);
      }
    }
  }

  updateImage(url) {
    console.log("[accordion-image-sync] updateImage", url, this.imageEl);
    if (this.imageEl && url) {
      this.imageEl.src = url;
    }
  }
}

if (!customElements.get("accordion-image-sync")) {
  customElements.define("accordion-image-sync", AccordionImageSync);
}
