import CarouselComponent from "@theme/carousel";

class CollectionList extends CarouselComponent {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }
}

if (!customElements.get("collection-list")) {
  customElements.define("collection-list", CollectionList);
}
