/**
 * Testimonial Slider Library
 * A flexible, accessible slider component that can be used for testimonials, galleries, or any content
 *
 * Features:
 * - Responsive breakpoints (Swiper-like)
 * - Drag/swipe support
 * - Keyboard navigation
 * - Accessibility (ARIA, screen reader support)
 * - Smooth animations with CSS variables
 * - Seamless infinite loop with DOM reordering
 *
 * Usage:
 * const slider = createSlider({
 *   containerId: "my-container",
 *   trackId: "my-track",
 *   slidesSelector: ".testimonial-slider__slide"
 * });
 */

import { throttle, isMobileBreakpoint, isRTL } from "@theme/utilities";

/**
 * Creates a testimonial slider instance
 * @param {Object} config - Configuration object
 * @param {string} config.containerId - ID of the container element
 * @param {string} config.trackId - ID of the track element
 * @param {string} config.slidesSelector - CSS selector for slides
 * @param {Object} [config.options] - Slider options
 * @returns {Object} Slider instance with methods
 */
export function createSlider(config) {
  const {
    elId,
    containerId,
    trackId,
    slidesSelector,
    thumbnailsId,
    paginationId,
    prevBtnId,
    nextBtnId,
    counterId,
    enableWheel = false,
    slideWidth,
    autoplay = false,
    autoplayDelay = 5000,
    pauseOnHover = true,
  } = config;

  const el = document.getElementById(elId);
  const container = document.getElementById(containerId);
  const track = document.getElementById(trackId);
  const slides = track?.querySelectorAll(slidesSelector) || [];
  const thumbnailsContainer = document.getElementById(thumbnailsId);
  const thumbnails = thumbnailsContainer
    ? thumbnailsContainer.querySelectorAll(".testimonial-slider__thumbnail")
    : [];
  const paginationContainer = document.getElementById(paginationId);
  const progressBar = paginationContainer
    ? paginationContainer.querySelector(".testimonial-slider__progress")
    : null;
  const prevBtn = document.getElementById(prevBtnId);
  const nextBtn = document.getElementById(nextBtnId);
  const counter = document.getElementById(counterId);

  if (!el || !container || !track) {
    console.error(`Slider: Required elements not found for ${elId}`);
    return null;
  }

  let activeIndex = 0;
  let isDragging = false;
  let isAnimating = false; // Prevent spam clicking during animation
  let dragDirection = null; // 'horizontal', 'vertical', or null
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let currentX = 0;
  let currentTranslate = 0;
  let prevTranslate = 0;
  let isClick = true;
  let isMobile = window.innerWidth < 768;
  let resizeTimeout = null;
  let autoplayTimer = null; // Autoplay timer
  let isInViewport = false; // Track if slider is in viewport
  let intersectionObserver = null; // Intersection observer instance
  const rtl = isRTL();

  // Apply default CSS variables
  function applyDefaults() {
    // avatarSize and itemGap are now handled by CSS media queries
    if (slideWidth) {
      container.style.setProperty("--slide-width", `${slideWidth}px`);
    }

    // Reset progress bar
    if (progressBar) {
      if (autoplay) {
        // Autoplay mode: use inline style
        progressBar.style.transition = "none";
        progressBar.style.width = "0%";
      } else {
        // Manual mode: use CSS variable
        progressBar.style.setProperty("--progress-width", "0%");
      }
    }
  }

  // Calculate offset for track positioning
  function calculateOffset(targetIndex) {
    let offset = 0;

    if (isMobileBreakpoint()) {
      const containerWidth = container.offsetWidth;
      const gap = 20; // Mobile gap from CSS
      offset = targetIndex * (containerWidth + gap);
    } else {
      // Read from CSS variables (set by media queries in CSS)
      const elStyles = getComputedStyle(el);
      const containerStyles = getComputedStyle(container);
      const avatarSizeValue = parseInt(elStyles.getPropertyValue("--avatar-size")) || 170;
      const itemGapValue = parseInt(containerStyles.getPropertyValue("--item-gap")) || 10;

      for (let i = 0; i < targetIndex; i++) {
        offset += avatarSizeValue;
        offset += itemGapValue;
      }
    }
    return rtl ? offset : -offset;
  }

  // Disable transitions temporarily
  function disableTransitions() {
    track.style.transition = "none";
    slides.forEach((slide) => {
      slide.style.transition = "none";
      const content = slide.querySelector(".testimonial-slider__slide-content");
      if (content) content.style.transition = "none";
    });
  }

  // Re-enable transitions
  function enableTransitions() {
    track.style.transition = "";
    slides.forEach((slide) => {
      slide.style.transition = "";
      const content = slide.querySelector(".testimonial-slider__slide-content");
      if (content) content.style.transition = "";
    });
  }

  // Activate a slide
  function activate(targetIndex, force = false, skipScroll = false, skipCSSVars = false) {
    if (!force && targetIndex === activeIndex) return;
    if (targetIndex < 0 || targetIndex >= slides.length) return;

    // Prevent spam clicking during animation (but allow drag to interrupt)
    // Note: drag sets isAnimating = false before calling activate
    if (!force && isAnimating) return;
    isAnimating = true;

    // Update thumbnails
    thumbnails.forEach((t) => t.classList.remove("testimonial-slider__thumbnail--active"));
    if (thumbnails[targetIndex]) {
      thumbnails[targetIndex].classList.add("testimonial-slider__thumbnail--active");
    }

    // Scroll thumbnail into view on mobile (skip during init/force to prevent unwanted page scroll)
    if (!skipScroll && isMobile && thumbnails[targetIndex]) {
      thumbnails[targetIndex].scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }

    // Update CSS variables (skip if called from init)
    if (!skipCSSVars) {
      updateCSSVariables();
    }

    // Apply translate for both desktop and mobile (staggered animation)
    // CRITICAL: Set transitions BEFORE changing classes to prevent jump
    const slideDuration = 600; // Longer for visible margin collapse
    const heightDuration = 400; // Match margin duration
    // Use ease-out for natural deceleration without overshoot
    const transformEasing = "cubic-bezier(0.25, 0.1, 0.25, 1)"; // Ease-out (no bounce)
    const marginEasing = "cubic-bezier(0.25, 0.1, 0.25, 1)"; // Same easing for sync

    // 1. Set transitions first
    track.style.transition = `transform ${slideDuration}ms ${transformEasing}, height ${heightDuration}ms ${transformEasing}`;

    slides.forEach((slide) => {
      slide.style.transition = `margin ${slideDuration}ms ${marginEasing}`;

      // Content transition
      const content = slide.querySelector(".testimonial-slider__slide-content");
      if (content) {
        const isBecomingActive = slide === slides[targetIndex];

        if (isMobile) {
          // Mobile: quick fade to prevent overlap, no delay
          const mobileDuration = isBecomingActive ? 350 : 200;
          content.style.transition = `
            opacity ${mobileDuration}ms ease-out,
            visibility ${mobileDuration}ms ease-out
          `;
        } else {
          // Desktop: clip-path + opacity with delay
          const opacityDuration = isBecomingActive ? 400 : 250;
          const opacityDelay = isBecomingActive ? 100 : 0;

          content.style.transition = `
            clip-path ${slideDuration}ms ${marginEasing},
            opacity ${opacityDuration}ms ${marginEasing} ${opacityDelay}ms,
            visibility ${opacityDuration}ms ${marginEasing} ${opacityDelay}ms
          `;
        }
      }
    });

    // 2. Then change classes (this triggers margin change with transition)
    requestAnimationFrame(() => {
      // Remove all state classes and add inactive to all first
      slides.forEach((s) => {
        s.classList.remove(
          "testimonial-slider__slide--active",
          "testimonial-slider__slide--prev",
          "testimonial-slider__slide--next",
          "testimonial-slider__slide--done"
        );
        // Add inactive class to all slides initially
        s.classList.add("testimonial-slider__slide--inactive");
      });

      // Remove inactive and add active class to target
      slides[targetIndex].classList.remove("testimonial-slider__slide--inactive");
      slides[targetIndex].classList.add("testimonial-slider__slide--active");

      // Add prev class to slides before active (keep inactive)
      for (let i = 0; i < targetIndex; i++) {
        slides[i].classList.add("testimonial-slider__slide--prev");
      }

      // Add next class to slides after active (keep inactive)
      for (let i = targetIndex + 1; i < slides.length; i++) {
        slides[i].classList.add("testimonial-slider__slide--next");
      }

      // 3. Start translate animation (in same frame as class change)
      const offset = calculateOffset(targetIndex);
      track.style.transform = `translate3d(${offset}px, 0, 0)`;
      currentTranslate = offset;
      prevTranslate = offset;

      // 4. Height change with stagger delay
      setTimeout(() => {
        const activeSlideHeight = slides[targetIndex].offsetHeight;
        track.style.height = `${activeSlideHeight}px`;
      }, 400); // Wait for content expansion to complete

      // 5. Mark complete and clean up inline transitions
      setTimeout(() => {
        slides[targetIndex].classList.add("testimonial-slider__slide--done");
        // Clean up inline transitions after animation completes
        track.style.transition = "";
        slides.forEach((slide) => {
          slide.style.transition = "";
          const content = slide.querySelector(".testimonial-slider__slide-content");
          if (content) {
            content.style.transition = "";
          }
        });

        // Re-enable clicking after animation completes
        isAnimating = false;
      }, slideDuration);
    });

    // Update progress bar
    if (progressBar && slides.length > 1) {
      const progress = ((targetIndex + 1) / slides.length) * 100;

      // Manual mode: use CSS variable
      if (!autoplay) {
        progressBar.style.setProperty("--progress-width", `${progress}%`);
      }

      // Update ARIA for progress bar
      const progressContainer = progressBar.closest('[role="progressbar"]');
      if (progressContainer) {
        progressContainer.setAttribute("aria-valuenow", Math.round(progress));
        progressContainer.setAttribute("aria-valuemin", "0");
        progressContainer.setAttribute("aria-valuemax", "100");
      }
    }

    // Update counter
    if (counter) {
      counter.textContent = `${targetIndex + 1}/${slides.length}`;
    }

    // Update navigation buttons
    if (prevBtn) {
      prevBtn.disabled = targetIndex === 0;
    }
    if (nextBtn) {
      nextBtn.disabled = targetIndex === slides.length - 1;
    }

    // Toggle edge classes for shadow indicators
    const isAtStart = targetIndex === 0;
    const isAtEnd = targetIndex === slides.length - 1;

    el.classList.toggle("is-at-start", isAtStart);
    el.classList.toggle("is-at-end", isAtEnd);

    // Update tabindex for focus management
    slides.forEach((slide, i) => {
      slide.setAttribute("tabindex", i === targetIndex ? "0" : "-1");
      slide.setAttribute("aria-label", `Testimonial ${i + 1} of ${slides.length}`);
    });

    // Move focus to active slide if user was focused on a slide (with preventScroll)
    if (
      document.activeElement &&
      document.activeElement.classList.contains("testimonial-slider__slide")
    ) {
      slides[targetIndex].focus({ preventScroll: true });
    }

    // Screen reader announcement
    const srAnnouncements =
      document.getElementById("sr-announcements") ||
      container
        .closest(".testimonial-slider__wrapper")
        ?.querySelector(".visually-hidden[aria-live]");
    if (srAnnouncements) {
      srAnnouncements.textContent = `Showing slide ${targetIndex + 1} of ${slides.length}`;
    }

    activeIndex = targetIndex;

    // Reset autoplay timer after manual interaction
    if (autoplay) {
      stopAutoplay();
      startAutoplay();
    }
  }

  // Autoplay functions
  function startAutoplay() {
    if (!autoplay || slides.length <= 1) return;

    // Only start if slider is in viewport
    if (!isInViewport) return;

    stopAutoplay(); // Clear existing timer

    // Animate progress bar if available
    if (progressBar) {
      progressBar.style.transition = `width ${autoplayDelay}ms linear`;
      progressBar.style.width = "100%";
    }

    autoplayTimer = setTimeout(() => {
      const nextIndex = activeIndex < slides.length - 1 ? activeIndex + 1 : 0;
      activate(nextIndex);
    }, autoplayDelay);
  }

  function stopAutoplay() {
    if (autoplayTimer) {
      clearTimeout(autoplayTimer);
      autoplayTimer = null;
    }

    // Reset progress bar animation
    if (progressBar) {
      progressBar.style.transition = "none";
      progressBar.style.width = "0%";
      // Force reflow to apply transition: none immediately
      void progressBar.offsetWidth;
    }
  }

  // Helper functions for drag
  function getPositionX(e) {
    return e.type.includes("mouse") ? e.pageX : e.touches[0].clientX;
  }

  function getPositionY(e) {
    return e.type.includes("mouse") ? e.pageY : e.touches[0].clientY;
  }

  // Handle drag start
  function dragStart(e) {
    // Don't allow drag if only 1 slide
    if (slides.length <= 1) return;

    isDragging = false; // Don't commit yet, wait for direction detection
    dragDirection = null;
    isClick = true;
    startX = getPositionX(e);
    startY = getPositionY(e);
    startTime = Date.now();

    // Pause autoplay during drag
    if (autoplay) {
      stopAutoplay();
    }
  }

  // Handle drag move
  function drag(e) {
    // Need start position to calculate
    if (startX === 0 && startY === 0) return;

    currentX = getPositionX(e);
    const currentY = getPositionY(e);
    const diffX = currentX - startX;
    const diffY = currentY - startY;

    // Detect direction on first significant movement (threshold: 10px)
    if (dragDirection === null && (Math.abs(diffX) > 10 || Math.abs(diffY) > 10)) {
      dragDirection = Math.abs(diffX) > Math.abs(diffY) ? "horizontal" : "vertical";

      // If horizontal drag, commit to drag mode
      if (dragDirection === "horizontal") {
        isDragging = true;
        container.classList.add("testimonial-slider__container--dragging");
        track.style.transition = "none";
      }
      // If vertical, let browser handle scroll
      else {
        return;
      }
    }

    // Only proceed if committed to horizontal drag
    if (!isDragging || dragDirection !== "horizontal") return;

    // Prevent default for horizontal drag (only if cancelable)
    if (e.cancelable) {
      e.preventDefault();
    }

    // Mark as not a click
    if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
      isClick = false;
    }

    // Apply visual feedback during drag
    if (!isClick && Math.abs(diffX) > 5) {
      // Calculate drag offset - full 1:1 ratio for natural feel (like Swiper/Embla)
      // Only apply resistance at boundaries
      const dragFactor = rtl ? -1 : 1;
      let dragOffset = currentTranslate + diffX * dragFactor;

      // Apply resistance only when dragging beyond boundaries
      const maxOffset = rtl ? calculateOffset(slides.length - 1) : 0;
      const minOffset = rtl ? 0 : calculateOffset(slides.length - 1);

      if (dragOffset > maxOffset) {
        // Dragging past first slide - apply resistance
        const overflow = dragOffset - maxOffset;
        dragOffset = maxOffset + overflow * 0.3;
      } else if (dragOffset < minOffset) {
        // Dragging past last slide - apply resistance
        const overflow = minOffset - dragOffset;
        dragOffset = minOffset - overflow * 0.3;
      }

      track.style.transform = `translate3d(${dragOffset}px, 0, 0)`;
    }
  }

  // Handle drag end
  function dragEnd(e) {
    if (!isDragging) {
      // Reset for next potential drag
      dragDirection = null;
      startX = 0;
      startY = 0;
      return;
    }

    isDragging = false;
    dragDirection = null;
    container.classList.remove("testimonial-slider__container--dragging");

    // Allow drag to interrupt ongoing animation
    // This makes the slider more responsive to rapid gestures
    isAnimating = false;

    const diffX = currentX - startX;
    const diffTime = Date.now() - startTime;

    // Threshold logic (inspired by Swiper/Embla):
    // 1. Distance-based: drag past 50% of slide width
    // 2. Velocity-based: fast swipe (>0.3px/ms) with minimum 50px distance

    const activeSlide = slides[activeIndex];
    const slideWidth = activeSlide ? activeSlide.offsetWidth : container.offsetWidth;

    // Primary threshold: 50% of current slide width (industry standard)
    const distanceThreshold = slideWidth * 0.5;

    // Secondary threshold: velocity-based for quick swipes
    // Ensure diffTime is at least 1ms to avoid division by zero or infinity
    const velocity = diffTime > 0 ? Math.abs(diffX) / Math.max(diffTime, 1) : 0;
    const minSwipeDistance = 50; // Minimum distance for velocity-based trigger
    const minSwipeVelocity = 0.3; // px/ms (slower than before for easier triggering)
    const isQuickSwipe = velocity > minSwipeVelocity && Math.abs(diffX) > minSwipeDistance;

    // Determine if we should change slide
    let shouldChangeSlide = false;
    let targetIndex = activeIndex;
    const dragFactor = rtl ? -1 : 1;

    if (!isClick && (Math.abs(diffX) > distanceThreshold || isQuickSwipe)) {
      if (diffX * dragFactor > 0 && activeIndex > 0) {
        // Dragging right (prev slide)
        shouldChangeSlide = true;
        targetIndex = activeIndex - 1;
      } else if (diffX * dragFactor < 0 && activeIndex < slides.length - 1) {
        // Dragging left (next slide)
        shouldChangeSlide = true;
        targetIndex = activeIndex + 1;
      }
    }

    if (shouldChangeSlide) {
      // Slide change: activate() will handle transition and isAnimating flag
      activate(targetIndex);
    } else {
      // No slide change: snap back with inline transition (like Swiper/Embla)
      const snapDuration = 300;
      track.style.transition = `transform ${snapDuration}ms ease-out`;

      const offset = calculateOffset(activeIndex);
      track.style.transform = `translate3d(${offset}px, 0, 0)`;

      // Clean up inline transition after animation completes
      setTimeout(() => {
        track.style.transition = "";
        // Ensure isAnimating is false after snap-back
        isAnimating = false;
      }, snapDuration);

      // Resume autoplay after snap-back
      if (autoplay) {
        startAutoplay();
      }
    }

    // Reset
    startX = 0;
    startY = 0;
  }

  // Handle keyboard navigation
  function handleKeydown(e) {
    if (e.target.closest(".testimonial-slider__wrapper") !== container) return;

    const dirFactor = rtl ? -1 : 1;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        if (activeIndex > 0) activate(activeIndex - dirFactor);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (activeIndex < slides.length - 1) activate(activeIndex + dirFactor);
        break;
      case "Home":
        e.preventDefault();
        activate(0);
        break;
      case "End":
        e.preventDefault();
        activate(slides.length - 1);
        break;
    }
  }

  // Update CSS variables after layout is ready
  function updateCSSVariables() {
    if (isMobile) {
      // Clear desktop variables on mobile
      el.style.removeProperty("--slide-active-width");
      el.style.removeProperty("--slide-active-height");
      el.style.removeProperty("--slide-active-content-width");
      return;
    }

    const activeSlide = slides[activeIndex];
    if (!activeSlide) return;

    // Use setTimeout to ensure we're in a new event loop tick
    // This gives browser time to apply CSS variables and recalculate layout
    setTimeout(() => {
      const activeWidth = activeSlide.offsetWidth;
      const activeHeight = activeSlide.offsetHeight;
      const contentElement = activeSlide.querySelector(".testimonial-slider__slide-content");
      const contentWidth = contentElement ? contentElement.offsetWidth : 0;

      el.style.setProperty("--slide-active-width", `${activeWidth}px`);
      el.style.setProperty("--slide-active-height", `${activeHeight}px`);
      el.style.setProperty("--slide-active-content-width", `${contentWidth}px`);
    }, 100); // 100ms to ensure CSS variables are applied
  }

  // Handle resize
  function handleResize() {
    // Clear previous timeout
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }

    // Debounce: wait for resize to finish
    resizeTimeout = setTimeout(() => {
      const wasMobile = isMobile;
      isMobile = window.innerWidth <= 768;

      // Disable transitions during resize
      disableTransitions();

      // Wait for CSS media queries to apply
      setTimeout(() => {
        // Recalculate everything by re-activating current slide
        // This will read new values from CSS and update offset/height
        const offset = calculateOffset(activeIndex);
        const activeHeight = slides[activeIndex].offsetHeight;

        track.style.transform = `translate3d(${offset}px, 0, 0)`;
        track.style.height = `${activeHeight}px`;
        currentTranslate = offset;
        prevTranslate = offset;

        // Re-enable transitions
        enableTransitions();

        // Update CSS variables
        updateCSSVariables();
      }, 100);
    }, 150); // Wait 150ms after resize stops
  }

  // Initialize slider
  function initSlider() {
    applyDefaults();

    // Don't initialize if only 1 slide
    if (slides.length <= 1) {
      // Only 1 slide, hide controls
      const sliderWrapper = container.closest(".testimonial-slider__wrapper");
      const controlsEl = sliderWrapper?.querySelector(".testimonial-slider__controls");
      if (controlsEl) {
        controlsEl.style.display = "none";
      }

      // Add class to disable cursor and interactions
      container.classList.add("testimonial-slider__container--single");

      // Still set initial height for single slide
      if (slides[0]) {
        setTimeout(() => {
          const initialHeight = slides[0].offsetHeight;
          track.style.height = `${initialHeight}px`;
        }, 100);
      }
      return;
    }

    // Save current scroll position to prevent unwanted scroll
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    // Temporarily disable smooth scrolling on thumbnails container
    if (thumbnailsContainer) {
      thumbnailsContainer.style.scrollBehavior = "auto";
    }

    // Disable ALL transitions temporarily during init
    disableTransitions();

    // Set initial classes: first slide active, rest inactive
    slides[0].classList.add("testimonial-slider__slide--active");
    for (let i = 1; i < slides.length; i++) {
      slides[i].classList.add("testimonial-slider__slide--inactive");
    }

    // Wait for CSS variables to be applied and layout to be calculated
    setTimeout(() => {
      const initialHeight = slides[0].offsetHeight;
      track.style.height = `${initialHeight}px`;

      enableTransitions();

      // Activate with all states (skipScroll=true, skipCSSVars=true)
      activate(0, true, true, true);

      // Update CSS variables after everything is settled
      updateCSSVariables();

      // Note: Autoplay will be started by Intersection Observer when slider enters viewport

      // Restore scroll position
      const newScrollY = window.pageYOffset || document.documentElement.scrollTop;
      if (newScrollY !== scrollY) {
        window.scrollTo(scrollX, scrollY);
      }

      // Restore smooth scrolling on thumbnails
      if (thumbnailsContainer) {
        thumbnailsContainer.style.scrollBehavior = "";
      }
    }, 100);
  }

  // Event listeners
  function addEventListeners() {
    // Drag events
    container.addEventListener("mousedown", dragStart);
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", dragEnd);

    container.addEventListener("touchstart", dragStart, { passive: false });
    container.addEventListener("touchmove", drag, { passive: false });
    container.addEventListener("touchend", dragEnd, { passive: true });

    // Click events for slides
    slides.forEach((slide, i) => {
      slide.addEventListener("click", (e) => {
        // Don't activate if only 1 slide or if it's the same slide
        if (slides.length <= 1 || i === activeIndex) return;

        if (isClick || isMobile) {
          activate(i);
        }
      });
    });

    // Click events for thumbnails
    thumbnails.forEach((thumb, i) => {
      thumb.addEventListener("click", () => {
        activate(i);
      });
    });

    // Click events for navigation buttons
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (activeIndex > 0) activate(activeIndex - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (activeIndex < slides.length - 1) activate(activeIndex + 1);
      });
    }

    // Keyboard events
    document.addEventListener("keydown", handleKeydown);

    // Autoplay: pause on hover/focus, resume on leave/blur (if enabled)
    if (autoplay && pauseOnHover) {
      el.addEventListener("mouseenter", stopAutoplay);
      el.addEventListener("mouseleave", startAutoplay);
      el.addEventListener("focusin", stopAutoplay);
      el.addEventListener("focusout", startAutoplay);
    }

    // Resize events
    const debouncedResize = throttle(handleResize, 150);
    window.addEventListener("resize", debouncedResize);

    // Intersection Observer for autoplay (only if autoplay is enabled)
    if (autoplay) {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            isInViewport = entry.isIntersecting;

            if (entry.isIntersecting) {
              // Slider entered viewport - start autoplay
              startAutoplay();
            } else {
              // Slider left viewport - stop autoplay
              stopAutoplay();
            }
          });
        },
        {
          root: null, // viewport
          rootMargin: "0px",
          threshold: 0.5, // 50% of slider must be visible
        }
      );

      intersectionObserver.observe(el);

      // Check initial visibility (important for Shopify design mode)
      // IntersectionObserver callback is async, so we need to check manually first
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const isInitiallyVisible = rect.top < viewportHeight && rect.bottom > 0;

      if (isInitiallyVisible) {
        isInViewport = true;
        // Use setTimeout to ensure slider is fully initialized
        setTimeout(() => {
          if (isInViewport) {
            startAutoplay();
          }
        }, 100);
      }
    }

    // Store cleanup function
    return () => {
      stopAutoplay(); // Stop autoplay timer
      container.removeEventListener("mousedown", dragStart);
      document.removeEventListener("mousemove", drag);
      document.removeEventListener("mouseup", dragEnd);
      container.removeEventListener("touchstart", dragStart, { passive: false });
      container.removeEventListener("touchmove", drag, { passive: false });
      container.removeEventListener("touchend", dragEnd, { passive: true });
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("resize", debouncedResize);
      if (autoplay && pauseOnHover) {
        el.removeEventListener("mouseenter", stopAutoplay);
        el.removeEventListener("mouseleave", startAutoplay);
        el.removeEventListener("focusin", stopAutoplay);
        el.removeEventListener("focusout", startAutoplay);
      }
      // Disconnect intersection observer
      if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
      }
    };
  }

  // Initialize
  initSlider();
  const cleanup = addEventListeners();

  // Return public API
  return {
    activate,
    getCurrentIndex: () => activeIndex,
    getSlides: () => slides,
    destroy: cleanup,
    updateOptions: (newOptions) => {
      Object.assign({ slideWidth, enableWheel }, newOptions);
      // Recalculate slider with new options
      activate(activeIndex, true);
    },
  };
}

// Export for different module systems
// No default export, CommonJS, or global exports needed.
// This module is only used internally via ES6 imports.
