import { Component } from "@theme/component";
import { debounce, getSectionId, removeScrollLockClass } from "@theme/utilities";

class PredictiveSearch extends Component {
  #abortController = new AbortController();
  #lastKeydown = null;
  #focusoutTimeout = null;
  #isLoading = false;

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;

    this.cachedMap = new Map();
    this.onInputDebounced = debounce(this.onChange.bind(this), 300);
    this.header = document.querySelector("header");

    this.escKeyPressHandler = this.#handleEscKeyPress.bind(this);
    this.clickOutsideHandler = this.#handleClickOutside.bind(this);

    this.focusOutHandler = this.#handleFocusOut.bind(this);
    this.addEventListener("focusout", this.focusOutHandler, { signal });

    this.states = {
      OPEN: "predictive-search-open",
      SEARCH_OPEN: "search-open",
    };

    this.transitionEndHandler = null;
  }

  disconnectedCallback() {
    this.#abortController.abort();
    this.#cancelCloseAnimation();
    super.disconnectedCallback();
  }

  get isEmptyRecommendations() {
    return this.dataset.emptyRecommendations === "true";
  }

  get isHeaderSearch() {
    return this.dataset.context === "header";
  }

  onFocus(event) {
    if (this.getQuery().length === 0 && this.isEmptyRecommendations) {
      return;
    }

    this.toggleSearchState(true);

    if (this.getQuery().length === 0) {
      this.refs.searchContent.classList.remove("hidden");
    } else {
      const url = this.setupURL().toString();
      this.renderSection(url, event);
    }
  }

  #handleEscKeyPress(event) {
    const { key } = event;

    this.#lastKeydown = key;

    if (key === "Escape") {
      this.clear();
    }
  }

  getQuery() {
    return this.refs.searchInput.value.trim();
  }

  close(event) {
    event?.preventDefault();

    this.toggleSearchState(false);
  }

  clear(event = null) {
    event?.preventDefault();

    this.refs.searchInput.value = "";
    this.refs.searchInput.focus();
    this.removeAttribute("results");
    this.toggleSearchState(false);
  }

  setupURL() {
    const url = new URL(`${FoxTheme.routes.shop_url}${FoxTheme.routes.predictive_search_url}`);
    const searchTerm = this.getQuery();

    url.searchParams.set("q", searchTerm);
    url.searchParams.set("resources[limit]", this.dataset.resultsLimit || 3);
    url.searchParams.set("resources[limit_scope]", "each");
    url.searchParams.set("section_id", getSectionId(this));

    return url;
  }

  onSubmit(event) {
    if (this.getQuery().length === 0) {
      event.preventDefault();
      this.refs.searchInput.focus();
    }
  }

  onChange() {
    if (this.getQuery().length === 0) {
      this.clear();
      return;
    }

    const url = this.setupURL().toString();
    this.renderSection(url);
  }

  renderSection(url) {
    this.cachedMap.has(url) ? this.renderSectionFromCache(url) : this.renderSectionFromFetch(url);
  }

  renderSectionFromCache(url) {
    const responseText = this.cachedMap.get(url);
    this.renderSearchResults(responseText);
    this.setAttribute("results", "");
  }

  async renderSectionFromFetch(url) {
    this.#setLoadingState(true);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Network response was not ok");

      const responseText = await response.text();
      this.cachedMap.set(url, responseText);
      this.#setLoadingState(false);
      this.renderSearchResults(responseText);
    } catch (error) {
      console.error("Error fetching data: ", error);
      this.setAttribute("error", "Failed to load data");
      this.#setLoadingState(false);
    }
  }

  renderSearchResults(responseText) {
    const id = `PredictiveSearchResults-${getSectionId(this)}`;
    const targetElement = document.getElementById(id);

    if (!targetElement) {
      console.error(`Element with id '${id}' not found in the document.`);
      return;
    }

    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(responseText, "text/html");
    const contentElement = parsedDoc.getElementById(id);

    if (!contentElement) {
      console.error(`Element with id '${id}' not found in the parsed response.`);
      return;
    }

    this.refs.searchContent?.classList.remove("hidden");
    targetElement.innerHTML = contentElement.innerHTML;

    this.toggleSearchState(true);
  }

  #handleClickOutside(event) {
    const { target } = event;

    if (this.contains(target)) {
      clearTimeout(this.#focusoutTimeout);
      return;
    }

    if (this.isHeaderSearch && !target.classList.contains("fixed-overlay") && !target.closest(".header-section")) {
      return;
    }

    setTimeout(() => this.toggleSearchState(false));
  }

  #handleFocusOut(event) {
    const { relatedTarget } = event;

    if (!relatedTarget || this.contains(relatedTarget)) {
      return;
    }

    if (this.#lastKeydown === "Tab" && this.classList.contains(this.states.OPEN)) {
      this.#focusoutTimeout = setTimeout(() => this.toggleSearchState(false), 200);
    }
  }

  toggleSearchState(shouldOpen) {
    const isOpened = this.classList.contains(this.states.OPEN);

    if (isOpened === shouldOpen) return;

    if (this.#isLoading) return;

    this.classList.toggle(this.states.OPEN, shouldOpen);

    if (this.isHeaderSearch) {
      if (shouldOpen) {
        // Opening: cancel any pending close animation and add class
        this.#cancelCloseAnimation();
        document.body.classList.add(this.states.SEARCH_OPEN);
        document.addEventListener("click", this.clickOutsideHandler);
        document.addEventListener("keydown", this.escKeyPressHandler);
      } else {
        // Closing: remove class and wait for transition to complete
        this.#closeSearchWithAnimation();
        document.removeEventListener("click", this.clickOutsideHandler);
        document.removeEventListener("keydown", this.escKeyPressHandler);
      }
    }

    if (!shouldOpen && this.isEmptyRecommendations) {
      this.refs.searchContent?.classList.add("hidden");
    }
  }

  #getContentInner() {
    return this.refs.searchContent?.querySelector(".search__content-inner");
  }

  #cancelCloseAnimation() {
    if (!this.transitionEndHandler) return;

    const contentInner = this.#getContentInner();
    if (contentInner) {
      contentInner.removeEventListener("transitionend", this.transitionEndHandler);
    }
    this.transitionEndHandler = null;
  }

  #closeSearchWithAnimation() {
    const contentInner = this.#getContentInner();
    if (!contentInner) {
      // Use helper to handle Lenis timing when removing class
      removeScrollLockClass(document.body, this.states.SEARCH_OPEN);
      return;
    }

    this.#cancelCloseAnimation();
    // Use helper to handle Lenis timing when removing class
    removeScrollLockClass(document.body, this.states.SEARCH_OPEN);

    // Listen for transition end on transform (longest duration: 0.35s)
    this.transitionEndHandler = (event) => {
      if (event.target === contentInner && event.propertyName === "transform") {
        this.transitionEndHandler = null;
      }
    };

    contentInner.addEventListener("transitionend", this.transitionEndHandler, { once: true });
  }

  #setLoadingState(isLoading) {
    this.#isLoading = isLoading;
    if (isLoading) {
      this.setAttribute("loading", "true");
    } else {
      this.removeAttribute("loading");
      this.setAttribute("results", "true");
    }
  }
}
customElements.define("predictive-search", PredictiveSearch);
