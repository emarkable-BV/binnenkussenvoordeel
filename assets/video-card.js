import { Component } from "@theme/component";
import { mediaHoverFine, prefersReducedMotion } from "@theme/utilities";

class VideoCard extends Component {
  /** @type {AbortController | null} */
  #abortController = null;

  /** @type {number | null} */
  #hoverIntentTimer = null;

  connectedCallback() {
    super.connectedCallback();

    // Respect reduced motion: do not autoplay on hover/focus.
    if (prefersReducedMotion()) return;

    // Only bind hover autoplay for pointer-fine devices.
    if (!mediaHoverFine()) return;

    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    this.addEventListener("mouseenter", this.#onEnter, { signal });
    this.addEventListener("mouseleave", this.#onLeave, { signal });
    this.addEventListener("focusin", this.#onEnter, { signal });
    this.addEventListener("focusout", this.#onFocusOut, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
    this.#abortController = null;
    this.#clearHoverIntent();
  }

  get deferredMedia() {
    return this.querySelector("deferred-media");
  }

  get content() {
    return this.querySelector(".video-card__content");
  }

  #clearHoverIntent() {
    if (this.#hoverIntentTimer) {
      window.clearTimeout(this.#hoverIntentTimer);
      this.#hoverIntentTimer = null;
    }
  }

  #onEnter = () => {
    this.#clearHoverIntent();

    // Small delay avoids accidental scrubs when moving pointer across a grid.
    this.#hoverIntentTimer = window.setTimeout(() => {
      this.#setActive(true);
      void this.#play();
    }, 120);
  };

  #onLeave = () => {
    this.#clearHoverIntent();
    this.#setActive(false);
    this.#pause();
  };

  #onFocusOut = (event) => {
    const next = event.relatedTarget;
    if (next instanceof HTMLElement && this.contains(next)) return;
    this.#onLeave();
  };

  #setActive(isActive) {
    this.classList.toggle("is-hovering", isActive);
    this.content?.classList.toggle("is-hidden", isActive);
  }

  async #play() {
    const dm = this.deferredMedia;
    if (!dm) return;

    // If poster exists and media isn't loaded, load + play.
    if (!dm.hasAttribute("data-media-loaded")) {
      await dm.showDeferredMedia?.();
      return;
    }

    await dm.playMedia?.();
  }

  #pause() {
    const dm = this.deferredMedia;
    if (!dm) return;
    dm.pauseMedia?.();
  }
}

if (!customElements.get("video-card")) {
  customElements.define("video-card", VideoCard);
}


