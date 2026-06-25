export const MODAL_FOCUSABLE_SELECTOR = [
  "input:not([type='hidden']):not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "[data-modal-nav='local']:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const SUBMIT_LABEL_REGEX = /(save|create|record|submit|apply|approve|send|confirm|delete|reset|complete|reopen|correct)/i;

export function isSubmitLikeButton(el: HTMLElement) {
  if (!(el instanceof HTMLButtonElement) || el.disabled) return false;
  if (el.dataset.formSubmit === "true") return true;
  if (typeof el.className === "string" && el.className.includes("btn-primary")) return true;
  return SUBMIT_LABEL_REGEX.test((el.textContent || "").trim());
}

const MODAL_ENTER_ADVANCE_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "password",
  "number",
]);

/** Text-like inputs where Enter should move to the next modal field. */
export function isModalEnterAdvanceField(el: HTMLElement) {
  return el instanceof HTMLInputElement && MODAL_ENTER_ADVANCE_INPUT_TYPES.has(el.type);
}

function isVisibleFocusable(el: HTMLElement) {
  return !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.getClientRects().length > 0;
}

export function getModalFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)).filter(isVisibleFocusable);
}

export function findModalFormRoot(from: HTMLElement): HTMLElement | null {
  return from.closest("[data-modal-form-root]");
}

export function moveModalFocus(container: HTMLElement, direction: 1 | -1) {
  const focusables = getModalFocusableElements(container);
  if (!focusables.length) return;
  const current = document.activeElement as HTMLElement | null;
  const currentIndex = current ? focusables.indexOf(current) : -1;
  const start = currentIndex >= 0 ? currentIndex : direction === 1 ? -1 : 0;
  const nextIndex = (start + direction + focusables.length) % focusables.length;
  clearSelectDropdownNav(container);
  container.querySelectorAll(".modal-kbd-focus").forEach((el) => el.classList.remove("modal-kbd-focus"));
  const next = focusables[nextIndex];
  next.classList.add("modal-kbd-focus");
  next.focus();
  activateFieldOnTab(next);
}

/** After picking a value (e.g. customer), move keyboard focus to the next field. */
export function focusNextModalField(from: HTMLElement) {
  const root = findModalFormRoot(from);
  if (!root) return;
  moveModalFocus(root, 1);
}

export function openNativePicker(el: HTMLInputElement | HTMLSelectElement) {
  el.focus();
  if (typeof el.showPicker === "function") {
    try {
      el.showPicker();
      return;
    } catch {
      // Browser blocked or unsupported — fall through.
    }
  }
  if (el instanceof HTMLSelectElement) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
  }
}

export function activateFieldOnTab(el: HTMLElement) {
  if (el.dataset.modalNav === "local") {
    el.dispatchEvent(new CustomEvent("modal-field-activate", { bubbles: true }));
    return;
  }
  if (el instanceof HTMLSelectElement) {
    delete el.dataset.modalDropdownNav;
  }
}

export function focusFirstModalField(container: HTMLElement) {
  const focusables = getModalFocusableElements(container);
  if (!focusables.length) return;
  const first =
    focusables.find((el) => !(el instanceof HTMLButtonElement && !isSubmitLikeButton(el))) ||
    focusables[0];
  clearSelectDropdownNav(container);
  container.querySelectorAll(".modal-kbd-focus").forEach((node) => node.classList.remove("modal-kbd-focus"));
  first.classList.add("modal-kbd-focus");
  first.focus();
  activateFieldOnTab(first);
}

export function handleSelectEnter(select: HTMLSelectElement, event: React.KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  openNativePicker(select);
  select.dataset.modalDropdownNav = "true";
}

export function clearSelectDropdownNav(container: HTMLElement) {
  container.querySelectorAll<HTMLSelectElement>("select[data-modal-dropdown-nav]").forEach((sel) => {
    delete sel.dataset.modalDropdownNav;
  });
}

/** Tab through select options after Enter opened the list; returns true if handled. */
export function handleSelectDropdownTab(
  select: HTMLSelectElement,
  container: HTMLElement,
  shiftKey: boolean
): boolean {
  if (select.dataset.modalDropdownNav !== "true") return false;
  const optionCount = select.options.length;
  if (optionCount === 0) return false;

  const nextIndex = select.selectedIndex + (shiftKey ? -1 : 1);
  if (nextIndex < 0) {
    delete select.dataset.modalDropdownNav;
    moveModalFocus(container, -1);
    return true;
  }
  if (nextIndex >= optionCount) {
    delete select.dataset.modalDropdownNav;
    moveModalFocus(container, 1);
    return true;
  }

  select.selectedIndex = nextIndex;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
