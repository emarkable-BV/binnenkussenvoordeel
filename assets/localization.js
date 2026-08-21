import { inView } from "@theme/animation";
import { Component } from "@theme/component";
import { debounce, isClickedOutside, isRTL, normalizeString, onAnimationEnd } from "@theme/utilities";

/**
 * A custom element that displays a localization form.
 *
 * @typedef {object} FormRefs
 * @property {HTMLDivElement} countryList - The country list element.
 * @property {HTMLInputElement} countryInput - The country input element.
 * @property {HTMLUListElement[]} countryListItems - The country list items element.
 * @property {HTMLFormElement} form - The form element.
 * @property {HTMLDivElement} liveRegion - The live region element.
 * @property {HTMLSelectElement} languageInput - The language input element.
 * @property {HTMLSpanElement} noResultsMessage - The no results message element.
 * @property {HTMLUListElement} popularCountries - The popular countries element.
 * @property {HTMLInputElement} search - The search input element.
 * @property {HTMLButtonElement} resetButton - The reset button element.
 *
 * @extends {Component<FormRefs>}
 */
class LocalizationFormComponent extends Component {
  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    const { search, countryContainer, countryList } = this.refs;
    const { signal } = this.#abortController;

    this.onInputDebounced = debounce(this.filterCountries.bind(this), 300);
    search && search.addEventListener("keydown", this.#onSearchKeyDown, { signal });
    countryContainer && countryContainer.addEventListener("keydown", this.#onContainerKeyDown, { signal });
    countryList &&
      countryList.addEventListener("scroll", this.#onCountryListScroll, {
        passive: true,
        signal,
      });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  /**
   * Handles the keydown event for the container.
   *
   * @param {KeyboardEvent} event - The event object.
   */
  #onContainerKeyDown = (event) => {
    const { target } = event;

    if (target.closest(".country-filter")) return;

    const { countryListItems } = this.refs;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        this.#changeCountryFocus("UP");
        break;
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        this.#changeCountryFocus("DOWN");
        break;
      case " ":
      case "Enter":
        event.preventDefault();
        event.stopPropagation();

        const currentItem = countryListItems.find((item) => item.getAttribute("aria-current") === "true");
        currentItem?.removeAttribute("aria-current");

        const newItem = document.activeElement;
        newItem.setAttribute("aria-current", "true");

        if (newItem) {
          const value = newItem.dataset.value ?? "";
          this.selectCountry(value);
        }
        break;
      case "Tab":
        const selectedItem = countryListItems.find((item) => item.getAttribute("aria-selected") === "true");
        selectedItem?.removeAttribute("aria-selected");

        const focusingItem = document.activeElement;
        if (countryListItems.includes(focusingItem)) {
          focusingItem.setAttribute("aria-selected", "true");
        }

        break;
    }

    if (!this.refs.search) return;

    setTimeout(() => {
      const { countryListItems, search } = this.refs;
      const focusableItems = countryListItems.filter((item) => !item.hasAttribute("hidden"));
      const focusedItemIndex = focusableItems.findIndex((item) => item === document.activeElement);
      const focusedItem = focusableItems[focusedItemIndex];

      search.setAttribute("aria-activedescendant", focusedItem ? focusedItem.id : "");
    });
  };

  /**
   * Selects a country.
   *
   * @param {string} countryName - The name of the country to select.
   * @param {Event} event - The event object.
   */
  selectCountry = (countryName, event) => {
    event?.preventDefault();
    const { countryInput, form } = this.refs;

    countryInput.value = countryName;
    form?.submit();
  };

  /**
   * Changes the language of the localization form.
   *
   * @param {Event} event - The event object.
   */
  changeLanguage(event) {
    const { form, languageInput } = this.refs;
    const value = event.target instanceof HTMLSelectElement ? event.target.value : null;

    if (value) {
      languageInput.value = value;
      form.submit();
    }
  }

  /**
   * Finds matches for a given search value in a country element.
   *
   * @typedef {Object} Options
   * @property {boolean} [matchLabel] - Whether to match the label.
   * @property {boolean} [matchAlias] - Whether to match the alias.
   * @property {boolean} [matchIso] - Whether to match the iso.
   * @property {boolean} [matchCurrency] - Whether to match the currency.
   * @property {boolean} [labelMatchStart] - Whether to match the label start.
   * @property {boolean} [aliasExactMatch] - Whether to match the alias exact match.
   *
   * @typedef {Object} MatchTypes
   * @property {boolean} [label] - Whether the label matches the search value.
   * @property {boolean} [alias] - Whether the alias matches the search value.
   * @property {boolean} [iso] - Whether the iso matches the search value.
   * @property {boolean} [currency] - Whether the currency matches the search value.
   *
   * @param {string} searchValue - The search value to find matches for.
   * @param {HTMLElement} countryEl - The country element to find matches in.
   * @param {Options} options - The options for the search.
   * @returns {MatchTypes} The matches found in the country element.
   */
  #findMatches(
    searchValue,
    countryEl,
    options = {
      // Which data types (label, alias, iso) to match against
      matchLabel: true,
      matchAlias: true,
      matchIso: true,
      matchCurrency: true,
      // If true, the search value must match the start of the label
      labelMatchStart: false,
      // If true, a result will not display unless the search value equals an alias in its entirety
      aliasExactMatch: false,
    }
  ) {
    let matchTypes = {};
    const { aliases, value: iso } = countryEl.dataset;

    if (options.matchLabel) {
      const countryName = normalizeString(countryEl.querySelector(".country")?.textContent ?? "");

      if (!countryName) return matchTypes;

      matchTypes.label = options.labelMatchStart
        ? countryName.startsWith(searchValue)
        : countryName.includes(searchValue);
    }

    if (options.matchCurrency) {
      const currency = normalizeString(countryEl.querySelector(".localization-form__currency")?.textContent ?? "");
      matchTypes.currency = currency.includes(searchValue);
    }

    if (options.matchIso) {
      matchTypes.iso = normalizeString(iso ?? "") == searchValue;
    }

    if (options.matchAlias) {
      const countryAliases = aliases?.split(",").map((alias) => normalizeString(alias));

      if (!countryAliases) return matchTypes;

      matchTypes.alias =
        countryAliases.length > 0 &&
        countryAliases.find((alias) =>
          options.aliasExactMatch ? alias === searchValue : alias.startsWith(searchValue)
        ) !== undefined;
    }

    return matchTypes;
  }

  /**
   * Highlights matching text in a string by wrapping it in <mark> tags.
   *
   * @param {string | null} text - The text to highlight.
   * @param {string} searchValue - The search value to highlight.
   * @returns {string} The text with matching parts wrapped in <mark> tags.
   */
  #highlightMatches(text, searchValue) {
    if (!text || !searchValue) return text ?? "";

    const normalizedText = normalizeString(text);
    const normalizedSearch = normalizeString(searchValue);
    const startIndex = normalizedText.indexOf(normalizedSearch);

    if (startIndex === -1) return text;

    const endIndex = startIndex + normalizedSearch.length;
    const before = text.slice(0, startIndex);
    const match = text.slice(startIndex, endIndex);
    const after = text.slice(endIndex);

    let result = "";
    if (before) {
      result += `<mark>${before}</mark>`;
    }
    result += match;
    if (after) {
      result += `<mark>${after}</mark>`;
    }
    return result;
  }

  /**
   * Filters the countries based on the search value.
   */
  filterCountries() {
    const { countryList, countryListItems, liveRegion, noResultsMessage, popularCountries, resetButton, search } =
      this.refs;
    const { labelResultsCount } = this.dataset;
    const searchValue = normalizeString(search.value);
    let countVisibleCountries = 0;

    resetButton.toggleAttribute("hidden", !searchValue);

    if (popularCountries) {
      popularCountries.toggleAttribute("hidden", Boolean(searchValue));
    }

    const wrapper = this.querySelector(".country-selector-form__wrapper");
    if (wrapper) {
      wrapper.classList.toggle("is-searching", !!searchValue);
    }

    for (const countryEl of countryListItems) {
      if (searchValue === "") {
        countryEl.removeAttribute("hidden");
        countryEl.tabIndex = countryEl.getAttribute("aria-current") === "true" ? 0 : -1;

        const countrySpan = countryEl.querySelector(".country");
        if (countrySpan) {
          countrySpan.textContent = countrySpan.textContent;
        }
        countVisibleCountries++;
      } else {
        const matches = this.#findMatches(searchValue, countryEl);

        // In the future, we could reorder/rank filtered results based on the match types
        if (matches.label || matches.alias || matches.iso || matches.currency) {
          if (countVisibleCountries === 0) {
            countryEl.tabIndex = 0;
          }
          countryEl.removeAttribute("hidden");
          const countrySpan = countryEl.querySelector(".country");
          if (countrySpan) {
            countrySpan.innerHTML = this.#highlightMatches(countrySpan.textContent, searchValue);
          }
          countVisibleCountries++;
        } else {
          countryEl.setAttribute("hidden", "");
          countryEl.tabIndex = -1;
        }
      }
    }

    if (liveRegion && labelResultsCount) {
      liveRegion.innerText = labelResultsCount.replace("[count]", `${countVisibleCountries}`);
    }

    noResultsMessage.hidden = countVisibleCountries > 0;
    countryList.scrollTop = 0;
  }

  /**
   * Changes the focus of the country list items.
   *
   * @param {string} direction - The direction to change the focus.
   */
  #changeCountryFocus(direction) {
    const { countryListItems } = this.refs;
    const focusableItems = countryListItems.filter((item) => !item.hasAttribute("hidden"));
    const focusedItemIndex = focusableItems.findIndex((item) => item === document.activeElement);
    const focusedItem = focusableItems[focusedItemIndex];
    let itemToFocus;

    if (direction === "UP") {
      itemToFocus =
        focusedItemIndex > 0 ? focusableItems[focusedItemIndex - 1] : focusableItems[focusableItems.length - 1];
    } else {
      itemToFocus =
        focusedItemIndex < focusableItems.length - 1 ? focusableItems[focusedItemIndex + 1] : focusableItems[0];
    }

    if (focusedItem) {
      focusedItem.setAttribute("aria-selected", "false");
    }
    itemToFocus?.setAttribute("aria-selected", "true");
    itemToFocus?.focus();
  }

  /**
   * Resets the countries filter.
   *
   * @param {Event} event - The event object.
   */
  resetCountriesFilter(event) {
    const { search } = this.refs;

    event.stopPropagation();
    search.value = "";
    this.filterCountries();
    search.setAttribute("aria-activedescendant", "");
    search.focus();
  }

  /**
   * Handles the keydown event for the search input.
   *
   * @param {KeyboardEvent} event - The event object.
   */
  #onSearchKeyDown = (event) => {
    const { key } = event;

    switch (key) {
      case "Escape": // Allow Escape to close the panel.
        return;
      case "Enter":
        event.stopPropagation();
        event.preventDefault(); // Prevent localization form submission.
        return;
      default:
        event.stopPropagation();
    }
  };

  /**
   * Resets the form.
   */
  resetForm() {
    const { search } = this.refs;

    if (!search) return;

    if (search.value != "") {
      search.value = "";
      this.filterCountries();
      search.setAttribute("aria-activedescendant", "");
    }
  }

  /**
   * Focuses the search input.
   */
  focusSearchInput = () => {
    const { search } = this.refs;

    search?.focus();
  };

  /**
   * Handles the scroll event on the country list.
   *
   * @param {Event} event - The scroll event object.
   */
  #onCountryListScroll = (event) => {
    const { target } = event;
    const countryFilter = this.querySelector(".country-filter");
    const countryList = target instanceof HTMLElement ? target : null;

    if (!countryFilter || !countryList) return;

    const shouldShowBorder = countryList.scrollTop > 0;
    countryFilter.classList.toggle("is-scrolled", shouldShowBorder);
  };
}

/**
 * A custom element that displays a dropdown localization form.
 *
 * @typedef {object} DropdownRefs
 * @property {HTMLButtonElement} button - The button element.
 * @property {HTMLDivElement} panel - The panel element.
 * @property {LocalizationFormComponent} localizationForm - The localization form component.
 *
 * @extends {Component<DropdownRefs>}
 */
class DropdownLocalizationComponent extends Component {
  #abortController = new AbortController();
  #lastKeydown = null;
  #focusoutTimeout = null;
  #inViewStop = null;
  #templateMounted = false;

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
    const { signal } = this.#abortController;

    this.#mountTemplateWhenInView();

    this.focusoutHandler = this.#handleFocusOut.bind(this);
    this.addEventListener("focusout", this.focusoutHandler, { signal });
  }

  updatedCallback() {
    super.updatedCallback();
    this.#mountTemplateWhenInView();
  }

  disconnectedCallback() {
    this.#abortController.abort();
    this.#unbindInView();
    super.disconnectedCallback();
  }

  get isHidden() {
    const panel = this.refs.panel;

    return !panel || panel.hasAttribute("hidden");
  }

  /**
   * Toggles the panel.
   */
  toggleSelector() {
    this.#mountTemplate();
    return this.isHidden ? this.showPanel() : this.hidePanel();
  }

  /**
   * Shows the panel.
   */
  showPanel() {
    const { panel, toggle, localizationForm } = this.refs;

    if (!panel) {
      this.#mountTemplate();
    }

    if (!panel) return;
    if (!this.isHidden) return;

    this.addEventListener("keydown", this.#handleKeyDown);
    document.addEventListener("click", this.#handleClickOutside);

    panel.removeAttribute("hidden");
    toggle.setAttribute("aria-expanded", "true");

    // Adjust position if the panel overflows the viewport on the right
    this.#adjustPanelPositionForOverflow();

    onAnimationEnd(panel, () => {
      this.#updateWidth();
      localizationForm?.focusSearchInput();
    });
  }

  /**
   * Hides the panel.
   */
  hidePanel = () => {
    if (this.isHidden) return;

    const { panel, toggle, localizationForm } = this.refs;

    if (!panel) return;

    this.removeEventListener("keydown", this.#handleKeyDown);
    document.removeEventListener("click", this.#handleClickOutside);

    toggle?.setAttribute("aria-expanded", "false");
    panel.setAttribute("hidden", "");
    localizationForm?.resetForm();
  };

  /**
   * Handles the click outside event.
   *
   * @param {PointerEvent} event - The event object.
   */
  #handleClickOutside = (event) => {
    if (isClickedOutside(event, this)) {
      this.hidePanel();
    } else {
      clearTimeout(this.#focusoutTimeout);
    }
  };

  #handleFocusOut(event) {
    const { relatedTarget } = event;

    if (!relatedTarget || this.contains(relatedTarget)) {
      return;
    }

    if (this.#lastKeydown === "Tab") {
      this.#focusoutTimeout = setTimeout(() => this.hidePanel(), 200);
    }
  }

  #handleKeyDown = (event) => {
    const { key } = event;

    this.#lastKeydown = key;

    if (key === "Escape") {
      this.hidePanel();
      event.stopPropagation();
      this.refs.toggle?.focus();
    }
  };

  /**
   * Updates the width of the panel.
   */
  #updateWidth() {
    if (!this.refs.localizationForm) return;

    this.style.setProperty("--width", `${this.refs.localizationForm.offsetWidth}px`);
  }

  /**
   * Adjusts panel horizontal position if it overflows the viewport on the right.
   */
  #adjustPanelPositionForOverflow() {
    const { toggle, panel } = this.refs;
    const toggleGap = 10;

    if (!panel || !toggle) return;

    Object.assign(panel.style, {
      insetInline: "",
      top: "",
      bottom: "",
      transform: "",
    });

    // Measure on next frame to ensure layout is up to date after un-hiding
    requestAnimationFrame(() => {
      const panelRect = panel.getBoundingClientRect();
      const toggleRect = toggle.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const rtl = isRTL();

      const overflowStart = toggleRect.right - panelRect.width < 0;
      const overflowEnd = toggleRect.left + panelRect.width > viewportWidth;

      if (overflowStart && overflowEnd) {
        panel.style.insetInline = "50% auto";
        panel.style.transform = `translateX(${rtl ? "50%" : "-50%"})`;
      } else {
        const shouldAlignToInlineEnd = rtl ? overflowStart : overflowEnd;
        if (shouldAlignToInlineEnd) {
          panel.style.insetInline = "auto 0";
        }
      }

      const spaceBelow = viewportHeight - panelRect.bottom;
      if (spaceBelow < 0) {
        panel.style.top = "auto";
        panel.style.bottom = `calc(100% + ${toggleGap}px)`;
      }
    });
  }

  #mountTemplateWhenInView() {
    if (this.refs.panel) {
      this.#templateMounted = true;
      this.#unbindInView();
      return;
    }

    if (!(this.refs.template instanceof HTMLTemplateElement)) return;
    this.#templateMounted = false;
    this.#bindInView();
  }

  #mountTemplate() {
    if (this.#templateMounted) return true;

    const template = this.refs.template;
    if (!(template instanceof HTMLTemplateElement)) return false;

    template.replaceWith(template.content.cloneNode(true));
    super.updatedCallback();
    this.#templateMounted = true;
    this.#unbindInView();

    return true;
  }

  #bindInView() {
    if (this.#inViewStop || this.#templateMounted) return;

    this.#inViewStop = inView(this, () => {
      this.#mountTemplate();
      this.#unbindInView();
    });
  }

  #unbindInView() {
    if (!this.#inViewStop) return;

    this.#inViewStop();
    this.#inViewStop = null;
  }
}

customElements.define("localization-form-component", LocalizationFormComponent);
customElements.define("dropdown-localization-component", DropdownLocalizationComponent);
