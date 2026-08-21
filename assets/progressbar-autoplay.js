/**
 * Progressbar Autoplay feature for carousel
 * Animates Swiper's built-in progressbar pagination with autoplay
 */

/**
 * Setup progressbar autoplay animation
 * @param {CarouselComponent} carousel - Carousel component instance
 * @param {Record<string, any>} options - Swiper options
 */
export function setupProgressbarAutoplay(carousel, options) {
  if (!carousel.swiperInstance || !options.autoplay) return;

  const autoplayDelay = options.autoplay.delay || 5000;
  const progressbarEl = carousel.swiperInstance.pagination?.el;
  if (!progressbarEl) return;

  const progressbarFill = progressbarEl.querySelector(".swiper-pagination-progressbar-fill");
  if (!progressbarFill) return;

  // Reset progressbar immediately to prevent flash of default Swiper value
  const isHorizontal = carousel.swiperInstance.isHorizontal();
  const baseTransform = "translate3d(0,0,0)";
  progressbarFill.style.transition = "none";
  if (isHorizontal) {
    progressbarFill.style.transform = `${baseTransform} scaleX(0)`;
  } else {
    progressbarFill.style.transform = `${baseTransform} scaleY(0)`;
  }

  let progressAnimationRafId = null;

  const animateProgress = () => {
    if (progressAnimationRafId !== null) {
      cancelAnimationFrame(progressAnimationRafId);
    }

    // Wait for Swiper to finish updating progressbar
    requestAnimationFrame(() => {
      const isHorizontal = carousel.swiperInstance.isHorizontal();
      const baseTransform = "translate3d(0,0,0)";

      // Reset progressbar
      progressbarFill.style.transition = "none";
      if (isHorizontal) {
        progressbarFill.style.transform = `${baseTransform} scaleX(0)`;
      } else {
        progressbarFill.style.transform = `${baseTransform} scaleY(0)`;
      }

      // Start animation after reset
      const firstRaf = requestAnimationFrame(() => {
        const secondRaf = requestAnimationFrame(() => {
          progressAnimationRafId = null;
          if (isHorizontal) {
            progressbarFill.style.transition = `transform ${autoplayDelay}ms linear`;
            progressbarFill.style.transform = `${baseTransform} scaleX(1)`;
          } else {
            progressbarFill.style.transition = `transform ${autoplayDelay}ms linear`;
            progressbarFill.style.transform = `${baseTransform} scaleY(1)`;
          }
        });
        progressAnimationRafId = secondRaf;
      });
      progressAnimationRafId = firstRaf;
    });
  };

  // Reset progressbar before Swiper updates it (prevents flash of default value)
  carousel.swiperInstance.on("paginationRender", () => {
    progressbarFill.style.transition = "none";
    if (carousel.swiperInstance.isHorizontal()) {
      progressbarFill.style.transform = `${baseTransform} scaleX(0)`;
    } else {
      progressbarFill.style.transform = `${baseTransform} scaleY(0)`;
    }
  });

  // Start animation when autoplay starts
  carousel.swiperInstance.on("autoplayStart", animateProgress);

  // Restart animation after Swiper updates pagination (this happens on slideChange)
  carousel.swiperInstance.on("paginationUpdate", () => {
    // Only animate if autoplay is running
    if (carousel.swiperInstance.autoplay?.running) {
      animateProgress();
    }
  });

  // Restart animation on breakpoint change (e.g., desktop → mobile)
  // This ensures progressbar updates correctly when slidesPerView changes
  // Use debounce to avoid multiple calls during slow resize
  let breakpointAnimationTimeout = null;
  carousel.swiperInstance.on("breakpoint", () => {
    if (breakpointAnimationTimeout) clearTimeout(breakpointAnimationTimeout);
    breakpointAnimationTimeout = setTimeout(() => {
      if (carousel.swiperInstance.autoplay?.running) {
        // Wait a bit for Swiper to finish updating slides and pagination
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (carousel.swiperInstance.autoplay?.running) {
              animateProgress();
            }
            breakpointAnimationTimeout = null;
          });
        });
      } else {
        breakpointAnimationTimeout = null;
      }
    }, 150);
  });

  // Restart animation on resize (slidesPerView might change)
  // Use debounce to avoid multiple calls during slow resize
  let resizeAnimationTimeout = null;
  carousel.swiperInstance.on("resize", () => {
    if (resizeAnimationTimeout) clearTimeout(resizeAnimationTimeout);
    resizeAnimationTimeout = setTimeout(() => {
      if (carousel.swiperInstance.autoplay?.running) {
        // Wait a bit for Swiper to finish updating slides and pagination
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (carousel.swiperInstance.autoplay?.running) {
              animateProgress();
            }
            resizeAnimationTimeout = null;
          });
        });
      } else {
        resizeAnimationTimeout = null;
      }
    }, 150);
  });

  // Stop animation when autoplay stops/pauses
  carousel.swiperInstance.on("autoplayStop", () => {
    if (progressAnimationRafId !== null) {
      cancelAnimationFrame(progressAnimationRafId);
      progressAnimationRafId = null;
    }
    progressbarFill.style.transition = "none";
  });

  carousel.swiperInstance.on("autoplayPause", () => {
    if (progressAnimationRafId !== null) {
      cancelAnimationFrame(progressAnimationRafId);
      progressAnimationRafId = null;
    }
  });

  // Initial animation
  animateProgress();
}
