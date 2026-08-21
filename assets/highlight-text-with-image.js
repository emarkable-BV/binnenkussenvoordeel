import { Component } from "@theme/component";

class HighlightTextWithImage extends Component {
  constructor() {
    super();

    this.images = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this.init();
  }

  init() {
    this.#processImages();
    this.#replaceImagePlaceholders();
  }

  #processImages() {
    const template = this.closest(`[id^="section-"]`)?.querySelector("template");
    if (!template) {
      return;
    }

    const images = template.content.querySelectorAll("[data-id]");

    images.forEach((image, index) => {
      const key = `img${index + 1}`;
      this.images[key] = image;
    });
  }

  #replaceImagePlaceholders() {
    let contentHTML = this.innerHTML;

    contentHTML = contentHTML.replace(/\[img(\d+)\]/g, (match, p1) => {
      const imgIndex = `img${p1}`;
      const imageWrapper = this.images[imgIndex];
      return imageWrapper ? imageWrapper.outerHTML : match;
    });

    this.innerHTML = contentHTML;
  }
}

if (!customElements.get("highlight-text-image")) {
  customElements.define("highlight-text-image", HighlightTextWithImage);
}
