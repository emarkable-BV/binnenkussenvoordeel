/**
 * Thumbnails feature for carousel
 * Displays thumbnail navigation for main carousel
 */

import { Swiper } from "@theme/swiper";

/**
 * Setup thumbnails feature
 * @param {CarouselComponent} carousel - Carousel component instance
 * @param {Record<string, any>} config - Thumbnails config
 */
export function setupThumbnails(carousel, config) {
  const thumbnailContainer = carousel.querySelector('[ref="thumbnails"]');
  if (!thumbnailContainer) {
    console.warn("Thumbnail container not found");
    return;
  }

  initThumbnailSwiper(carousel, config);
  bindThumbnailEvents(carousel);
  syncThumbnailsWithMain(carousel);
}

/**
 * Initialize thumbnail swiper instance.
 * @param {CarouselComponent} carousel
 * @param {Record<string, any>} config
 */
function initThumbnailSwiper(carousel, config) {
  const swiperEl = carousel.querySelector('[ref="thumbnails"] .carousel__thumbnails-swiper');
  if (!swiperEl) {
    console.warn("Thumbnail swiper element not found");
    return;
  }

  const swiperOptions = {
    slidesPerView: config.slidesPerView || 4,
    spaceBetween: config.spaceBetween || 8,
    watchSlidesProgress: true,
    slideToClickedSlide: true,
    centeredSlides: false,
    freeMode: false,
    ...config,
  };

  carousel.thumbnailSwiper = new Swiper(swiperEl, swiperOptions);
}

/**
 * Bind thumbnail click events via event delegation.
 * Delegation ensures deferred thumbnails (loaded after init) also work.
 * @param {CarouselComponent} carousel
 */
function bindThumbnailEvents(carousel) {
  const thumbnailContainer = carousel.querySelector('[ref="thumbnails"]');
  if (!thumbnailContainer) return;

  thumbnailContainer.addEventListener("click", (event) => {
    const thumb = event.target.closest(".carousel__thumbnail");
    if (!thumb) return;

    const allThumbs = Array.from(thumbnailContainer.querySelectorAll(".carousel__thumbnail"));
    const index = allThumbs.indexOf(thumb);
    if (index !== -1) {
      carousel.goToSlide(index);
    }
  });
}

/**
 * Sync thumbnails with main carousel slide changes.
 * @param {CarouselComponent} carousel
 */
function syncThumbnailsWithMain(carousel) {
  if (!carousel.swiperInstance) return;

  carousel.swiperInstance.on("slideChange", () => {
    const currentIndex = carousel.lastResolvedOptions?.loop
      ? (carousel.swiperInstance.realIndex ?? 0)
      : (carousel.swiperInstance.activeIndex ?? 0);

    updateActiveThumbnail(carousel, currentIndex);
  });

  // Set initial state
  const initialIndex = carousel.lastResolvedOptions?.loop
    ? (carousel.swiperInstance.realIndex ?? 0)
    : (carousel.swiperInstance.activeIndex ?? 0);
  updateActiveThumbnail(carousel, initialIndex);
}

/**
 * Update active thumbnail based on current slide.
 * Queries dynamically so deferred thumbnails are always included.
 * @param {CarouselComponent} carousel
 * @param {number} activeIndex
 */
function updateActiveThumbnail(carousel, activeIndex) {
  const thumbnailContainer = carousel.querySelector('[ref="thumbnails"]');
  if (!thumbnailContainer) return;

  const thumbs = thumbnailContainer.querySelectorAll(".carousel__thumbnail");
  thumbs.forEach((thumb, index) => {
    thumb.classList.toggle("is-active", index === activeIndex);
  });

  // Sync thumbnail swiper position
  if (carousel.thumbnailSwiper) {
    carousel.thumbnailSwiper.slideTo(activeIndex);
  }
}

/**
 * Destroy thumbnail swiper instance if present.
 * @param {CarouselComponent} carousel
 */
export function destroyThumbnailSwiper(carousel) {
  if (carousel.thumbnailSwiper) {
    try {
      carousel.thumbnailSwiper.destroy(true, true);
    } catch (_e) {
      // Ignore
    }
    carousel.thumbnailSwiper = null;
  }
}
