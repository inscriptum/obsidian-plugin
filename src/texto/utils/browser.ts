/**
 * Forked from https://github.com/ProseMirror/prosemirror-view/blob/master/src/browser.ts
 */
const nav = typeof navigator != "undefined" ? navigator : null;
const doc = typeof document != "undefined" ? document : null;
const agent = (nav && nav.userAgent) || "";

const ie_edge = /Edge\/(\d+)/.exec(agent);
const ie_upto10 = /MSIE \d/.exec(agent);
const ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(agent);

export const ie = !!(ie_upto10 || ie_11up || ie_edge);

let _ie_version = 0;

if (ie_upto10 && "documentMode" in document) {
  _ie_version = Number(document.documentMode);
} else {
  _ie_version = ie_11up ? +ie_11up[1] : ie_edge ? +ie_edge[1] : 0;
}
export const ie_version = _ie_version;

export const gecko = !ie && /gecko\/(\d+)/i.test(agent);
export const gecko_version =
  gecko && +(/Firefox\/(\d+)/.exec(agent) || [0, 0])[1];

const _chrome = !ie && /Chrome\/(\d+)/.exec(agent);
export const chrome = !!_chrome;
export const chrome_version = _chrome ? +_chrome[1] : 0;
export const safari =
  !ie &&
  /AppleWebKit\//.test(agent) &&
  !/Chrome|CriOS|Chromium|Edg|OPR|FxiOS/.test(agent);
// Is true for both iOS and iPadOS for convenience
export const ios =
  safari && (/Mobile\/\w+/.test(agent) || (!!nav && nav.maxTouchPoints > 2));
export const mac = ios || /Mac/.test(agent);
export const windows = /Windows|Win32|Win64/.test(agent);
export const android = /Android \d/.test(agent);
export const webkit =
  !!doc && "webkitFontSmoothing" in doc.documentElement.style;
export const webkit_version = webkit
  ? +(/\bAppleWebKit\/(\d+)/.exec(agent) || [0, 0])[1]
  : 0;
