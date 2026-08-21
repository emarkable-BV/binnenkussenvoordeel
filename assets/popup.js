import { DialogComponent } from "@theme/dialog";
import { onDocumentReady, setLocalStorage, getLocalStorage, getLenis } from "@theme/utilities";

class SubscribePopupComponent extends DialogComponent {
  connectedCallback() {
    super.connectedCallback();

    this.triggerOpen = this.dataset.triggerOpen;
    this.repeatOpen = this.dataset.repeatOpen;
    this.cookieName = "pebbletheme:popup";

    onDocumentReady(this.handleOpen.bind(this));
  }

  handleOpen() {
    if (Shopify.designMode) return;

    let savedData = getLocalStorage(this.cookieName);
    if (savedData && savedData.opened) {
      return false;
    }

    switch (this.triggerOpen) {
      case "delay":
        setTimeout(() => {
          this.show();
        }, 5000);
        break;
      case "scroll_down":
        this.triggerAfterScroll(700, this.show.bind(this));
        break;
      default:
        this.show();
        break;
    }
  }

  show() {
    this.setRepeatOpen();
    this.showDialog();
  }

  triggerAfterScroll(offset = 500, trigger) {
    const lenis = getLenis();
    let scrollHandler = null;

    if (lenis) {
      // Use Lenis scroll events (shared instance with other sections)
      scrollHandler = () => {
        const scrollTop = lenis.scroll;
        if (scrollTop > offset) {
          trigger();
          lenis.off("scroll", scrollHandler);
        }
      };
      lenis.on("scroll", scrollHandler);
    } else {
      // Fallback to native scroll if Lenis not available
      scrollHandler = () => {
        const scrollTop =
          window.pageYOffset ||
          (document.documentElement || document.body.parentNode || document.body).scrollTop ||
          0;
        if (scrollTop > offset) {
          trigger();
          window.removeEventListener("scroll", scrollHandler, { capture: false });
        }
      };
      window.addEventListener("scroll", scrollHandler, { passive: true });
    }
  }

  setRepeatOpen() {
    if (Shopify.designMode) return;

    const expires = this.#getRepeatOpenExpiryDays();
    setLocalStorage(this.cookieName, { opened: true }, expires);
  }

  #getRepeatOpenExpiryDays() {
    const EXPIRY_BY_KEY = {
      no_repeat: 365,
      every_30_mins: 1 / 2 / 24,
      every_1_hr: 1 / 24,
      every_6_hrs: 6 / 24,
      every_12_hrs: 1 / 2,
      every_day: 1,
      every_3_days: 3,
      every_week: 7,
      every_2_weeks: 14,
      every_month: 30,
    };

    return EXPIRY_BY_KEY[this.repeatOpen] ?? 7;
  }
}

if (!customElements.get("subscribe-popup-component")) {
  customElements.define("subscribe-popup-component", SubscribePopupComponent);
}
