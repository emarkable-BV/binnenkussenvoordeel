class AccordionImageSync extends HTMLElement {
  connectedCallback() {
    this.imageEl = this.querySelector('[ref="displayImage"]');
    this.detailsElements = Array.from(this.querySelectorAll("details"));
    this.handleToggle = this.handleToggle.bind(this);

    this.detailsElements.forEach((details) => {
      details.addEventListener("toggle", this.handleToggle);
    });
  }

  disconnectedCallback() {
    this.detailsElements?.forEach((details) => {
      details.removeEventListener("toggle", this.handleToggle);
    });
  }

  handleToggle(event) {
    const details = event.target;
    if (details.open && details.dataset.syncImage) {
      this.updateImage(details.dataset.syncImage);
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
