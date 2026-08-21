import { Component } from "@theme/component";
import { isClickedOutside, onAnimationEnd, removeScrollLockClass } from "@theme/utilities";

// Track count of open scroll-lock layers (theme `<dialog scroll-lock>`, nested dialogs).
let lockDialogCount = 0;

/**
 * Increment global scroll-lock ref count. Use with {@link releaseThemeScrollLock}.
 * Mirrors `DialogComponent` when `<dialog scroll-lock>` opens.
 */
export function acquireThemeScrollLock() {
  lockDialogCount++;
  document.documentElement.setAttribute("scroll-lock", "");
  document.documentElement.classList.add("scroll-locked");
}

/**
 * Decrement global scroll-lock ref count; clears `html` lock only when count reaches 0.
 */
export function releaseThemeScrollLock() {
  lockDialogCount = Math.max(0, lockDialogCount - 1);
  if (lockDialogCount === 0) {
    document.documentElement.removeAttribute("scroll-lock");
  }
  removeScrollLockClass(document.documentElement, "scroll-locked", () => lockDialogCount === 0);
}

export class DialogComponent extends Component {
  requiredRefs = ["dialog"];

  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  /** @type {Element | null} */
  #previousActiveElement = null;

  /** @type {Element[]} */
  #focusableElements = [];

  /** @type {Function | null} */
  #focusTrapHandler = null;

  /** @type {Object | null} */
  #keyboardDetectionHandlers = null;

  connectedCallback() {
    super.connectedCallback();
    this.#registerDesignModeEvents();
  }

  disconnectedCallback() {
    // Clean up Theme Editor bindings
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();
  }

  /**
   * Shows the dialog.
   */
  showDialog() {
    const { dialog } = this.refs;

    if (dialog.open) return;

    // Store the currently focused element
    this.#previousActiveElement = document.activeElement;

    if (dialog.hasAttribute("scroll-lock")) {
      acquireThemeScrollLock();
    }

    dialog.showModal();
    dialog.setAttribute("open", "");
    this.dispatchEvent(new DialogOpenEvent());

    // Set up focus management after dialog is shown
    setTimeout(() => {
      this.#setupFocusManagement();
      this.addEventListener("click", this.#handleClick);
      this.addEventListener("keydown", this.#handleKeyDown);
    });
  }

  /**
   * Closes the dialog.
   */
  closeDialog = async () => {
    const { dialog } = this.refs;

    if (!dialog.open) return;

    this.removeEventListener("click", this.#handleClick);
    this.removeEventListener("keydown", this.#handleKeyDown);

    dialog.classList.add("dialog-closing");

    await onAnimationEnd(dialog, undefined, {
      subtree: false,
    });

    dialog.close();
    dialog.classList.remove("dialog-closing");

    if (dialog.hasAttribute("scroll-lock")) {
      releaseThemeScrollLock();
    }

    // Restore focus to the previously focused element
    this.#restoreFocus();

    this.dispatchEvent(new DialogCloseEvent());
  };

  /**
   * Register Shopify Theme Editor section select/deselect events when
   * this dialog opts-in via the `shopify-design-mode` attribute.
   */
  #registerDesignModeEvents() {
    // Only in Theme Editor and when explicitly opted-in
    if (!this.hasAttribute("shopify-design-mode")) return;
    if (!(window.Shopify && Shopify.designMode)) return;

    const section = this.closest(".shopify-section");
    if (!section) return;

    // Recreate controller to drop old listeners if any
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    // Open dialog when the section is selected in the editor
    section.addEventListener(
      "shopify:section:select",
      () => {
        // Avoid duplicate work; show only if not already open
        this.showDialog();
      },
      { signal }
    );

    // Close dialog when the section is deselected in the editor
    section.addEventListener(
      "shopify:section:deselect",
      () => {
        this.closeDialog();
      },
      { signal }
    );
  }

  /**
   * Toggles the dialog.
   */
  toggleDialog = () => {
    if (this.refs.dialog.open) {
      this.closeDialog();
    } else {
      this.showDialog();
    }
  };

  /**
   * Closes the dialog when the user clicks outside of it.
   *
   * @param {MouseEvent} event - The mouse event.
   */
  #handleClick(event) {
    const { dialog } = this.refs;

    if (isClickedOutside(event, dialog)) {
      this.closeDialog();
      event.stopPropagation();
    }
  }

  /**
   * Closes the dialog when the user presses the escape key.
   *
   * @param {KeyboardEvent} event - The keyboard event.
   */
  #handleKeyDown(event) {
    if (event.key !== "Escape") return;

    event.preventDefault();
    this.closeDialog();
  }

  /**
   * Sets up focus management for the dialog.
   */
  #setupFocusManagement() {
    const { dialog } = this.refs;

    // Get focusable elements within the dialog
    this.#focusableElements = this.#getFocusableElements(dialog);

    // Add keyboard navigation detection
    this.#setupKeyboardNavigationDetection();

    // Focus the target element or first focusable element (without outline)
    this.#focusTargetElement();

    if (this.#shouldEnableFocusTrap()) {
      this.#setupFocusTrap();
    }
  }

  /**
   * Checks if focus trap should be enabled.
   * Focus trap is enabled by default, disabled only if explicitly set to false.
   *
   * @returns {boolean} True if focus trap should be enabled
   */
  #shouldEnableFocusTrap() {
    const focusTrapValue = this.getAttribute("focus-trap");
    return focusTrapValue !== "false";
  }

  /**
   * Focuses the target element specified by focus-target attribute,
   * or the first focusable element if no target is specified.
   */
  #focusTargetElement() {
    const { dialog } = this.refs;
    const focusTarget = this.getAttribute("focus-target");

    let targetElement = null;

    if (focusTarget) {
      // Try to find the target element within the dialog
      const foundElement = dialog.querySelector(focusTarget);

      if (foundElement) {
        // Check if the element itself is focusable
        if (this.#isElementFocusable(foundElement)) {
          targetElement = foundElement;
        } else {
          // If not focusable, find the first focusable child
          const focusableChild = this.#getFocusableElements(foundElement)[0];
          if (focusableChild) {
            targetElement = focusableChild;
          }
        }
      }
    }

    // If no target found or specified, use the first focusable element
    if (!targetElement && this.#focusableElements.length > 0) {
      targetElement = this.#focusableElements[0];
    }

    if (targetElement) {
      // Focus without showing outline initially
      this.#focusWithoutOutline(targetElement);
    } else {
      console.log("No focusable element found");
    }
  }

  /**
   * Sets up focus trap to keep focus within the dialog.
   */
  #setupFocusTrap() {
    const { dialog } = this.refs;

    const handleTabKey = (event) => {
      if (event.key !== "Tab") return;

      // Refresh list on each Tab so dynamic tabindex / disabled / DOM changes are respected
      this.#focusableElements = this.#getFocusableElements(dialog);

      if (this.#focusableElements.length === 0) return;

      const firstElement = this.#focusableElements[0];
      const lastElement = this.#focusableElements[this.#focusableElements.length - 1];
      const activeElement = document.activeElement;
      const isFocusInDialog = dialog.contains(activeElement);
      const activeIndex = this.#focusableElements.indexOf(activeElement);

      // Focus left dialog or current focus is no longer in the focusable list (e.g. tabindex changed to -1)
      const shouldWrap = !isFocusInDialog || activeIndex === -1;

      if (event.shiftKey) {
        // Shift + Tab: going backwards
        if (activeElement === firstElement || shouldWrap) {
          event.preventDefault();
          event.stopPropagation();
          lastElement.focus();
        }
      } else {
        // Tab: going forwards
        if (activeElement === lastElement || shouldWrap) {
          event.preventDefault();
          event.stopPropagation();
          firstElement.focus();
        }
      }
    };

    // Attach listener to the component itself to catch events even when focus leaves dialog
    this.addEventListener("keydown", handleTabKey, true);

    // Store the handler for cleanup
    this.#focusTrapHandler = handleTabKey;
  }

  /**
   * Checks if an element is focusable.
   *
   * @param {Element} element - The element to check
   * @returns {boolean} True if the element is focusable
   */
  #isElementFocusable(element) {
    const focusableSelectors = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "a[href]",
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
    ];

    // Check if element matches any focusable selector
    const matchesSelector = focusableSelectors.some((selector) => {
      try {
        return element.matches(selector);
      } catch (e) {
        return false;
      }
    });

    if (!matchesSelector) return false;

    // Additional checks for visibility and interactivity
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && !element.hasAttribute("disabled");
  }

  /**
   * Gets all focusable elements within the dialog.
   *
   * @param {Element} container - The container to search within
   * @returns {Element[]} Array of focusable elements
   */
  #getFocusableElements(container) {
    const focusableSelectors = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "a[href]",
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
    ].join(", ");

    return Array.from(container.querySelectorAll(focusableSelectors)).filter((element) => {
      return this.#isElementFocusable(element);
    });
  }

  /**
   * Sets up keyboard navigation detection to show/hide focus outlines.
   */
  #setupKeyboardNavigationDetection() {
    const { dialog } = this.refs;

    // Detect when user starts using keyboard navigation
    const handleKeyDown = (event) => {
      if (event.key === "Tab") {
        dialog.classList.add("keyboard-navigation");
        // Mark as detected but keep handler for proper cleanup
        handleKeyDown._detected = true;
      }
    };

    // Detect when user clicks (mouse interaction)
    const handleMouseDown = () => {
      dialog.classList.remove("keyboard-navigation");
    };

    dialog.addEventListener("keydown", handleKeyDown);
    dialog.addEventListener("mousedown", handleMouseDown);

    // Store handlers for cleanup
    this.#keyboardDetectionHandlers = {
      keydown: handleKeyDown,
      mousedown: handleMouseDown,
    };
  }

  /**
   * Focuses an element without showing the outline initially.
   *
   * @param {Element} element - The element to focus
   */
  #focusWithoutOutline(element) {
    // Add class to prevent outline
    element.classList.add("focus-no-outline");

    // Focus the element
    element.focus();

    // Remove the class after a short delay to allow normal focus behavior
    setTimeout(() => {
      element.classList.remove("focus-no-outline");
    }, 100);

    // For input/textarea on mobile, scroll into view after virtual keyboard appears
    if (this.#isInputOrTextarea(element)) {
      this.#scrollInputIntoView(element);
    }
  }

  /**
   * Checks if an element is an input or textarea.
   *
   * @param {Element} element - The element to check
   * @returns {boolean} True if the element is input or textarea
   */
  #isInputOrTextarea(element) {
    return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.matches("input, textarea");
  }

  /**
   * Scrolls input/textarea into view after virtual keyboard appears on mobile.
   *
   * @param {Element} element - The input or textarea element
   */
  #scrollInputIntoView(element) {
    // Wait for virtual keyboard to appear (typically 300-500ms on mobile)
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      setTimeout(() => {
        // Check if element is still in the DOM and focused
        if (!document.contains(element) || document.activeElement !== element) {
          return;
        }

        // Scroll element into view with options to keep it visible
        element.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });

        // Additional scroll for dialog container if needed
        const { dialog } = this.refs;
        if (dialog && dialog.contains(element)) {
          // Ensure the dialog's scrollable container also scrolls if needed
          const scrollableParent = this.#findScrollableParent(element, dialog);
          if (scrollableParent && scrollableParent !== dialog) {
            const elementRect = element.getBoundingClientRect();
            const parentRect = scrollableParent.getBoundingClientRect();
            const elementTop = elementRect.top - parentRect.top + scrollableParent.scrollTop;

            // Scroll to center the element in the scrollable container
            scrollableParent.scrollTo({
              top: elementTop - scrollableParent.clientHeight / 2 + elementRect.height / 2,
              behavior: "smooth",
            });
          }
        }
      }, 350);
    });
  }

  /**
   * Finds the nearest scrollable parent element.
   *
   * @param {Element} element - The element to start from
   * @param {Element} container - The container to search within
   * @returns {Element | null} The scrollable parent or null
   */
  #findScrollableParent(element, container) {
    let parent = element.parentElement;

    while (parent && parent !== container) {
      const style = window.getComputedStyle(parent);
      const hasOverflow =
        style.overflow === "auto" ||
        style.overflow === "scroll" ||
        style.overflowY === "auto" ||
        style.overflowY === "scroll";
      const hasScrollableContent = parent.scrollHeight > parent.clientHeight;

      if (hasOverflow && hasScrollableContent) {
        return parent;
      }

      parent = parent.parentElement;
    }

    return null;
  }

  /**
   * Restores focus to the previously focused element.
   */
  #restoreFocus() {
    if (
      this.#previousActiveElement &&
      this.#previousActiveElement !== document.body &&
      document.contains(this.#previousActiveElement)
    ) {
      this.#previousActiveElement.focus();
    }

    this.#previousActiveElement = null;

    // Clean up focus trap handler
    if (this.#focusTrapHandler) {
      this.removeEventListener("keydown", this.#focusTrapHandler, true);
      this.#focusTrapHandler = null;
    }

    // Clean up keyboard detection handlers
    if (this.#keyboardDetectionHandlers) {
      const { dialog } = this.refs;
      // Safely remove handlers if they still exist
      if (this.#keyboardDetectionHandlers.keydown) {
        dialog.removeEventListener("keydown", this.#keyboardDetectionHandlers.keydown);
      }
      if (this.#keyboardDetectionHandlers.mousedown) {
        dialog.removeEventListener("mousedown", this.#keyboardDetectionHandlers.mousedown);
      }
      this.#keyboardDetectionHandlers = null;
    }

    this.#focusableElements = [];
  }
}

if (!customElements.get("dialog-component")) customElements.define("dialog-component", DialogComponent);

export class DialogOpenEvent extends CustomEvent {
  constructor() {
    super(DialogOpenEvent.eventName);
  }

  static eventName = "dialog:open";
}

export class DialogCloseEvent extends CustomEvent {
  constructor() {
    super(DialogCloseEvent.eventName);
  }

  static eventName = "dialog:close";
}
