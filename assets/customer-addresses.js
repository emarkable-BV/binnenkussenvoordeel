import { Component } from "@theme/component";

class CustomerAddressesComponent extends Component {
  requiredRefs = ["container"];

  connectedCallback() {
    super.connectedCallback();
    this.#setupCountries();
  }

  updatedCallback() {
    super.updatedCallback();
    this.#setupCountries();
  }

  #setupCountries() {
    if (typeof Shopify === "undefined" || !Shopify.CountryProvinceSelector) return;

    new Shopify.CountryProvinceSelector("AddressCountryNew", "AddressProvinceNew", {
      hideElement: "AddressProvinceContainerNew",
    });

    // Setup for existing address forms
    const countrySelects = this.refs.container?.querySelectorAll("[data-address-country-select]");
    if (!countrySelects) return;

    for (const select of countrySelects) {
      const formId = select.dataset.formId;
      if (!formId) continue;

      new Shopify.CountryProvinceSelector(`AddressCountry_${formId}`, `AddressProvince_${formId}`, {
        hideElement: `AddressProvinceContainer_${formId}`,
      });
    }
  }

  onToggleAddress(event) {
    const { target } = event;
    const toggleTargetId = target?.dataset?.toggleTarget;
    if (!toggleTargetId) return;

    const toggleTarget = document.getElementById(toggleTargetId);
    if (!toggleTarget) return;

    toggleTarget.classList.toggle("hidden");
  }

  async onDeleteAddress(event) {
    const { target } = event;
    const confirmMessage = target.getAttribute("data-confirm-message");
    const deleteUrl = target.dataset.target;

    if (!confirmMessage || !deleteUrl) return;

    // eslint-disable-next-line no-alert
    if (confirm(confirmMessage)) {
      try {
        const response = await fetch(deleteUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: "_method=delete",
        });

        if (response.ok) {
          // Reload the page to show updated address list
          window.location.reload();
        } else {
          console.error("Failed to delete address:", response.statusText);
        }
      } catch (error) {
        console.error("Error deleting address:", error);
      }
    }
  }
}

customElements.define("customer-addresses-component", CustomerAddressesComponent);
