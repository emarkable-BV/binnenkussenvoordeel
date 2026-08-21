/**
 * Navigation Position feature for carousel
 * Calculates and positions navigation buttons based on image height
 */

/**
 * Setup navigation position feature
 * @param {CarouselComponent} carousel - Carousel component instance
 * @param {Record<string, any>} options - Swiper options
 */
export function setupNavigationPosition(carousel, options) {
  const config = options?.navigationPosition;
  if (!config?.enabled) return;

  // Defer initial calculation to avoid force reflow during connectedCallback
  requestAnimationFrame(() => {
    calculateNavigationPosition(carousel, options);
  });
}

/**
 * Calculate and set navigation button position based on image height in slides.
 * Deferred to avoid force reflow on page load.
 * @param {CarouselComponent} carousel
 * @param {Record<string, any>} options
 */
function calculateNavigationPosition(carousel, options) {
  const config = options?.navigationPosition;
  if (!config?.enabled) return;

  const slides = carousel.querySelectorAll(`.${carousel.slideClass}`);
  if (slides.length === 0) return;

  // Always use IntersectionObserver to defer calculation until visible
  // This avoids force reflow from getBoundingClientRect/getComputedStyle
  deferNavigationCalculationUntilVisible(carousel, options);
}

/**
 * Calculate element height and offset from slide
 * @param {HTMLElement} element - Element to measure
 * @param {HTMLElement} slideEl - Slide element to calculate offset from
 * @returns {{ height: number, offsetTop: number }}
 */
function calculateElementOffsetFromSlide(element, slideEl) {
  // Get rect top from parent element instead of element itself to avoid wrong offset calculation with zoom effect.
  const elementWrap = element instanceof HTMLImageElement ? element.parentElement : element;

  // Auto detect offset when element not top.
  const elementRect = elementWrap.getBoundingClientRect();
  const slideRect = slideEl.getBoundingClientRect();
  const offsetTop = Math.ceil(elementRect.top - slideRect.top);

  return {
    height: element.offsetHeight,
    offsetTop: offsetTop,
  };
}

/**
 * Update navigation position on image loaded
 * @param {CarouselComponent} carousel
 * @param {HTMLImageElement} imageEl
 * @param {HTMLElement} slideEl
 * @param {Record<string, any>} config
 */
function updateNavigationPositionOnImageLoaded(carousel, imageEl, slideEl, config) {
  const measureAndUpdate = () => {
    requestAnimationFrame(() => {
      // Image already loaded, defer measurement to avoid force reflow
      const { height, offsetTop } = calculateElementOffsetFromSlide(imageEl, slideEl);
      config.offset = offsetTop;

      updateNavigationPosition(carousel, config, height, 1);
    });
  };

  if (imageEl.complete && imageEl.naturalHeight > 0) {
    measureAndUpdate();
  } else {
    imageEl.addEventListener("load", measureAndUpdate, { once: true }); // Wait for image to load
    imageEl.addEventListener(
      "error",
      () => {
        setNavigationPositionFallback(carousel, config);
      },
      { once: true }
    );
  }
}

/**
 * Update navigation position CSS variable based on calculated values.
 * @param {CarouselComponent} carousel
 * @param {Record<string, any>} config
 * @param {number} totalImageHeight
 * @param {number} imageCount
 */
function updateNavigationPosition(carousel, config, totalImageHeight, imageCount) {
  if (imageCount === 0) {
    // Fallback when no images found
    setNavigationPositionFallback(carousel, config);
    return;
  }

  const averageImageHeight = totalImageHeight / imageCount;
  const centerPosition = averageImageHeight / 2;
  const finalPosition = centerPosition + config.offset;

  // Set CSS variable for navigation buttons
  carousel.style.setProperty("--navigation-offset-top", `${finalPosition}px`);
}

/**
 * Set fallback navigation position when no images are found.
 * @param {CarouselComponent} carousel
 * @param {Record<string, any>} config
 */
function setNavigationPositionFallback(carousel, config) {
  const fallback = config.fallback;

  if (typeof fallback === "number") {
    carousel.style.setProperty("--navigation-offset-top", `${fallback}px`);
  } else {
    // Remove custom offset, let CSS handle fallback positioning
    carousel.style.removeProperty("--navigation-offset-top");
  }
}

/**
 * Perform the actual navigation position calculation with layout reads.
 * Only called when carousel is visible to avoid force reflow.
 * @param {CarouselComponent} carousel
 * @param {Record<string, any>} options
 */
export function performNavigationPositionCalculation(carousel, options) {
  const config = options?.navigationPosition;
  if (!config?.enabled) return;

  const slides = carousel.querySelectorAll(`.${carousel.slideClass}`);
  if (slides.length === 0) return;

  // Defer all layout measurements to next frame
  requestAnimationFrame(() => {
    // Only measure the first slide's image
    const firstSlide = slides[0];
    const firstImage = firstSlide.querySelector(config.selector);

    if (!firstImage) {
      // The given selector not found, use fallback
      setNavigationPositionFallback(carousel, config);
      return;
    }

    if (firstImage instanceof HTMLImageElement) {
      updateNavigationPositionOnImageLoaded(carousel, firstImage, firstSlide, config);
      return;
    } else if (firstImage instanceof SVGElement) {
      const rect = firstImage.getBoundingClientRect();
      updateNavigationPosition(carousel, config, rect.height, 1);
      return;
    }

    // Fallback if the given selector wrapper tag
    const childImage = firstImage.querySelector("img");
    if (childImage) {
      updateNavigationPositionOnImageLoaded(carousel, childImage, firstSlide, config);
      return;
    }

    // Finally, calculate position based on the given selector
    const { height, offsetTop } = calculateElementOffsetFromSlide(firstImage, firstSlide);
    config.offset = offsetTop;

    updateNavigationPosition(carousel, config, height, 1);
  });
}

/**
 * Defer navigation calculation until carousel becomes visible using IntersectionObserver.
 * Avoids force reflow from layout reads during page load.
 * @param {CarouselComponent} carousel
 * @param {Record<string, any>} options
 */
function deferNavigationCalculationUntilVisible(carousel, options) {
  // Clear any existing observer/timeout
  if (carousel.navigationPositionObserver) {
    carousel.navigationPositionObserver.disconnect();
    carousel.navigationPositionObserver = null;
  }

  const config = options?.navigationPosition;
  if (!config?.enabled) return;

  // Use IntersectionObserver to detect when carousel becomes visible
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.target === carousel) {
          // Carousel is now visible, perform calculation
          performNavigationPositionCalculation(carousel, options);
          observer.disconnect();
        }
      });
    },
    {
      threshold: 0.01, // Trigger as soon as any part is visible
      rootMargin: "50px", // Start loading slightly before entering viewport
    }
  );

  observer.observe(carousel);
  carousel.navigationPositionObserver = observer;
}
