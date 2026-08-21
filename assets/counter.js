/**
 * Counter feature for carousel
 * Displays current slide / total slides
 */

/**
 * Setup counter feature
 * @param {CarouselComponent} carousel - Carousel component instance
 * @param {Record<string, any>} options - Swiper options
 */
export function setupCounter(carousel, options) {
  const instance = carousel.swiperInstance;
  if (!instance) return;

  // Respect explicit disabling: only attach when counter option is present and truthy
  if (!Object.prototype.hasOwnProperty.call(options || {}, "counter")) return;
  if (!options.counter) {
    const maybeEl = /** @type {HTMLElement | null} */ (carousel.querySelector('[ref="counter"]'));
    if (maybeEl) maybeEl.classList.add("hidden");
    return;
  }

  /** @type {HTMLElement | null} */
  let counterEl = null;
  if (options?.counter?.el instanceof HTMLElement) {
    counterEl = options.counter.el;
  } else {
    counterEl = /** @type {HTMLElement | null} */ (carousel.querySelector('[ref="counter"]'));
  }
  if (!counterEl) return;

  // Ensure visible when enabled
  counterEl.classList.remove("hidden");

  const counterFormat =
    (options?.counter && typeof options.counter.format === "string"
      ? options.counter.format
      : carousel.counterFormat) || "{current} / {total}";

  const render = () => renderCounter(carousel, counterEl, counterFormat);

  // Initial render and updates
  render();
  instance.on("slideChange", render);
  instance.on("slidesLengthChange", render);
  instance.on("update", render);
  // Update on breakpoint change (e.g., desktop → mobile) - debounce to avoid multiple calls
  // Use longer debounce to ensure Swiper has finished updating slides and snapGrid
  let breakpointRenderTimeout = null;
  instance.on("breakpoint", () => {
    if (breakpointRenderTimeout) clearTimeout(breakpointRenderTimeout);
    breakpointRenderTimeout = setTimeout(() => {
      // Wait for Swiper to finish updating slides and snapGrid
      requestAnimationFrame(() => {
        render();
        breakpointRenderTimeout = null;
      });
    }, 150);
  });
  // Update on resize (slidesPerView might change) - debounce to avoid multiple calls
  // Use longer debounce to ensure Swiper has finished updating slides and snapGrid
  let resizeRenderTimeout = null;
  instance.on("resize", () => {
    if (resizeRenderTimeout) clearTimeout(resizeRenderTimeout);
    resizeRenderTimeout = setTimeout(() => {
      // Wait for Swiper to finish updating slides and snapGrid
      requestAnimationFrame(() => {
        render();
        resizeRenderTimeout = null;
      });
    }, 150);
  });
  // Ensure counter updates when translating near the end (quick-add case)
  instance.on("setTranslate", render);
}

/**
 * Render counter text according to current/total slides.
 * @param {CarouselComponent} carousel
 * @param {HTMLElement} el
 * @param {string} format
 */
function renderCounter(carousel, el, format) {
  const instance = carousel.swiperInstance;
  if (!instance) return;

  const slides = Array.from(instance.slides || []);
  const total = slides.filter((s) => !s.classList.contains("swiper-slide-duplicate")).length;

  let currentIndex =
    typeof instance.realIndex === "number"
      ? instance.realIndex
      : typeof instance.activeIndex === "number"
        ? instance.activeIndex
        : 0;

  const params = instance.params || {};
  const slidesPerView = params.slidesPerView;
  const isDecimalSlidesPerView = typeof slidesPerView === "number" && slidesPerView % 1 !== 0;

  // Fix for slidesPerView: "auto" with partial slides visible
  // When we can't scroll anymore to the right, we're at the last slide
  // Check by comparing translate position with max translate
  if (params.slidesPerView === "auto") {
    const maxTranslate = instance.virtualSize - instance.size;
    const currentTranslate = Math.abs(instance.translate || 0);

    // If we're at or near the max translate position, we're at the last slide
    if (currentTranslate >= maxTranslate - 1) {
      currentIndex = total - 1;
    }
  } else if (isDecimalSlidesPerView) {
    // Fix for decimal slidesPerView (e.g., 1.5, 2.5, etc.)
    // With decimal slidesPerView, multiple slides can be visible, and activeIndex
    // might not accurately represent the "current" slide for counter purposes
    // We calculate based on translate position and snapGrid to find the current slide
    // This works with ANY decimal value (1.2, 1.5, 2.3, etc.) because we use
    // Swiper's own snapGrid and slidesGrid which are calculated dynamically

    const snapGrid = instance.snapGrid || [];
    const slidesGrid = instance.slidesGrid || [];
    const currentTranslate = Math.abs(instance.translate || 0);

    if (snapGrid.length > 0 && slidesGrid.length > 0) {
      // Find the closest snap point (this is what Swiper uses for activeIndex)
      // Swiper's snapGrid contains all possible snap positions, calculated based on
      // slidesPerView, slidesPerGroup, and actual slide sizes
      let closestSnapIndex = 0;
      let closestDistance = Infinity;

      for (let i = 0; i < snapGrid.length; i++) {
        const snapTranslate = Math.abs(snapGrid[i]);
        const distance = Math.abs(currentTranslate - snapTranslate);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestSnapIndex = i;
        }
      }

      // Map snapIndex back to slide index
      // For decimal slidesPerView, snapGrid might have more entries than slides
      // because each slide can have multiple snap points
      // We need to find which slide corresponds to this snap point
      const snapTranslate = Math.abs(snapGrid[closestSnapIndex]);

      // Find the slide whose start position is closest to this snap translate
      // Use tolerance of 1px to account for rounding differences
      let foundSlide = false;
      for (let i = 0; i < slidesGrid.length; i++) {
        const slideStart = Math.abs(slidesGrid[i]);
        const distance = Math.abs(slideStart - snapTranslate);

        // If we find an exact match or very close match, use this slide
        if (distance < 1) {
          currentIndex = i;
          foundSlide = true;
          break;
        }
      }

      // If no exact match found, find the slide that contains this snap point
      // This handles cases where snap point is between slides
      if (!foundSlide) {
        for (let i = 0; i < slidesGrid.length - 1; i++) {
          const slideStart = Math.abs(slidesGrid[i]);
          const slideEnd = Math.abs(slidesGrid[i + 1]);
          if (snapTranslate >= slideStart && snapTranslate < slideEnd) {
            currentIndex = i;
            foundSlide = true;
            break;
          }
        }
      }

      // Fallback: if still no match, use the slide closest to snap translate
      if (!foundSlide) {
        let closestSlideIndex = 0;
        let closestSlideDistance = Infinity;
        for (let i = 0; i < slidesGrid.length; i++) {
          const slideStart = Math.abs(slidesGrid[i]);
          const distance = Math.abs(slideStart - snapTranslate);
          if (distance < closestSlideDistance) {
            closestSlideDistance = distance;
            closestSlideIndex = i;
          }
        }
        currentIndex = closestSlideIndex;
      }
    } else if (snapGrid.length > 0) {
      // Fallback: use snapIndex directly if slidesGrid is not available
      // This is less accurate but better than nothing
      const snapIndex = Math.min(
        snapGrid.findIndex((snap) => Math.abs(Math.abs(snap) - currentTranslate) < 1) || 0,
        total - 1
      );
      currentIndex = snapIndex;
    }

    // Ensure index is within bounds
    currentIndex = Math.max(0, Math.min(currentIndex, total - 1));

    // Special case: if we're near the end, use the last slide
    // This handles edge cases where translate might be slightly off
    const maxTranslate = instance.maxTranslate ? Math.abs(instance.maxTranslate()) : 0;
    if (maxTranslate > 0 && currentTranslate >= maxTranslate - 10) {
      currentIndex = total - 1;
    }
  }

  const current = currentIndex + 1;

  const text = format.replace("{current}", String(current)).replace("{total}", String(total || slides.length || 0));

  el.textContent = text;
}
