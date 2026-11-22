/**
 * Bottom-navbar clearance tracking for phone views.
 *
 * Obsidian's floating phone navbar (.mobile-navbar, fixed position)
 * overlays the view while it is raised, and its distance from the window
 * bottom varies: the Android system navigation bar shifts it up, the iOS
 * home-indicator inset is already part of its floating offset. One fixed
 * constant cannot cover both — it under-reserves on Android (the navbar
 * overlaps our toolbar) and over-reserves on iOS (a dead strip between the
 * panels). The real value is measured from the raised navbar's box and
 * published as --dock-navbar-clearance for mobile.css.
 */

export interface NavbarClearanceTracking {
  /** Stop observing and clear the element's variable. */
  dispose(): void;
}

/** Pure measurement → clearance mapping (unit-testable): the clearance is
 *  the window distance below the navbar's top plus a small visual gap, but
 *  never less than the safe-area inset (a raised-but-hidden navbar needs
 *  only the inset itself). Returns null when the navbar is absent or not
 *  raised — the caller must then clear the variable so CSS falls back. */
export function navbarClearanceValue(
  innerHeight: number,
  navbarTop: number | null,
  raised: boolean,
  insetBottom: number,
  gap = 8,
): number | null {
  if (navbarTop == null || !raised) return null;
  return Math.max(insetBottom, innerHeight - navbarTop + gap);
}

/** Bottom inset for the clearance floor, read from the caller-provided
 *  probe element: env() is only readable from computed styles, and
 *  Obsidian's own --safe-area-inset-bottom body variable must NOT be
 *  trusted here — on Android it carries the dynamic keyboard height, not
 *  the device inset (measured 336px while env() is 0). The probe element
 *  is owned by the tracking instance (created once, removed on dispose),
 *  not per read. */
export function safeAreaInsetBottom(probe: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(probe).paddingBottom);
  return Number.isFinite(value) ? value : 0;
}

const CLEARANCE_VAR = "--dock-navbar-clearance";

export function createNavbarClearanceTracking(
  target: HTMLElement,
): NavbarClearanceTracking {
  let probe: HTMLElement | null = null;
  // Cached until the next viewport-geometry invalidation: env(
  // safe-area-inset-bottom) only changes with rotation/viewport resizes —
  // remeasureWithInset below is the invalidation point — and the probe read
  // costs a forced style resolution per measure otherwise (the 300ms poll
  // and every body-class mutation all measure).
  let insetBottom: number | null = null;

  const readInset = (): number => {
    if (probe == null) {
      probe = document.body.createDiv("inscriptum-safe-area-probe");
    }
    if (insetBottom == null) {
      insetBottom = safeAreaInsetBottom(probe);
    }
    return insetBottom;
  };

  // Only write when the value actually changes: the measure runs on every
  // body-class mutation and a 300ms poll, and redundant setProperty calls
  // on unrelated mutations churn style recalcs for nothing.
  const applyClearance = (value: number | null) => {
    const next = value == null ? "" : `${value}px`;
    if (target.style.getPropertyValue(CLEARANCE_VAR) === next) return;
    if (next === "") {
      target.style.removeProperty(CLEARANCE_VAR);
    } else {
      target.style.setProperty(CLEARANCE_VAR, next);
    }
  };

  const measure = () => {
    const nav = document.querySelector(".mobile-navbar");
    if (!(nav instanceof HTMLElement)) {
      applyClearance(null);
      return;
    }
    const raised = nav.classList.contains("mod-raised");
    // A laid-out box is required: a display:none navbar reports rect.top 0,
    // which would reserve the whole column and collapse the editor.
    if (nav.offsetHeight === 0) {
      applyClearance(null);
      return;
    }
    if (!raised) {
      applyClearance(null);
      return;
    }
    const top = nav.getBoundingClientRect().top;
    const value = navbarClearanceValue(
      window.innerHeight,
      top,
      true,
      readInset(),
    );
    applyClearance(value);
  };

  measure();

  // The navbar's position follows Obsidian internals with no single
  // observable event surface (system inset, --keyboard-height var changes,
  // auto-hide transform, layout switches); re-measure on the reachable
  // signals and let a cheap poll be the correctness net for the rest.
  const remeasureWithInset = () => {
    // env() changes with rotation and viewport resizes — drop the cache.
    insetBottom = null;
    measure();
  };
  const bodyObserver = new MutationObserver(measure);
  bodyObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  const targetObserver = new MutationObserver(measure);
  targetObserver.observe(target, {
    attributes: true,
    attributeFilter: ["class"],
  });
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", remeasureWithInset);
  viewport?.addEventListener("scroll", measure);
  window.addEventListener("resize", remeasureWithInset);
  window.addEventListener("orientationchange", remeasureWithInset);
  const poll = window.setInterval(measure, 300);

  return {
    dispose() {
      window.clearInterval(poll);
      bodyObserver.disconnect();
      targetObserver.disconnect();
      viewport?.removeEventListener("resize", remeasureWithInset);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", remeasureWithInset);
      window.removeEventListener("orientationchange", remeasureWithInset);
      probe?.remove();
      probe = null;
      target.style.removeProperty(CLEARANCE_VAR);
    },
  };
}
