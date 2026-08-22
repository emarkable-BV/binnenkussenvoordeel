class HeaderReviewWidget extends HTMLElement {
  connectedCallback() {
    this.topEl = this.closest(".header__top");
    this.widgetEl = this.querySelector("etrusted-widget");
    if (!this.topEl) return;

    this.updateVisibility = this.updateVisibility.bind(this);

    // .header__top is width-bound by the page container, not by its own
    // content, so observing it (rather than this element) avoids a
    // show/hide feedback loop when toggling our own visibility below.
    this.resizeObserver = new ResizeObserver(this.updateVisibility);
    this.resizeObserver.observe(this.topEl);

    if (this.widgetEl) {
      this.mutationObserver = new MutationObserver(this.updateVisibility);
      this.mutationObserver.observe(this.widgetEl, { childList: true, subtree: true });
    }

    this.updateVisibility();
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
  }

  updateVisibility() {
    const top = this.topEl;
    if (!top) return;

    this.hidden = false;
    void top.offsetWidth;
    this.hidden = top.scrollWidth > top.clientWidth + 1;
  }
}

if (!customElements.get("header-review-widget")) {
  customElements.define("header-review-widget", HeaderReviewWidget);
}
