import { Component } from "@theme/component";
import { fetchConfig } from "@theme/utilities";

/**
 * A custom element that manages country and province selection for shipping forms.
 *
 * @typedef {object} CountryProvinceRefs
 * @property {HTMLSelectElement} countryInput - The country select input.
 * @property {HTMLSelectElement} provinceInput - The province select input.
 *
 * @extends Component<CountryProvinceRefs>
 */
export class CountryProvinceForm extends Component {
  requiredRefs = ["countryInput", "provinceInput"];

  /** @type {string | null} */
  #pendingCountryData = null;

  /** @type {string | null} */
  #pendingProvinceData = null;

  /** @type {MutationObserver | null} */
  #dialogObserver = null;

  /** @type {boolean} */
  #optionsPopulated = false;

  /** @type {() => void} */
  #handleCountryChangeBound = this.#handleCountryChange.bind(this);

  connectedCallback() {
    super.connectedCallback();

    // Initialize with default country if provided
    this.#initializeCountry();

    // Handle country change
    this.refs.countryInput.addEventListener("change", this.#handleCountryChangeBound);

    // Use MutationObserver to detect when container (dialog or details) opens
    this.#setupContainerObserver();
  }

  updatedCallback() {
    super.updatedCallback();

    // Re-setup after DOM morph (e.g., after cart quantity update)
    // Reset flag to allow re-population if needed
    this.#optionsPopulated = false;

    // Re-initialize country data from updated dataset
    this.#initializeCountry();

    // Remove old listener and re-attach with new refs
    const oldCountryInput = this.refs.countryInput;
    if (oldCountryInput) {
      oldCountryInput.removeEventListener("change", this.#handleCountryChangeBound);
    }
    this.refs.countryInput.addEventListener("change", this.#handleCountryChangeBound);

    // Re-setup MutationObserver with new container reference
    this.#dialogObserver?.disconnect();
    this.#dialogObserver = null;
    this.#setupContainerObserver();

    // If container is already open, handle it immediately
    // This ensures default country is set after morph if dialog/details was already open
    const dialogElement = this.closest("dialog");
    const detailsElement = this.closest("details");
    const containerElement = dialogElement || detailsElement;

    if (containerElement && containerElement.open) {
      this.#handleContainerOpen({ target: containerElement });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Remove event listener
    if (this.refs.countryInput) {
      this.refs.countryInput.removeEventListener("change", this.#handleCountryChangeBound);
    }

    // Clean up MutationObserver
    this.#dialogObserver?.disconnect();
    this.#dialogObserver = null;
  }

  /**
   * Handle container open (dialog or details) to populate country options
   * @param {Object} event - Event object with target container
   */
  #handleContainerOpen(event) {
    // Prevent duplicate population
    if (this.#optionsPopulated) return;

    // Find the container (dialog or details) that contains this component
    const dialogElement = this.closest("dialog");
    const detailsElement = this.closest("details");
    const containerElement = dialogElement || detailsElement;

    // Check if this component is inside the opened container
    if (containerElement && containerElement.open) {
      this.#ensureCountryOptionsPopulated();
      this.#optionsPopulated = true;

      // Set default country if we have pending data
      if (this.#pendingCountryData) {
        this.#setDefaultCountry(this.#pendingCountryData, this.#pendingProvinceData);
        // Clear pending data after use
        this.#pendingCountryData = null;
        this.#pendingProvinceData = null;
      }
    }
  }

  /**
   * Initialize the country selection based on data attributes
   */
  #initializeCountry() {
    // Store default country data for later use when dialog opens
    this.#pendingCountryData = this.dataset.country;
    this.#pendingProvinceData = this.dataset.province;

    // Don't populate options immediately - wait for dialog to open
    // This reduces initial DOM size and improves performance
  }

  /**
   * Populate country options from template (lazy loading)
   */
  #populateCountryOptions() {
    const template = this.refs.countryInput.querySelector("template");

    if (template) {
      const templateContent = document.importNode(template.content, true);
      this.refs.countryInput.appendChild(templateContent);
    }
  }

  /**
   * Ensure country options are populated before handling change
   */
  #ensureCountryOptionsPopulated() {
    const template = this.refs.countryInput.querySelector("template");
    if (template) {
      this.#populateCountryOptions();
    }
  }

  /**
   * Set default country and province after options are populated
   * @param {string} countryData - Country name
   * @param {string} provinceData - Province name
   */
  #setDefaultCountry(countryData, provinceData) {
    const countryOption = Array.from(this.refs.countryInput.options).find(
      (option) => option.textContent === countryData
    );

    if (countryOption) {
      this.refs.countryInput.selectedIndex = countryOption.index;
      this.refs.countryInput.dispatchEvent(new Event("change"));
    }
  }

  /**
   * Setup MutationObserver to detect when container (dialog or details) opens
   */
  #setupContainerObserver() {
    // Check for both dialog and details elements
    const dialogElement = this.closest("dialog");
    const detailsElement = this.closest("details");
    const containerElement = dialogElement || detailsElement;

    if (!containerElement) return;

    this.#dialogObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "open") {
          if (containerElement.open) {
            this.#handleContainerOpen({ target: containerElement });
          }
        }
      });
    });

    this.#dialogObserver.observe(containerElement, {
      attributes: true,
      attributeFilter: ["open"],
    });
  }

  /**
   * Handle country selection change
   */
  #handleCountryChange() {
    const selectedOption = this.refs.countryInput.options[this.refs.countryInput.selectedIndex];

    if (!selectedOption) return;

    const provincesData = selectedOption.dataset.provinces;

    if (!provincesData) {
      this.#hideProvinceField();
      return;
    }

    try {
      const provinces = JSON.parse(provincesData);

      if (!Array.isArray(provinces) || provinces.length === 0) {
        this.#hideProvinceField();
        return;
      }

      this.#showProvinceField();
      this.#updateProvinceOptions(provinces);
    } catch (error) {
      console.error("Error parsing provinces data:", error);
      this.#hideProvinceField();
    }
  }

  /**
   * Hide the province field
   */
  #hideProvinceField() {
    const provinceField = this.refs.provinceInput.closest(".form-field");
    if (provinceField) {
      provinceField.hidden = true;
    }
  }

  /**
   * Show the province field
   */
  #showProvinceField() {
    const provinceField = this.refs.provinceInput.closest(".form-field");
    if (provinceField) {
      provinceField.hidden = false;
    }
  }

  /**
   * Update province options based on selected country
   * @param {Array<Array<string>>} provinces - Array of province data [code, name]
   */
  #updateProvinceOptions(provinces) {
    // Clear existing options
    this.refs.provinceInput.innerHTML = "";

    // Add new options
    provinces.forEach((provinceData) => {
      const [code, name] = provinceData;
      const isSelected = code === this.dataset.province;

      const option = new Option(name, code, isSelected, isSelected);
      this.refs.provinceInput.options.add(option);
    });
  }
}

if (!customElements.get("country-province")) {
  customElements.define("country-province", CountryProvinceForm);
}

/**
 * A custom element that manages shipping calculation form.
 *
 * @typedef {object} CartShippingRefs
 * @property {HTMLFormElement} form - The shipping calculation form.
 * @property {HTMLButtonElement} submitButton - The submit button.
 * @property {HTMLElement} resultsElement - The results container.
 * @property {HTMLInputElement} zipInput - The zip code input.
 * @property {CountryProvinceForm} countryProvince - The country-province component.
 *
 * @extends Component<CartShippingRefs>
 */
export class CartShippingComponent extends Component {
  requiredRefs = ["form", "submitButton", "resultsElement", "zipInput", "countryProvince"];

  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {boolean} */
  #isProcessing = false;

  /** @type {(event: Event) => void} */
  #handleFormSubmitBound = this.#handleFormSubmit.bind(this);

  connectedCallback() {
    super.connectedCallback();

    // Handle form submission
    this.refs.form.addEventListener("submit", this.#handleFormSubmitBound);
  }

  updatedCallback() {
    super.updatedCallback();

    // Re-setup after DOM morph (e.g., after cart quantity update)
    // Remove old listener and re-attach with new refs
    const oldForm = this.refs.form;
    if (oldForm) {
      oldForm.removeEventListener("submit", this.#handleFormSubmitBound);
    }
    this.refs.form.addEventListener("submit", this.#handleFormSubmitBound);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Remove event listener
    if (this.refs.form) {
      this.refs.form.removeEventListener("submit", this.#handleFormSubmitBound);
    }

    // Cancel any pending requests
    this.#abortController?.abort();
  }

  /**
   * Handle form submission for shipping calculation
   * @param {Event} event - The submit event
   */
  #handleFormSubmit(event) {
    event.preventDefault();

    // Prevent duplicate submissions
    if (this.#isProcessing) return;

    // Cancel any existing request
    this.#abortController?.abort();

    const zip = this.refs.zipInput.value.trim();
    const country = this.refs.countryProvince.refs.countryInput.value;
    const province = this.refs.countryProvince.refs.provinceInput.value;

    // Validate form data
    const validationError = this.#validateFormData(zip, country);
    if (validationError) {
      this.#formatError({ validation: validationError });
      this.refs.resultsElement.hidden = false;
      return;
    }

    this.#isProcessing = true;
    this.#addLoadingState();

    const body = JSON.stringify({
      shipping_address: { zip, country, province },
    });

    const sectionUrl = `${FoxTheme.routes.cart_url}/shipping_rates.json`;
    this.#abortController = new AbortController();

    fetch(sectionUrl, {
      ...fetchConfig("json", { body }),
      signal: this.#abortController.signal,
    })
      .then((response) => {
        return response.json().then((data) => {
          if (!response.ok) {
            // For validation errors (422), return the error data instead of throwing
            if (response.status === 422) {
              return data;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return data;
        });
      })
      .then((parsedState) => {
        if (parsedState.shipping_rates) {
          this.#formatShippingRates(parsedState.shipping_rates);
        } else {
          // Handle validation errors from server
          this.#formatServerErrors(parsedState);
        }
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          return; // Request was cancelled, no need to show error
        }
        console.error("Shipping calculation error:", error);
        this.#formatError({ error: "Unable to calculate shipping rates" });
      })
      .finally(() => {
        this.#isProcessing = false;
        this.#removeLoadingState();
        this.refs.resultsElement.hidden = false;
      });
  }

  /**
   * Validate form data
   * @param {string} zip - Zip code
   * @param {string} country - Country code
   * @returns {string | null} Error message or null if valid
   */
  #validateFormData(zip, country) {
    if (!zip) {
      return "Please enter a postal code";
    }

    if (!country) {
      return "Please select a country";
    }

    // Basic zip code validation (alphanumeric, 3-10 characters)
    if (!/^[a-zA-Z0-9\s-]{3,10}$/.test(zip)) {
      return "Please enter a valid postal code";
    }

    return null;
  }

  /**
   * Add loading state to submit button
   */
  #addLoadingState() {
    this.refs.submitButton.classList.add("btn--loading");
    this.refs.submitButton.disabled = true;
  }

  /**
   * Remove loading state from submit button
   */
  #removeLoadingState() {
    this.refs.submitButton.classList.remove("btn--loading");
    this.refs.submitButton.disabled = false;
  }

  /**
   * Format error message
   * @param {Object} errors - Error object
   */
  #formatError(errors) {
    const errorMessages = Object.values(errors);
    this.#renderErrorMessages(errorMessages);
  }

  /**
   * Render error messages with accessibility support
   * @param {Array<string>} errorMessages - Array of error messages
   */
  #renderErrorMessages(errorMessages) {
    const hasMultipleErrors = errorMessages.length > 1;

    this.refs.resultsElement.innerHTML = `
      <div class="alert alert--error text-left grid gap-2" role="alert" aria-live="polite">
        ${
          hasMultipleErrors
            ? `<ul class="list-disc grid gap-1 text-body-sm" role="list">${errorMessages.map((msg) => `<li>${msg}</li>`).join("")}</ul>`
            : `<p class="text-body-sm m-0">${errorMessages[0]}</p>`
        }
      </div>
    `;
  }

  /**
   * Format server validation errors
   * @param {Object} response - Server response object
   */
  #formatServerErrors(response) {
    // Handle different error formats from server
    let errorMessages = [];

    // Check if response has direct field errors (like {country: [...], zip: [...]})
    const hasFieldErrors = Object.keys(response).some((key) => Array.isArray(response[key]));

    if (hasFieldErrors) {
      // Handle validation errors like {country: ["Country/region not supported"], zip: ["Enter a valid PIN code for India"]}
      Object.entries(response).forEach(([field, messages]) => {
        if (Array.isArray(messages)) {
          errorMessages.push(...messages);
        } else {
          errorMessages.push(messages);
        }
      });
    } else if (response.errors) {
      // Handle nested errors object
      Object.entries(response.errors).forEach(([field, messages]) => {
        if (Array.isArray(messages)) {
          errorMessages.push(...messages);
        } else {
          errorMessages.push(messages);
        }
      });
    } else if (response.message) {
      // Handle simple error message
      errorMessages.push(response.message);
    } else if (typeof response === "string") {
      // Handle string response
      errorMessages.push(response);
    } else {
      // Fallback to generic error
      errorMessages.push("Unable to calculate shipping rates");
    }

    this.#renderErrorMessages(errorMessages);
  }

  /**
   * Format shipping rates results
   * @param {Array} shippingRates - Array of shipping rate objects
   */
  #formatShippingRates(shippingRates) {
    if (shippingRates.length === 0) {
      this.#formatError({ notFound: FoxTheme.translations.shipping_calculator_not_found });
      return;
    }

    const shippingRatesList = shippingRates.map(({ presentment_name, currency, price }) => {
      return `<li>${presentment_name}: ${currency} ${price}</li>`;
    });

    const message = this.#getShippingMessage(shippingRates.length);

    this.refs.resultsElement.innerHTML = `
      <div class="text-left alert alert--success grid gap-2" role="status" aria-live="polite">
        <p class="m-0">${message}</p>
        <ul class="list-disc grid gap-1 text-body-sm" role="list">${shippingRatesList.join("")}</ul>
      </div>
    `;
  }

  /**
   * Get appropriate message for shipping rates count
   * @param {number} count - Number of shipping rates
   * @returns {string} Formatted message
   */
  #getShippingMessage(count) {
    if (count === 1) {
      return FoxTheme.translations.shipping_calculator_one_result;
    }

    const message = FoxTheme.translations.shipping_calculator_multiple_results;
    return message.includes("{{ count }}") ? message.replace("{{ count }}", count) : message;
  }
}

if (!customElements.get("cart-shipping")) {
  customElements.define("cart-shipping", CartShippingComponent);
}
