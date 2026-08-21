class AccordionImageSync extends HTMLElement {
  connectedCallback() {
    this.imageEl = this.querySelector('[ref="displayImage"]');
    this.handleClick = this.handleClick.bind(this);
    this.addEventListener("click", this.handleClick);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.handleClick);
  }

  handleClick(event) {
    const summary = event.target.closest("summary");
    if (!summary) return;

    const details = summary.closest("details");
    if (!details) return;

    requestAnimationFrame(() => {
      if (details.open && details.dataset.syncImage) {
        this.updateImage(details.dataset.syncImage);
      }
    });
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
