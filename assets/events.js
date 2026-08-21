/**
 * @namespace ThemeEvents
 * @description A collection of theme-specific events that can be used to trigger and listen for changes anywhere in the theme.
 * @example
 * document.dispatchEvent(new VariantUpdateEvent(variant, sectionId, { html }));
 * document.addEventListener(ThemeEvents.variantUpdate, (e) => { console.log(e.detail.variant) });
 */

export class ThemeEvents {
  /** @static @constant {string} Event triggered when a variant is selected */
  static variantSelected = "variant:selected";
  /** @static @constant {string} Event triggered when a variant is changed */
  static variantUpdate = "variant:update";
  /** @static @constant {string} Event triggered when the cart items or quantities are updated */
  static cartUpdate = "cart:update";
  /** @static @constant {string} Event triggered when a cart update fails */
  static cartError = "cart:error";
  /** @static @constant {string} Event triggered when a cart items added */
  static cartGroupedSections = "cart:grouped-sections";
  /** @static @constant {string} Event triggered when a media (video, 3d model) is loaded */
  static mediaStartedPlaying = "media:started-playing";
  /** @static @constant {string} Event triggered when 3D model interaction state changes */
  static modelInteraction = "model:interaction";
  // Event triggered when quantity-selector value is changed
  static quantitySelectorUpdate = "quantity-selector:update";
  /** @static @constant {string} Event triggered when a discount is applied */
  static discountUpdate = "discount:update";
  /** @static @constant {string} Event triggered when changing collection filters */
  static FilterUpdate = "filter:update";
  /** @static @constant {string} Event triggered when page transition starts */
  static pageTransitionStart = "page:transition:start";
  /** @static @constant {string} Event triggered when page transition ends */
  static pageTransitionEnd = "page:transition:end";
  /** @static @constant {string} Event triggered when page is loaded */
  static pageLoaded = "page:loaded";
  /** @static @constant {string} Event triggered when a quick view is loaded */
  static quickViewLoaded = "quick-view:loaded";
  /** @static @constant {string} Event triggered when a quick view is opened */
  static quickViewOpened = "quick-view:open";
  /** @static @constant {string} Event triggered when a collection page is re-rendered after filters are updated */
  static collectionRerendered = "collection:rerendered";
  /** @static @constant {string} Event triggered when product recommendations are loaded */
  static recommendationsLoaded = "recommendations:loaded";
  /** @static @constant {string} Event triggered when a variant is changed */
  static variantChanged = "variant:changed";
  /** @static @constant {string} Event triggered when cart is updated */
  static cartUpdated = "cart:updated";
  /** @static @constant {string} Event triggered when a product is added to cart via AJAX */
  static productAjaxAdded = "product-ajax:added";
  /** @static @constant {string} Event triggered when adding a product to cart fails */
  static productAjaxError = "product-ajax:error";
}

/**
 * Event fired when a variant is selected
 * @extends {Event}
 */
export class VariantSelectedEvent extends Event {
  /**
   * Creates a new VariantSelectedEvent
   * @param {Object} resource - The new variant object
   * @param {string} resource.id - The id of the variant
   */
  constructor(resource) {
    super(ThemeEvents.variantSelected, { bubbles: true });
    this.detail = {
      resource,
    };
  }
}

/**
 * Event fired after a variant is updated
 * @extends {Event}
 */
export class VariantUpdateEvent extends Event {
  /**
   * Creates a new VariantUpdateEvent
   * @param {Object} resource - The new variant object
   * @param {string} resource.id - The id of the variant
   * @param {boolean} resource.available - Whether the variant is available
   * @param {boolean} resource.inventory_management - Whether the variant has inventory management
   * @param {Object} [resource.featured_media] - The featured media of the variant
   * @param {string} [resource.featured_media.id] - The id of the featured media
   * @param {Object} [resource.featured_media.preview_image] - The preview image of the featured media
   * @param {string} [resource.featured_media.preview_image.src] - The src URL of the preview image
   * @param {string} sourceId - The id of the element the action was triggered from
   * @param {Object} data - Additional event data
   * @param {Document} data.html - The new document fragment for the variant
   * @param {string} data.productId - The product ID of the updated variant, used to ensure the correct product form is updated
   * @param {Object} [data.newProduct] - If a new product was loaded as part of the variant update (combined listing)
   * @param {string} data.newProduct.id - The id of the new product
   * @param {string} data.newProduct.url - The url of the new product
   * @param {boolean} [data.isOptimistic] - Whether an optimistic update was already dispatched (HTML not yet available)
   * @param {boolean} [data.isBackgroundSync] - Whether this is a background sync after cache hit
   */
  constructor(resource, sourceId, data) {
    super(ThemeEvents.variantUpdate, { bubbles: true });
    this.detail = {
      resource: resource || null,
      sourceId,
      data: {
        html: data.html,
        productId: data.productId,
        newProduct: data.newProduct,
        isOptimistic: data.isOptimistic,
        isBackgroundSync: data.isBackgroundSync,
      },
    };
  }
}

/**
 * Event class for cart additions
 * @extends {Event}
 */
export class CartAddEvent extends Event {
  /**
   * Creates a new CartAddEvent
   * @param {Object} [resource] - The new cart object
   * @param {string} [sourceId] - The id of the element the action was triggered from
   * @param {Object} [data] - Additional event data
   * @param {boolean} [data.didError] - Whether the cart operation failed
   * @param {string} [data.source] - The source of the cart update
   * @param {string} [data.productId] - The id of the product card that was updated
   * @param {number} [data.itemCount] - The number of items in the cart (incremental delta)
   * @param {string} [data.variantId] - The id of the product variant that was added
   * @param {Record<string, string>} [data.sections] - The sections affected by the cart operation
   */
  constructor(resource, sourceId, data) {
    super(CartAddEvent.eventName, { bubbles: true });
    this.detail = {
      resource,
      sourceId,
      data: {
        ...data,
        isIncremental: true, // Flag to indicate this is an incremental count
      },
    };
  }

  static eventName = ThemeEvents.cartUpdate;
}

/**
 * Event class for cart updates
 * @extends {Event}
 */
export class CartUpdateEvent extends Event {
  /**
   * Creates a new CartUpdateEvent
   * @param {Object} resource - The new cart object
   * @param {string} sourceId - The id of the element the action was triggered from
   * @param {Object} [data] - Additional event data
   * @param {boolean} [data.didError] - Whether the cart operation failed
   * @param {string} [data.source] - The source of the cart update
   * @param {string} [data.productId] - The id of the product card that was updated
   * @param {number} [data.itemCount] - The total number of items in the cart (absolute count)
   * @param {string} [data.variantId] - The id of the product variant that was updated
   * @param {Record<string, string>} [data.sections] - The sections affected by the cart operation
   */
  constructor(resource, sourceId, data) {
    super(ThemeEvents.cartUpdate, { bubbles: true });
    this.detail = {
      resource,
      sourceId,
      data: {
        ...data,
        isIncremental: false, // Flag to indicate this is an absolute count
      },
    };
  }
}

/**
 * Event class for cart errors
 * @extends {Event}
 */
export class CartErrorEvent extends Event {
  /**
   * Creates a new CartErrorEvent
   * @param {string} sourceId - The id of the element the action was triggered from
   * @param {string} message - A message from the server response
   */
  constructor(sourceId, message) {
    super(ThemeEvents.cartError, { bubbles: true });
    this.detail = {
      sourceId,
      data: {
        message,
      },
    };
  }
}

/**
 * Event class for cart grouped sections
 * @extends {Event}
 */
export class CartGroupedSections extends Event {
  /**
   * Creates a new CartGroupedSections
   * @param {string} sections - The id of the sections will be render
   */
  constructor(sections) {
    super(CartGroupedSections.eventName, { bubbles: true });
    this.detail = {
      sections,
    };
  }

  static eventName = ThemeEvents.cartGroupedSections;
}

/**
 * Event class for quantity-selector updates
 * @extends {Event}
 */
export class QuantitySelectorUpdateEvent extends Event {
  /**
   * Creates a new QuantitySelectorUpdateEvent
   * @param {number} quantity - Quantity value
   * @param {number} [cartLine] - The id of the updated cart line
   */
  constructor(quantity, cartLine) {
    super(ThemeEvents.quantitySelectorUpdate, { bubbles: true });
    this.detail = {
      quantity,
      cartLine,
    };
  }
}

/**
 * Event class for quantity-selector updates
 * @extends {Event}
 */
export class DiscountUpdateEvent extends Event {
  /**
   * Creates a new DiscountUpdateEvent
   * @param {Object} resource - The new cart object
   * @param {string} sourceId - The id of the element the action was triggered from
   */
  constructor(resource, sourceId) {
    super(ThemeEvents.discountUpdate, { bubbles: true });
    this.detail = {
      resource,
      sourceId,
    };
  }
}

/**
 * Event class for media playback starts
 * @extends {Event}
 */
export class MediaStartedPlayingEvent extends Event {
  /**
   * Creates a new MediaStartedPlayingEvent
   * @param {HTMLElement} resource - The element containing the video that emitted the event
   * @param {boolean} isAutoplay - Whether playback was triggered by autoplay
   */
  constructor(resource, isAutoplay = false) {
    super(ThemeEvents.mediaStartedPlaying, { bubbles: true });
    this.detail = {
      resource,
      isAutoplay,
    };
  }
}

/**
 * Event class for 3D model interaction (simple pause/play toggle)
 * @extends {Event}
 */
export class ModelInteractionEvent extends Event {
  /**
   * Creates a new ModelInteractionEvent
   * @param {HTMLElement} resource - The model element
   * @param {boolean} isInteracting - Whether user is interacting with model
   */
  constructor(resource, isInteracting) {
    super(ThemeEvents.modelInteraction, { bubbles: true });
    this.detail = {
      resource,
      isInteracting,
    };
  }
}

/** Event class for facet filtering updates */
export class FilterUpdateEvent extends Event {
  /** @param {URLSearchParams} queryParams */
  constructor(queryParams) {
    super(ThemeEvents.FilterUpdate, { bubbles: true });
    this.detail = {
      queryParams,
    };
  }

  shouldShowClearAll() {
    return [...this.detail.queryParams.entries()].filter(([key]) => key.startsWith("filter.")).length > 0;
  }
}
