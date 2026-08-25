class ShippingCutoffMessage extends HTMLElement {
  connectedCallback() {
    this.cutoffHour = parseInt(this.dataset.cutoffHour, 10) || 0;
    this.cutoffMinute = parseInt(this.dataset.cutoffMinute, 10) || 0;
    this.windowStartHour = parseInt(this.dataset.windowStartHour, 10) || 0;
    this.countdownTemplate = this.dataset.countdownTemplate || "[countdown]";
    this.staticText = this.dataset.staticText || "";
    this.textEl = this.querySelector('[ref="text"]');

    this.update();
    this.intervalId = setInterval(() => this.update(), 1000);
  }

  disconnectedCallback() {
    clearInterval(this.intervalId);
  }

  update() {
    if (!this.textEl) return;

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setHours(this.cutoffHour, this.cutoffMinute, 0, 0);
    const windowStart = new Date(now);
    windowStart.setHours(this.windowStartHour, 0, 0, 0);

    if (now >= windowStart && now < cutoff) {
      const remainingMs = cutoff - now;
      const countdown = this.formatCountdown(remainingMs);
      const [before, after] = this.countdownTemplate.split("[countdown]");

      this.textEl.textContent = "";
      this.textEl.append(before ?? "");

      const strong = document.createElement("strong");
      strong.textContent = countdown;
      this.textEl.append(strong);

      this.textEl.append(after ?? "");
    } else {
      this.textEl.textContent = this.staticText;
    }
  }

  formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
}

if (!customElements.get("shipping-cutoff-message")) {
  customElements.define("shipping-cutoff-message", ShippingCutoffMessage);
}
