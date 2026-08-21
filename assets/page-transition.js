import { animate } from "@theme/animation";
import { ThemeEvents } from "@theme/events";
import { prefersReducedMotion } from "@theme/utilities";

class PageTransition extends HTMLElement {
  constructor() {
    super();

    window.addEventListener("beforeunload", () => {
      document.body.classList.add("page-loading");
      document.dispatchEvent(
        new CustomEvent(ThemeEvents.pageTransitionStart, {
          bubbles: true,
          detail: { direction: "out", timestamp: Date.now() },
        })
      );
    });

    // Safari 15: Module scripts may load after DOMContentLoaded has fired
    // Check readyState and run immediately if DOM is already ready
    const initOnLoad = () => {
      document.dispatchEvent(
        new CustomEvent(ThemeEvents.pageLoaded, {
          bubbles: true,
          detail: { timestamp: Date.now() },
        })
      );
      this.hide();
    };

    if (document.readyState === "loading") {
      // DOM is still loading, wait for DOMContentLoaded
      window.addEventListener("DOMContentLoaded", initOnLoad, { once: true });
    } else {
      // DOM is already ready (interactive or complete), run immediately
      initOnLoad();
    }

    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        document.body.classList.remove("page-loading");
      }
    });
  }

  hide() {
    const duration = prefersReducedMotion() ? 0 : 1;
    const finish = () => {
      this.hidden = true;
      document.dispatchEvent(
        new CustomEvent(ThemeEvents.pageTransitionEnd, {
          bubbles: true,
          detail: { timestamp: Date.now() },
        })
      );
    };
    animate(this, { opacity: 0 }, { duration, allowWebkitAcceleration: true }).finished.then(finish).catch(finish);
  }
}

if (!customElements.get("page-transition")) {
  customElements.define("page-transition", PageTransition);
}
