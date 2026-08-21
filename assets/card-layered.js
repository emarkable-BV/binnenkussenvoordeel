import { Component } from "@theme/component";
import { debounce } from "@theme/utilities";

class CardLayered extends Component {
  /** @type {string[]} */
  requiredRefs = ["cardLayeredButton", "cardLayeredContent"];

  constructor() {
    super();

    this.classes = {
      isOpen: "open",
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this.init();
    window.addEventListener("resize", this.#handleResize);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.#handleResize);
    this.removeDesignModeListener();
  }

  init() {
    const { cardLayeredContent: content } = this.refs;
    this.classList.remove(this.classes.isOpen);
    content.style.maxHeight = "0";

    if (Shopify.designMode) {
      document.addEventListener("shopify:block:select", (e) => {
        if (this.contains(e.target) && e.target.closest(".card-layered__description")) {
          this.open();
        } else {
          this.close();
        }
      });
    }
  }

  onButtonClick(event) {
    event.preventDefault();
    this.toggle();
  }

  toggle() {
    if (this.classList.contains(this.classes.isOpen)) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    const { cardLayeredContent: button } = this.refs;

    this.classList.add(this.classes.isOpen);
    button.setAttribute("aria-expanded", "true");
    this.updateContentHeight();
  }

  close() {
    const { cardLayeredContent: content, cardLayeredContent: button } = this.refs;

    this.classList.remove(this.classes.isOpen);
    button.setAttribute("aria-expanded", "false");
    content.style.maxHeight = "0";
  }

  updateContentHeight() {
    const { cardLayeredContent: content } = this.refs;

    if (this.classList.contains(this.classes.isOpen)) {
      content.style.maxHeight = content.scrollHeight + "px";
    }
  }

  #handleResize = debounce(() => this.updateContentHeight(), 150);
}

if (!customElements.get("card-layered")) {
  customElements.define("card-layered", CardLayered);
}
