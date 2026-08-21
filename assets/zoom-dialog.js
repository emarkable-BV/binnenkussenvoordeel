import { PhotoSwipeLightbox, PhotoSwipe } from "@theme/photoswipe";

export function openPswp(items, index = 0, options = {}) {
  const lightbox = new PhotoSwipeLightbox({
    dataSource: items,
    pswpModule: PhotoSwipe,
    bgOpacity: 1,
    arrowPrev: false,
    arrowNext: false,
    close: false,
    showHideAnimationType: "zoom",
    wheelToZoom: true,
    counter: false,
    zoom: false,
    preloader: false,
    preload: [1, 4],
    ...options,
  });

  // Sync index changes back to caller (e.g., to update Swiper)
  lightbox.on("change", () => {
    const currentIndex = lightbox.pswp?.currIndex ?? 0;
    if (typeof options.onChange === "function") {
      try {
        options.onChange(currentIndex, lightbox);
      } catch (e) {
        // no-op
      }
    }
  });

  lightbox.on("uiRegister", () => {
    if (items.length > 1) {
      lightbox.pswp.ui.registerElement({
        name: "next",
        ariaLabel: "Next slide",
        order: 3,
        isButton: true,
        className: "btn btn--white btn--icon-only",
        html: '<svg xmlns="http://www.w3.org/2000/svg" class="icon icon--medium rtl-flip-x" viewBox="0 0 20 20"><path fill="none" d="M0 0H20V20H0V0z"/><path points="96 48 176 128 96 208" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="var(--icon-stroke-width, 2)" d="M7.5 3.75L13.75 10L7.5 16.25"/></svg>',
        onClick: () => {
          lightbox.pswp.next();
        },
      });
      lightbox.pswp.ui.registerElement({
        name: "prev",
        ariaLabel: "Previous slide",
        order: 1,
        isButton: true,
        className: "btn btn--white btn--icon-only",
        html: '<svg xmlns="http://www.w3.org/2000/svg" class="icon icon--medium rtl-flip-x" viewBox="0 0 20 20"><path fill="none" d="M0 0H20V20H0V0z"/><path points="160 208 80 128 160 48" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="var(--icon-stroke-width, 2)" d="M12.5 16.25L6.25 10L12.5 3.75"/></svg>',
        onClick: () => {
          lightbox.pswp.prev();
        },
      });
    }
    lightbox.pswp.ui.registerElement({
      name: "close-zoom",
      ariaLabel: "Close zoom image",
      order: 2,
      isButton: true,
      className: "btn btn--white btn--icon-only",
      html: '<svg xmlns="http://www.w3.org/2000/svg" class="icon icon--medium" viewBox="0 0 20 20"><path width="256" height="256" fill="none" d="M0 0H20V20H0V0z"/><path x1="200" y1="56" x2="56" y2="200" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="var(--icon-stroke-width, 2)" d="M15.625 4.375L4.375 15.625"/><path x1="200" y1="200" x2="56" y2="56" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="var(--icon-stroke-width, 2)" d="M15.625 15.625L4.375 4.375"/></svg>',
      onClick: () => {
        lightbox.pswp.close();
      },
    });
  });

  lightbox.addFilter("placeholderSrc", (placeholderSrc, { data }) => {
    if (data?.element instanceof HTMLElement && data.element.dataset.mediaSrc) {
      return data.element.dataset.mediaSrc;
    }
    return placeholderSrc;
  });

  lightbox.loadAndOpen(index);
}
