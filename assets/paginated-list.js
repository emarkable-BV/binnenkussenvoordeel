import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";
import { sectionRenderer } from "@theme/section-renderer";
import { requestIdleCallback } from "@theme/utilities";

/**
 * Pagination types supported by the component
 */
const PAGINATION_TYPES = {
  NUMBER: "number", // Liquid pagination (default)
  LOAD_MORE: "load-more", // Click button to load more
  INFINITE: "infinite", // Scroll to load more
};

/**
 * PaginatedList Component
 * Supports 3 pagination types: number, load-more, infinite scroll
 */
export default class PaginatedList extends Component {
  /**
   * @type {Map<number, string>}
   */
  pages = new Map();

  /** @type {IntersectionObserver | undefined} */
  infinityScrollObserver;

  /** @type {((value: void) => void) | null} */
  #resolveNextPagePromise = null;

  /** @type {((value: void) => void) | null} */
  #resolvePreviousPagePromise = null;

  /** @type {string} */
  #paginationType;

  /** @type {boolean} */
  #isLoading = false;

  /** @type {boolean} */
  #preloadEnabled = true;

  /** @type {AbortController | null} */
  #filterUpdateController = null;

  connectedCallback() {
    super.connectedCallback();
    // Determine pagination type from attribute or default to number
    this.#paginationType = this.getAttribute("pagination-type") || PAGINATION_TYPES.NUMBER;

    // Determine preload setting from attribute or default to true
    this.#preloadEnabled = this.getAttribute("preload") !== "false";

    // Only initialize JS functionality for non-number pagination
    if (this.#paginationType !== PAGINATION_TYPES.NUMBER) {
      this.#initializeJSPagination();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Only cleanup if JS pagination is active
    if (this.#paginationType !== PAGINATION_TYPES.NUMBER) {
      this.#cleanupJSPagination();
    }
  }

  /**
   * Initialize JavaScript-based pagination
   */
  #initializeJSPagination() {
    // Initialize based on pagination type
    switch (this.#paginationType) {
      case PAGINATION_TYPES.LOAD_MORE:
        this.#initializeLoadMore();
        break;
      case PAGINATION_TYPES.INFINITE:
        this.#initializeInfiniteScroll();
        break;
    }

    // Listen for filter updates to clear cached pages
    document.addEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  /**
   * Cleanup JavaScript pagination resources
   */
  #cleanupJSPagination() {
    if (this.infinityScrollObserver) {
      this.infinityScrollObserver.disconnect();
    }
    document.removeEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  /**
   * Initialize load more button functionality
   */
  #initializeLoadMore() {
    this.#attachLoadMoreListener();

    // Preload next page for better UX (if enabled)
    if (this.#preloadEnabled) {
      this.#fetchPage("next");
    }
  }

  /**
   * Attach load more button click listener
   */
  #attachLoadMoreListener() {
    const loadMoreBtn = this.querySelector('[ref="loadMoreBtn"]');

    if (!loadMoreBtn) return;

    // Check if this specific button already has our listener attached
    // We check for a unique marker we set ourselves
    if (loadMoreBtn._paginatedListAttached === true) {
      return;
    }

    // Mark button as having our listener (using a property, not attribute)
    loadMoreBtn._paginatedListAttached = true;

    // Add click listener
    loadMoreBtn.addEventListener("click", () => this.#handleLoadMore());
  }

  /**
   * Initialize infinite scroll functionality
   */
  #initializeInfiniteScroll() {
    this.#observeViewMore();

    // Preload pages for better UX (if enabled)
    if (this.#preloadEnabled) {
      this.#fetchPage("next");
      this.#fetchPage("previous");
    }
  }

  /**
   * Handle load more button click
   */
  async #handleLoadMore() {
    if (this.#isLoading) return;

    const loadMoreBtn = this.querySelector('[ref="loadMoreBtn"]');
    if (!loadMoreBtn) return;

    // Show loading state
    loadMoreBtn.classList.add("btn--loading");

    try {
      await this.#renderNextPage();

      // Re-query button in case DOM was updated
      const currentBtn = this.querySelector('[ref="loadMoreBtn"]');
      if (!currentBtn) return;

      // Check if there are more pages
      const nextNextPage = this.#getPage("next");
      if (!nextNextPage || !this.#shouldUsePage(nextNextPage)) {
        currentBtn.style.display = "none"; // Hide button if no more pages
      }
    } catch (error) {
      console.error("Error loading more content:", error);
    } finally {
      // Re-query button to ensure we have the current reference
      const finalBtn = this.querySelector('[ref="loadMoreBtn"]');
      if (finalBtn) {
        finalBtn.classList.remove("btn--loading");
      }
    }
  }

  /**
   * Observe view more elements for infinite scroll
   */
  #observeViewMore() {
    const { viewMorePrevious, viewMoreNext } = this.refs;

    // Return if neither element exists
    if (!viewMorePrevious && !viewMoreNext) return;

    // Disconnect old observer if exists
    if (this.infinityScrollObserver) {
      this.infinityScrollObserver.disconnect();
    }

    // Create new observer
    this.infinityScrollObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this.#isLoading) {
            // Use current refs to check which element triggered
            const { viewMorePrevious, viewMoreNext } = this.refs;

            if (entry.target === viewMorePrevious) {
              this.#renderPreviousPage();
            } else if (entry.target === viewMoreNext) {
              this.#renderNextPage();
            }
          }
        }
      },
      {
        rootMargin: "100px",
      }
    );

    // Observe the view more elements
    if (viewMorePrevious) {
      this.infinityScrollObserver.observe(viewMorePrevious);
    }

    if (viewMoreNext) {
      this.infinityScrollObserver.observe(viewMoreNext);
    }
  }

  /**
   * @param {{ page: number, url?: URL } | undefined} pageInfo - The page info
   * @returns {boolean} Whether to use the page
   */
  #shouldUsePage(pageInfo) {
    if (!pageInfo) return false;

    const { grid } = this.refs;
    const lastPage = grid?.dataset.lastPage;

    if (!lastPage || pageInfo.page < 1 || pageInfo.page > Number(lastPage)) return false;

    return true;
  }

  /**
   * @param {"previous" | "next"} type
   */
  async #fetchPage(type) {
    const page = this.#getPage(type);

    // Always resolve the promise, even if we can't fetch the page
    const resolvePromise = () => {
      if (type === "next") {
        this.#resolveNextPagePromise?.();
        this.#resolveNextPagePromise = null;
      } else {
        this.#resolvePreviousPagePromise?.();
        this.#resolvePreviousPagePromise = null;
      }
    };

    if (!page || !this.#shouldUsePage(page)) {
      // Resolve the promise even if we can't fetch
      resolvePromise();
      return;
    }

    await this.#fetchSpecificPage(page.page, page.url);
    resolvePromise();
  }

  /**
   * @param {number} pageNumber - The page number to fetch
   * @param {URL} [url] - Optional URL, will be constructed if not provided
   */
  async #fetchSpecificPage(pageNumber, url = undefined) {
    const pageInfo = { page: pageNumber, url };

    if (!url) {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("page", pageNumber.toString());
      newUrl.hash = "";
      pageInfo.url = newUrl;
    }

    if (!this.#shouldUsePage(pageInfo)) return;

    try {
      const pageContent = await sectionRenderer.getSectionHTML(this.sectionId, true, pageInfo.url);
      this.pages.set(pageNumber, pageContent);
    } catch (error) {
      console.error(`Error fetching page ${pageNumber}:`, error);
      throw error; // Re-throw to allow caller to handle
    }
  }

  async #renderNextPage() {
    if (this.#isLoading) return;

    const { grid } = this.refs;
    if (!grid) return;

    this.#isLoading = true;

    // Show loading state for infinite scroll
    if (this.#paginationType === PAGINATION_TYPES.INFINITE) {
      this.#showLoadingState("next");
    }

    try {
      const nextPage = this.#getPage("next");

      if (!nextPage || !this.#shouldUsePage(nextPage)) {
        // Hide viewMoreNext when no more pages
        this.#hideViewMoreElement("next");
        return;
      }

      let nextPageItemElements = this.#getGridForPage(nextPage.page);

      if (!nextPageItemElements || nextPageItemElements.length === 0) {
        // Fetch the page directly
        await this.#fetchSpecificPage(nextPage.page, nextPage.url);
        nextPageItemElements = this.#getGridForPage(nextPage.page);
        if (!nextPageItemElements || nextPageItemElements.length === 0) {
          this.#hideViewMoreElement("next");
          return;
        }
      }

      grid.append(...nextPageItemElements);

      // Only update URL for infinite scroll
      if (this.#paginationType === PAGINATION_TYPES.INFINITE) {
        history.pushState("", "", nextPage.url.toString());
      }

      // Check if there are more pages after this one
      const nextNextPage = this.#getPage("next");
      if (!nextNextPage || !this.#shouldUsePage(nextNextPage)) {
        this.#hideViewMoreElement("next");
      }

      // Preload next page for better UX (if enabled)
      if (this.#preloadEnabled) {
        requestIdleCallback(() => {
          this.#fetchPage("next");
        });
      }
    } catch (error) {
      console.error("Error loading next page:", error);
    } finally {
      // Reset loading state
      this.#isLoading = false;
      if (this.#paginationType === PAGINATION_TYPES.INFINITE) {
        this.#hideLoadingState("next");
      }
    }
  }

  async #renderPreviousPage() {
    if (this.#isLoading) return;

    const { grid } = this.refs;
    if (!grid) return;

    this.#isLoading = true;

    // Show loading state for infinite scroll
    if (this.#paginationType === PAGINATION_TYPES.INFINITE) {
      this.#showLoadingState("previous");
    }

    try {
      const previousPage = this.#getPage("previous");
      if (!previousPage || !this.#shouldUsePage(previousPage)) {
        // Hide viewMorePrevious when no more pages
        this.#hideViewMoreElement("previous");
        return;
      }

      let previousPageItemElements = this.#getGridForPage(previousPage.page);
      if (!previousPageItemElements) {
        const promise = new Promise((res) => {
          this.#resolvePreviousPagePromise = res;
        });

        // Trigger the fetch for this page
        this.#fetchPage("previous");

        await promise;
        previousPageItemElements = this.#getGridForPage(previousPage.page);
        if (!previousPageItemElements) {
          this.#hideViewMoreElement("previous");
          return;
        }
      }

      // Store the current scroll position and height of the first element
      const scrollTop = window.scrollY;
      const firstElement = grid.firstElementChild;
      const oldHeight = firstElement
        ? firstElement.getBoundingClientRect().top + window.scrollY
        : 0;

      // Prepend the new elements
      grid.prepend(...previousPageItemElements);

      // Only update URL for infinite scroll
      if (this.#paginationType === PAGINATION_TYPES.INFINITE) {
        history.pushState("", "", previousPage.url.toString());
      }

      // Check if there are more pages before this one
      const prevPrevPage = this.#getPage("previous");
      if (!prevPrevPage || !this.#shouldUsePage(prevPrevPage)) {
        this.#hideViewMoreElement("previous");
      }

      // Calculate and adjust scroll position to maintain the same view
      if (firstElement) {
        const newHeight = firstElement.getBoundingClientRect().top + window.scrollY;
        const heightDiff = newHeight - oldHeight;
        window.scrollTo({
          top: scrollTop + heightDiff,
          behavior: "instant",
        });
      }

      // Preload previous page for better UX (if enabled)
      if (this.#preloadEnabled) {
        requestIdleCallback(() => {
          this.#fetchPage("previous");
        });
      }
    } catch (error) {
      console.error("Error loading previous page:", error);
    } finally {
      // Reset loading state
      this.#isLoading = false;
      if (this.#paginationType === PAGINATION_TYPES.INFINITE) {
        this.#hideLoadingState("previous");
      }
    }
  }

  /**
   * Show loading state for infinite scroll
   * @param {"previous" | "next"} type
   */
  #showLoadingState(type) {
    const element = this.refs[type === "previous" ? "viewMorePrevious" : "viewMoreNext"];
    if (element) {
      element.classList.add("btn--loading");
    }
  }

  /**
   * Hide loading state for infinite scroll
   * @param {"previous" | "next"} type
   */
  #hideLoadingState(type) {
    const element = this.refs[type === "previous" ? "viewMorePrevious" : "viewMoreNext"];
    if (element) {
      element.classList.remove("btn--loading");
    }
  }

  /**
   * Hide view more element when no more pages available
   * @param {"previous" | "next"} type
   */
  #hideViewMoreElement(type) {
    const element = this.refs[type === "previous" ? "viewMorePrevious" : "viewMoreNext"];
    if (element) {
      element.style.display = "none";

      // Disconnect observer for this element
      if (this.infinityScrollObserver) {
        this.infinityScrollObserver.unobserve(element);
      }
    }
  }

  /**
   * @param {"previous" | "next"} type
   * @returns {{ page: number, url: URL } | undefined}
   */
  #getPage(type) {
    const { cards } = this.refs;
    const isPrevious = type === "previous";

    if (!Array.isArray(cards)) return;

    const targetCard = cards[isPrevious ? 0 : cards.length - 1];

    if (!targetCard) return;

    const currentCardPage = Number(targetCard.dataset.page);
    const page = isPrevious ? currentCardPage - 1 : currentCardPage + 1;

    const url = new URL(window.location.href);
    url.searchParams.set("page", page.toString());
    url.hash = "";

    return {
      page,
      url,
    };
  }

  /**
   * @param {number} page
   * @returns {NodeListOf<Element> | undefined}
   */
  #getGridForPage(page) {
    const pageHTML = this.pages.get(page);

    if (!pageHTML) return;

    const parsedPage = new DOMParser().parseFromString(pageHTML, "text/html");
    const gridElement = parsedPage.querySelector('[ref="grid"]');
    if (!gridElement) return;

    return gridElement.querySelectorAll(':scope > [ref="cards[]"]');
  }

  get sectionId() {
    const id = this.getAttribute("section-id");

    if (!id) throw new Error("The section-id attribute is required");

    return id;
  }

  /**
   * Handle filter updates by clearing cached pages
   */
  #handleFilterUpdate = () => {
    // Cancel any previous filter update observer
    if (this.#filterUpdateController) {
      this.#filterUpdateController.abort();
    }

    // Create new abort controller for this filter update
    this.#filterUpdateController = new AbortController();
    const signal = this.#filterUpdateController.signal;

    this.pages.clear();

    // Resolve any pending promises to unblock waiting renders
    this.#resolveNextPagePromise?.();
    this.#resolvePreviousPagePromise?.();

    this.#resolveNextPagePromise = null;
    this.#resolvePreviousPagePromise = null;

    // Reset loading state
    this.#isLoading = false;

    // We need to wait for the DOM to be updated with the new filtered content
    // Using mutation observer to detect when the grid actually updates
    let hasProcessed = false;

    const observer = new MutationObserver(() => {
      // Check if this observer was aborted
      if (signal.aborted || hasProcessed) {
        observer.disconnect();
        return;
      }

      // Check if component is still connected
      if (!this.isConnected) {
        observer.disconnect();
        return;
      }

      // Mark as processed to avoid multiple triggers
      hasProcessed = true;
      observer.disconnect();

      // Re-initialize pagination based on type
      if (this.#paginationType === PAGINATION_TYPES.INFINITE) {
        // Re-observe view more elements for infinite scroll
        this.#observeViewMore();
      } else if (this.#paginationType === PAGINATION_TYPES.LOAD_MORE) {
        // Re-attach load more button listener
        this.#attachLoadMoreListener();
      }

      // Fetch the next page (if preload enabled)
      if (this.#preloadEnabled) {
        this.#fetchPage("next");
      }
    });

    // Observe the grid for changes
    const { grid } = this.refs;
    if (grid) {
      observer.observe(grid, {
        attributes: true,
        attributeFilter: ["data-last-page"],
        childList: true, // Also watch for child changes in case the whole grid is replaced
      });

      // Set a timeout as a fallback in case the mutation never fires
      setTimeout(() => {
        if (!signal.aborted && observer) {
          observer.disconnect();
        }
      }, 3000);
    }
  };
}
