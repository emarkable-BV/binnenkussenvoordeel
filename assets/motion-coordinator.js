/**
 * Motion Coordinator - Simple & Performant
 * Reduces N IntersectionObservers to 1 shared observer
 * Applies smart limits to prevent performance issues
 */

class MotionCoordinator {
  constructor() {
    this.observer = null;
    this.queue = new Map(); // element -> { onActivate, type }
    this.active = new Set(); // Currently animating elements
    this.completed = new Set(); // Already animated elements

    // Configuration
    this.config = {
      maxActiveAnimations: 25, // Max concurrent animations
      maxZoomAnimations: 12, // Max zoom animations (most expensive)
      maxPerSection: 8, // Max animations per section
      threshold: 0.15, // 15% visible to trigger
      rootMargin: "50px", // Start slightly before viewport
    };
  }

  /**
   * Initialize shared IntersectionObserver
   */
  init() {
    if (this.observer) return;

    this.observer = new IntersectionObserver((entries) => this.handleIntersections(entries), {
      threshold: this.config.threshold,
      rootMargin: this.config.rootMargin,
    });
  }

  /**
   * Register element for coordinated animation
   * @param {Element} element - The element to animate
   * @param {Object} options - { onActivate: callback, type: 'zoom-out' }
   * @returns {Function} Cleanup function
   */
  registerElement(element, options) {
    if (!this.observer) this.init();

    // Skip if already completed
    if (this.completed.has(element)) {
      return () => {}; // noop cleanup
    }

    // Store in queue
    this.queue.set(element, {
      onActivate: options.onActivate,
      type: options.type || element.dataset?.motion || "unknown",
    });

    // Observe with shared observer
    this.observer.observe(element);

    // Return cleanup function (like original inView)
    return () => this.unregister(element);
  }

  /**
   * Unregister element
   * @param {Element} element
   */
  unregister(element) {
    if (this.observer) {
      this.observer.unobserve(element);
    }
    this.queue.delete(element);
    this.active.delete(element);
  }

  /**
   * Clear element from completed set (for replay functionality)
   * @param {Element} element
   */
  clearCompleted(element) {
    this.completed.delete(element);
  }

  /**
   * Handle intersection changes
   * @param {IntersectionObserverEntry[]} entries
   */
  handleIntersections(entries) {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const element = entry.target;
        const data = this.queue.get(element);

        if (data && this.canActivate(element, data.type)) {
          this.activate(element, data.onActivate);
        }
      }
    });
  }

  /**
   * Check if can activate more animations
   * @param {Element} element
   * @param {string} type - Animation type
   * @returns {boolean}
   */
  canActivate(element, type) {
    // Check global limit (applies to ALL animation types)
    if (this.active.size >= this.config.maxActiveAnimations) {
      return false;
    }

    // Check zoom-specific limit (zoom is most expensive)
    if (type === "zoom-out" || type === "zoom-in") {
      const activeZooms = Array.from(this.active).filter((el) => {
        const data = this.queue.get(el);
        return data && (data.type === "zoom-out" || data.type === "zoom-in");
      });

      if (activeZooms.length >= this.config.maxZoomAnimations) {
        return false;
      }
    }

    // Check per-section limit (fair distribution)
    const section = element.closest("section, [class*='section']");
    if (section) {
      const sectionActive = Array.from(this.active).filter((el) => section.contains(el));

      if (sectionActive.length >= this.config.maxPerSection) {
        return false;
      }
    }

    return true;
  }

  /**
   * Activate animation for element
   * @param {Element} element
   * @param {Function} callback
   */
  async activate(element, callback) {
    // Add to active set
    this.active.add(element);

    // Stop observing this element
    this.observer.unobserve(element);

    try {
      // Execute animation callback
      await callback();
    } catch (error) {
      console.error("[MotionCoordinator] Animation error:", error);
    } finally {
      // Cleanup after animation completes
      this.active.delete(element);
      this.queue.delete(element);
      this.completed.add(element);
    }
  }

  /**
   * Get statistics for debugging
   * @returns {Object}
   */
  getStats() {
    const activeByType = {};
    for (const el of this.active) {
      const data = this.queue.get(el);
      const type = data?.type || "unknown";
      activeByType[type] = (activeByType[type] || 0) + 1;
    }

    return {
      queued: this.queue.size,
      active: this.active.size,
      completed: this.completed.size,
      activeByType,
      limits: {
        maxActive: this.config.maxActiveAnimations,
        maxZoom: this.config.maxZoomAnimations,
        maxPerSection: this.config.maxPerSection,
      },
      observer: this.observer ? "initialized" : "not initialized",
    };
  }

  /**
   * Destroy coordinator and cleanup
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.queue.clear();
    this.active.clear();
    this.completed.clear();
  }
}

// Export singleton instance
export const motionCoordinator = new MotionCoordinator();

// Expose to window for debugging
if (typeof window !== "undefined") {
  window.FoxTheme = window.FoxTheme || {};
  window.FoxTheme.motionCoordinator = motionCoordinator;
}
