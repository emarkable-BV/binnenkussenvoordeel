import { DialogComponent } from "@theme/dialog";

/**
 * A custom element that manages password entry dialog.
 * Auto-opens when form has errors after page reload.
 *
 * @extends {DialogComponent}
 */
export class PasswordDialogComponent extends DialogComponent {
  connectedCallback() {
    super.connectedCallback();

    // Auto-open dialog if there are form errors
    if (this.hasAttribute("data-has-errors")) {
      this.showDialog();
    }
  }
}

if (!customElements.get("password-dialog-component"))
  customElements.define("password-dialog-component", PasswordDialogComponent);
