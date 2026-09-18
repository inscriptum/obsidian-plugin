export function isMobileKeyboardOpen(): boolean {
  if (!document.body.classList.contains("is-mobile")) {
    return false;
  }

  const htmlStyles = window.getComputedStyle(document.documentElement);
  const keyboardHeightProp = htmlStyles
    .getPropertyValue("--keyboard-height")
    .trim();

  const keyboardHeight = parseFloat(keyboardHeightProp);

  return !isNaN(keyboardHeight) && keyboardHeight > 0;
}
