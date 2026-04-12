export type ActionMenuDirection = "up" | "down";

const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);

function getNearestScrollableAncestor(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const styles = window.getComputedStyle(current);
    if (SCROLLABLE_OVERFLOW_VALUES.has(styles.overflowY) || SCROLLABLE_OVERFLOW_VALUES.has(styles.overflow)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function getActionMenuDirection(
  trigger: HTMLElement,
  menuHeight = 220
): ActionMenuDirection {
  const triggerRect = trigger.getBoundingClientRect();
  const scrollContainer = getNearestScrollableAncestor(trigger);

  const spaceAbove = scrollContainer
    ? triggerRect.top - scrollContainer.getBoundingClientRect().top
    : triggerRect.top;
  const spaceBelow = scrollContainer
    ? scrollContainer.getBoundingClientRect().bottom - triggerRect.bottom
    : window.innerHeight - triggerRect.bottom;

  if (spaceBelow >= menuHeight) return "down";
  if (spaceAbove >= menuHeight) return "up";
  return spaceAbove > spaceBelow ? "up" : "down";
}
