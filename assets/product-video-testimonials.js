class ToggleVideoTestimonials extends HTMLButtonElement {
  constructor() {
    super();

    this.clickHandler = this.onClick.bind(this);
  }

  connectedCallback() {
    this.addEventListener("click", this.clickHandler);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.clickHandler);
  }

  get dialogEl() {
    if (this._dialogEl) {
      return this._dialogEl;
    }

    const controlledId = this.getAttribute("aria-controls");
    if (!controlledId) {
      console.warn("Element does not have aria-controls attribute.");
      return null;
    }

    const dialog = document.querySelector(`dialog#${controlledId}`);
    if (!dialog) {
      console.warn(`No <dialog> element found with id="${controlledId}".`);
    }

    const dialogComponent = dialog.closest("dialog-component");
    if (!dialogComponent) {
      console.warn(`No <dialog-component> element found with id="${controlledId}".`);
    }

    this._dialogEl = dialogComponent;
    return dialogComponent;
  }

  get sliderEl() {
    return (this._sliderEl = this._sliderEl || this.dialogEl.querySelector(".carousel"));
  }

  onClick(event) {
    event.preventDefault();

    const index = Number(this.dataset.index);

    if (!this.dialogEl) {
      return;
    }

    if (this.sliderEl?.swiperInstance) {
      this.sliderEl.goToSlide(index);
    } else {
      this.sliderEl.addEventListener(
        "carousel:ready",
        () => {
          this.sliderEl.goToSlide(index);
        },
        { once: true }
      );
    }

    this.dialogEl.showDialog();
  }
}
customElements.define("toggle-video-testimonials", ToggleVideoTestimonials, { extends: "button" });
