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

/** Bottom inset for the clearance floor. Read through the CSS probe class:
 *  env() is only readable from computed styles, and Obsidian's own
 *  --safe-area-inset-bottom body variable must NOT be trusted here — on
 *  Android it carries the dynamic keyboard height, not the device inset
 *  (measured 336px while env() is 0). */
export function safeAreaInsetBottom(doc: Document): number {
  const probe = doc.body.createDiv("inscriptum-safe-area-probe");
  const value = Number.parseFloat(getComputedStyle(probe).paddingBottom);
  probe.remove();
  return Number.isFinite(value) ? value : 0;
}

export function createNavbarClearanceTracking(
  target: HTMLElement,
): NavbarClearanceTracking {
  const measure = () => {
    const nav = document.querySelector(".mobile-navbar");
    if (!(nav instanceof HTMLElement)) {
      target.style.removeProperty("--dock-navbar-clearance");
      return;
    }
    const raised = nav.classList.contains("mod-raised");
    // A laid-out box is required: a display:none navbar reports rect.top 0,
    // which would reserve the whole column and collapse the editor.
    if (nav.offsetHeight === 0) {
      target.style.removeProperty("--dock-navbar-clearance");
      return;
    }
    const top = nav.getBoundingClientRect().top;
    // The inset is re-read per measure: it changes with rotation on iOS.
    const value = navbarClearanceValue(
      window.innerHeight,
      raised ? top : null,
      raised,
      safeAreaInsetBottom(document),
    );
    if (value == null) {
      target.style.removeProperty("--dock-navbar-clearance");
    } else {
      target.style.setProperty("--dock-navbar-clearance", `${value}px`);
    }
  };

  measure();

  // The navbar's position follows Obsidian internals with no single
  // observable event surface (system inset, --keyboard-height var changes,
  // auto-hide transform, layout switches); re-measure on the reachable
  // signals and let a cheap poll be the correctness net for the rest.
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
  viewport?.addEventListener("resize", measure);
  viewport?.addEventListener("scroll", measure);
  window.addEventListener("resize", measure);
  const poll = window.setInterval(measure, 300);

  return {
    dispose() {
      window.clearInterval(poll);
      bodyObserver.disconnect();
      targetObserver.disconnect();
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      target.style.removeProperty("--dock-navbar-clearance");
    },
  };
}
