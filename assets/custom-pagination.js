/**
 * Custom Pagination feature for carousel
 * Supports progress-text pagination with individual/combined modes
 */

import { isMobileBreakpoint } from "@theme/utilities";

/**
 * Setup custom pagination feature
 * @param {CarouselComponent} carousel - Carousel component instance
 * @param {Record<string, any>} options - Swiper options
 */
export function setupCustomPagination(carousel, options) {
  const config = options["custom-pagination"];
  if (!config) return;

  // Count actual slides after content_for 'blocks' has rendered
  const slides = carousel.querySelectorAll(`.${carousel.slideClass}`);
  if (slides.length === 0) return;

  // Create pagination DOM based on actual number of slides
  createPaginationDOM(carousel, slides, config);

  // Bind functionality
  bindPaginationEvents(carousel, config);
}

/**
 * Create pagination DOM elements based on slides data.
 * @param {CarouselComponent} carousel
 * @param {NodeListOf<Element>} slides
 * @param {Record<string, any>} config
 */
function createPaginationDOM(carousel, slides, config) {
  const container = /** @type {HTMLElement | null} */ (carousel.querySelector('[ref="custom-pagination"]'));
  if (!container) return;

  // Reset mode so updateCombinedPaginationState always runs after morph/recreate
  carousel.currentPaginationMode = null;

  // Clear existing content
  container.innerHTML = "";

  // Extract text data from each slide first to get slide count
  const slideData = Array.from(slides).map((slide, index) => {
    const textEl = slide.querySelector(config.textSelector || "[data-pagination-text]");
    return {
      text: textEl?.dataset.paginationText || `Slide ${index + 1}`,
      id: textEl?.dataset.slideId || `slide-${index}`,
      index,
    };
  });

  // Determine if should use combined pagination
  const shouldUseCombined = shouldUseCombinedPagination(slideData.length, config);

  if (shouldUseCombined) {
    const isMobile = isMobileBreakpoint(); // Use utility function for consistent breakpoint detection
    container.classList.add("carousel__custom-pagination--combined");
    container.classList.toggle("mobile-mode", isMobile);
    container.classList.toggle("desktop-mode", !isMobile);
  }

  // Always create combined pagination (for responsive switching)
  const combinedPagination = document.createElement("div");
  combinedPagination.className = "pagination-combined";
  combinedPagination.innerHTML = `
    <div class="pagination-combined__text">${slideData[0]?.text || "Slide 1"}</div>
    <div class="pagination-combined__progress">
      <div class="pagination-combined__progress-bar"></div>
    </div>
  `;
  container.appendChild(combinedPagination);

  // Always create individual pagination items (for responsive switching)
  slideData.forEach((data, index) => {
    const item = document.createElement("div");
    item.className = "pagination-item";
    item.dataset.slideIndex = String(index);
    item.dataset.slideId = data.id;

    item.innerHTML = `
      <div class="pagination-item__text">${data.text}</div>
      <div class="pagination-item__progress">
        <div class="pagination-item__progress-bar"></div>
      </div>
    `;

    container.appendChild(item);
  });

  // Store refs for later use
  carousel.paginationItems = container.querySelectorAll(".pagination-item");
  carousel.progressBars = container.querySelectorAll(".pagination-item__progress-bar");
  carousel.combinedProgressBar = container.querySelector(".pagination-combined__progress-bar");
  carousel.combinedText = container.querySelector(".pagination-combined__text");
  carousel.slideData = slideData;
  carousel.shouldUseCombined = shouldUseCombined;

  // Always handle responsive switching (even if initial mode is individual)
  handleCombinedPagination(carousel);
}

/**
 * Bind pagination click events and setup autoplay sync.
 * @param {CarouselComponent} carousel
 * @param {Record<string, any>} config
 */
function bindPaginationEvents(carousel, config) {
  if (!carousel.paginationItems) return;

  // Click events
  carousel.paginationItems.forEach((item, index) => {
    item.addEventListener("click", () => {
      if (carousel.swiperInstance) {
        // For loop mode, use slideTo with speed parameter
        // For normal mode, use standard slideTo
        if (carousel.lastResolvedOptions?.loop) {
          carousel.swiperInstance.slideToLoop(index);
        } else {
          carousel.swiperInstance.slideTo(index);
        }
      }
    });
  });

  // Progress animation setup if autoplay is enabled
  if (config.syncWithAutoplay && carousel.lastResolvedOptions?.autoplay) {
    carousel.autoplayDelay = carousel.lastResolvedOptions.autoplay.delay || 5000;
  }
}

/**
 * Update active pagination item and animate progress.
 * @param {CarouselComponent} carousel
 * @param {number} activeIndex
 */
export function updateActivePagination(carousel, activeIndex) {
  const shouldUseCombined = carousel.shouldUseCombined;

  // Ensure index is within bounds
  if (!carousel.slideData || activeIndex < 0 || activeIndex >= carousel.slideData.length) {
    return;
  }

  // Update individual pagination items only when not using combined mode
  if (!shouldUseCombined && carousel.paginationItems) {
    carousel.paginationItems.forEach((item, index) => {
      item.classList.toggle("is-active", index === activeIndex);
    });
  }

  // Update combined pagination text when using combined mode
  if (shouldUseCombined && carousel.combinedText && carousel.slideData) {
    const currentSlideData = carousel.slideData[activeIndex];
    if (currentSlideData) {
      carousel.combinedText.textContent = currentSlideData.text;
    }
  }

  animateProgress(carousel, activeIndex);
}

/**
 * Animate progress bar for active pagination item.
 * @param {CarouselComponent} carousel
 * @param {number} activeIndex
 */
function animateProgress(carousel, activeIndex) {
  // Cancel any pending animation to prevent multiple progress bars running simultaneously
  if (carousel.progressAnimationRafId !== null) {
    cancelAnimationFrame(carousel.progressAnimationRafId);
    carousel.progressAnimationRafId = null;
  }

  // Force stop all progress bar animations immediately (only when autoplay is enabled)
  // This prevents multiple progress bars from running when slideChange events fire rapidly
  if (carousel.autoplayDelay && carousel.progressBars) {
    carousel.progressBars.forEach((bar) => {
      bar.style.transform = "scaleX(0)";
      bar.style.transition = "none";
    });
  }
  if (carousel.combinedProgressBar) {
    carousel.combinedProgressBar.style.transition = "none";
  }

  const shouldUseCombined = carousel.shouldUseCombined;

  if (shouldUseCombined) {
    // Combined mode: progress represents current slide position
    if (carousel.combinedProgressBar && carousel.slideData) {
      if (carousel.autoplayDelay) {
        // With autoplay: animate to full then reset for next slide
        carousel.combinedProgressBar.style.transform = "scaleX(0)";
        carousel.combinedProgressBar.style.transition = "none";

        // Use double rAF instead of force reflow
        const firstRaf = requestAnimationFrame(() => {
          const secondRaf = requestAnimationFrame(() => {
            carousel.progressAnimationRafId = null;
            carousel.combinedProgressBar.style.transition = `transform ${carousel.autoplayDelay}ms linear`;
            carousel.combinedProgressBar.style.transform = "scaleX(1)";
          });
          carousel.progressAnimationRafId = secondRaf;
        });
        carousel.progressAnimationRafId = firstRaf;
      } else {
        // Without autoplay: show current slide progress percentage
        const progressPercent = ((activeIndex + 1) / carousel.slideData.length) * 100;
        carousel.combinedProgressBar.style.transition = "transform 300ms ease";
        carousel.combinedProgressBar.style.transform = `scaleX(${progressPercent / 100})`;
      }
    }
  } else {
    // Individual mode: only animate with autoplay
    if (carousel.autoplayDelay && carousel.progressBars) {
      // Note: All progress bars are already reset above
      const activeBar = carousel.progressBars[activeIndex];
      if (activeBar) {
        // Use double rAF instead of force reflow
        const firstRaf = requestAnimationFrame(() => {
          const secondRaf = requestAnimationFrame(() => {
            carousel.progressAnimationRafId = null;
            activeBar.style.transition = `transform ${carousel.autoplayDelay}ms linear`;
            activeBar.style.transform = "scaleX(1)";
          });
          carousel.progressAnimationRafId = secondRaf;
        });
        carousel.progressAnimationRafId = firstRaf;
      }
    }
    // Note: Individual active states are handled via CSS classes in updateActivePagination
  }
}

/**
 * Determine if should use combined pagination based on screen size and slide count
 * @param {number} slideCount - Number of slides
 * @param {Record<string, any>} config - Custom pagination config
 * @returns {boolean}
 */
function shouldUseCombinedPagination(slideCount, config) {
  const isMobile = isMobileBreakpoint();

  // Mobile has priority - check first
  if (isMobile) {
    return config.mobileCombined !== false;
  }

  // Desktop logic - only when NOT mobile
  const maxDesktopItems = config.maxDesktopItems || 5;
  const autoDesktopCombine = config.autoDesktopCombine !== false;

  return autoDesktopCombine && slideCount > maxDesktopItems;
}

/**
 * Handle combined pagination behavior via JavaScript
 * Note: Resize handling is now consolidated in #setupResizeHandler
 * @param {CarouselComponent} carousel
 */
function handleCombinedPagination(carousel) {
  // Initial check
  updateCombinedPaginationState(carousel);
}

/**
 * Update combined pagination state based on current viewport.
 * Called initially and on resize by unified resize handler.
 * @param {CarouselComponent} carousel
 */
export function updateCombinedPaginationState(carousel) {
  if (!carousel.slideData) return;

  const isMobile = isMobileBreakpoint();
  const shouldCombine = shouldUseCombinedPagination(
    carousel.slideData.length,
    carousel.lastResolvedOptions?.["custom-pagination"] || {}
  );

  // Determine specific mode
  const newMode = shouldCombine ? (isMobile ? "mobile-combined" : "desktop-combined") : "individual";

  // Get current mode from carousel (via public property)
  const currentMode = carousel.currentPaginationMode || null;

  // Skip if mode hasn't changed
  if (currentMode === newMode) {
    return;
  }

  // Update mode in carousel (public property)
  carousel.currentPaginationMode = newMode;

  // Update instance property that other methods depend on
  carousel.shouldUseCombined = shouldCombine;

  // Re-sync pagination with current swiper state after mode change
  if (carousel.swiperInstance) {
    const currentIndex = carousel.lastResolvedOptions?.loop
      ? (carousel.swiperInstance.realIndex ?? 0)
      : (carousel.swiperInstance.activeIndex ?? 0);
    updateActivePagination(carousel, currentIndex);
  }

  const container = carousel.querySelector('[ref="custom-pagination"]');
  if (!container) return;

  // Force clean all classes first for reliable updates
  container.classList.remove("carousel__custom-pagination--combined", "mobile-mode", "desktop-mode");

  if (shouldCombine) {
    // Add combined class and appropriate mode class
    container.classList.add("carousel__custom-pagination--combined");
    container.classList.add(isMobile ? "mobile-mode" : "desktop-mode");

    // Hide ALL pagination items when using combined mode
    if (carousel.paginationItems) {
      carousel.paginationItems.forEach((item) => {
        item.style.display = "none";
      });
    }

    // Show combined pagination
    if (carousel.combinedProgressBar && carousel.combinedText) {
      carousel.combinedProgressBar.parentElement.parentElement.style.display = "flex";
    }
  } else {
    // Show individual pagination items
    if (carousel.paginationItems) {
      carousel.paginationItems.forEach((item) => {
        item.style.display = "flex";
      });
    }

    // Hide combined pagination
    if (carousel.combinedProgressBar && carousel.combinedText) {
      carousel.combinedProgressBar.parentElement.parentElement.style.display = "none";
    }
  }
}
