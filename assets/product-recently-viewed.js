import { inView } from "@theme/animation";
import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";
import { CookieManager, getLocalStorage } from "@theme/utilities";

class RecentlyViewedProducts extends Component {
  connectedCallback() {
    super.connectedCallback();

    if (!Shopify.designMode) {
      if ("requestIdleCallback" in window) {
        requestIdleCallback(this.init.bind(this), { timeout: 1500 });
      } else {
        inView(this, this.init.bind(this), { rootMargin: "0px 0px 400px 0px" });
      }
    }
  }

  init() {
    const queryUrl = this.getQueryUrl();

    if (!queryUrl) {
      this.removeSection();
      return;
    }

    fetch(queryUrl)
      .then((response) => response.text())
      .then((responseText) => {
        const sectionInnerHTML = new DOMParser()
          .parseFromString(responseText, "text/html")
          .querySelector(".shopify-section");

        if (sectionInnerHTML === null) return;

        const recommendations = sectionInnerHTML.querySelector("recently-viewed-products");
        if (recommendations && recommendations.innerHTML.trim().length) {
          const section = recommendations.querySelector(".section");
          section.classList.remove("hidden");

          this.innerHTML = recommendations.innerHTML;
        }

        if (recommendations.querySelector(".product-card")) {
          this.dispatchEvent(new CustomEvent(ThemeEvents.recommendationsLoaded, { bubbles: true }));
        } else {
          this.removeSection();
        }
      })
      .catch((e) => {
        console.error(e);
      });
  }

  getQueryUrl() {
    const items = getLocalStorage(CookieManager.PRODUCT_RECENTLY_VIEWED) || [];
    const productId = parseInt(this.dataset.productId);
    const limit = parseInt(this.dataset.limit);

    if (this.dataset.productId && items.includes(productId)) {
      items.splice(items.indexOf(productId), 1);
    }

    if (items.length > 0) {
      const queryParams = items
        .map((item) => "id:" + item)
        .slice(0, limit)
        .join(" OR ");

      return this.dataset.url + queryParams;
    }

    return false;
  }

  removeSection() {
    this.remove();
  }
}

if (!customElements.get("recently-viewed-products")) {
  customElements.define("recently-viewed-products", RecentlyViewedProducts);
}
