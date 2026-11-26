import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import {
  createNavbarClearanceTracking,
  type NavbarClearanceTracking,
} from "../src/tools/navbarClearance";

const VAR = "--dock-navbar-clearance";

/** Obsidian patches createDiv onto HTMLElement; jsdom has none. */
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto["createDiv"] ??= function (this: HTMLElement, cls?: string) {
    const el = document.createElement("div");
    if (typeof cls === "string") el.className = cls;
    this.appendChild(el);
    return el;
  };
});

function setInnerHeight(value: number): void {
  Object.defineProperty(window, "innerHeight", {
    value,
    configurable: true,
    writable: true,
  });
}

/** jsdom has no layout: offsetHeight and the rect come from stubs. The
 *  safe-area probe reads back "0px" padding — enough for inset = 0. */
function stubComputedPadding(): void {
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(() => ({ paddingBottom: "0px" })),
  );
}

function addNavbar(opts: {
  raised?: boolean;
  height?: number;
  top?: number;
}): HTMLElement {
  const nav = document.createElement("div");
  nav.className =
    "mobile-navbar" + (opts.raised === false ? "" : " mod-raised");
  document.body.appendChild(nav);
  Object.defineProperty(nav, "offsetHeight", {
    value: opts.height ?? 64,
    configurable: true,
  });
  const rect = { top: opts.top ?? 736 } as DOMRect;
  vi.spyOn(nav, "getBoundingClientRect").mockReturnValue(rect);
  return nav;
}

describe("createNavbarClearanceTracking", () => {
  let tracking: NavbarClearanceTracking | null = null;

  afterEach(() => {
    tracking?.dispose();
    tracking = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("removes the variable when no navbar exists", () => {
    setInnerHeight(800);
    const target = document.createElement("div");
    tracking = createNavbarClearanceTracking(target);
    expect(target.style.getPropertyValue(VAR)).toBe("");
    // the inset was never read — no probe was created
    expect(document.querySelector(".inscriptum-safe-area-probe")).toBeNull();
  });

  it("publishes the measured clearance for a raised navbar", () => {
    stubComputedPadding();
    setInnerHeight(800);
    addNavbar({ top: 736 });
    const target = document.createElement("div");
    tracking = createNavbarClearanceTracking(target);
    // 800 - 736 + 8 gap = 72 (inset floor is 0)
    expect(target.style.getPropertyValue(VAR)).toBe("72px");
    // the probe exists once and is reused, not recreated per measure
    expect(
      document.querySelectorAll(".inscriptum-safe-area-probe"),
    ).toHaveLength(1);
  });

  it("clears the variable when the navbar reports no layout box", () => {
    setInnerHeight(800);
    addNavbar({ top: 736, height: 0 });
    const target = document.createElement("div");
    tracking = createNavbarClearanceTracking(target);
    expect(target.style.getPropertyValue(VAR)).toBe("");
    expect(document.querySelector(".inscriptum-safe-area-probe")).toBeNull();
  });

  it("clears the variable when the navbar is not raised", () => {
    setInnerHeight(800);
    addNavbar({ raised: false, top: 736 });
    const target = document.createElement("div");
    tracking = createNavbarClearanceTracking(target);
    expect(target.style.getPropertyValue(VAR)).toBe("");
    // lazy inset: the floor is not read without a raised navbar
    expect(document.querySelector(".inscriptum-safe-area-probe")).toBeNull();
  });

  it("re-measures on the 300ms poll tick and updates the value", () => {
    vi.useFakeTimers();
    stubComputedPadding();
    setInnerHeight(800);
    const nav = addNavbar({ top: 736 });
    const target = document.createElement("div");
    tracking = createNavbarClearanceTracking(target);
    expect(target.style.getPropertyValue(VAR)).toBe("72px");

    // the navbar drifted (Android system bar shifted it up)
    vi.mocked(nav.getBoundingClientRect).mockReturnValue({
      top: 660,
    } as DOMRect);
    vi.advanceTimersByTime(300);
    expect(target.style.getPropertyValue(VAR)).toBe("148px");
  });

  it("repeated measures with unchanged geometry do not rewrite the variable", () => {
    vi.useFakeTimers();
    stubComputedPadding();
    setInnerHeight(800);
    const nav = addNavbar({ top: 736 });
    const target = document.createElement("div");
    tracking = createNavbarClearanceTracking(target);
    expect(target.style.getPropertyValue(VAR)).toBe("72px");

    const setProperty = vi.spyOn(target.style, "setProperty");
    const removeProperty = vi.spyOn(target.style, "removeProperty");

    // unchanged geometry: poll ticks must not churn the style (the dedup)
    vi.advanceTimersByTime(300);
    vi.advanceTimersByTime(300);
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();

    // the navbar drifted: the next tick publishes the new value once
    vi.mocked(nav.getBoundingClientRect).mockReturnValue({
      top: 660,
    } as DOMRect);
    vi.advanceTimersByTime(300);
    expect(setProperty).toHaveBeenCalledTimes(1);
    expect(setProperty).toHaveBeenCalledWith(VAR, "148px");
  });

  it("caches the safe-area inset until a viewport geometry change", () => {
    vi.useFakeTimers();
    const computed = vi.fn(() => ({ paddingBottom: "0px" }));
    vi.stubGlobal("getComputedStyle", computed);
    setInnerHeight(800);
    addNavbar({ top: 736 });
    const target = document.createElement("div");
    tracking = createNavbarClearanceTracking(target);
    expect(target.style.getPropertyValue(VAR)).toBe("72px");
    const readsAfterMount = computed.mock.calls.length;

    // unchanged viewport geometry: poll ticks reuse the cached inset —
    // no forced style resolution per measure
    vi.advanceTimersByTime(900);
    expect(computed.mock.calls.length).toBe(readsAfterMount);

    // rotation/resize invalidate the cache: the next measure re-reads it
    window.dispatchEvent(new Event("resize"));
    expect(computed.mock.calls.length).toBeGreaterThan(readsAfterMount);
    expect(target.style.getPropertyValue(VAR)).toBe("72px");
  });

  it("dispose stops the poll, clears the variable and removes the probe", () => {
    vi.useFakeTimers();
    stubComputedPadding();
    setInnerHeight(800);
    const nav = addNavbar({ top: 736 });
    const target = document.createElement("div");
    tracking = createNavbarClearanceTracking(target);
    expect(target.style.getPropertyValue(VAR)).toBe("72px");

    vi.mocked(nav.getBoundingClientRect).mockReturnValue({
      top: 600,
    } as DOMRect);
    tracking.dispose();
    expect(target.style.getPropertyValue(VAR)).toBe("");
    expect(document.querySelector(".inscriptum-safe-area-probe")).toBeNull();

    // the interval is gone: further ticks change nothing
    vi.advanceTimersByTime(900);
    expect(target.style.getPropertyValue(VAR)).toBe("");
  });
});
