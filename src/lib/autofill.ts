import type { Profile } from "./supabaseClient";
import {
  detectFields,
  resumeUploadScore,
  type DetectedField,
} from "./fieldMatcher";
/**
 * Plain `element.value = x` does not trigger React/Vue/Angular's change
 * detection because those frameworks override the native value setter.
 * Calling the *native* setter directly, then dispatching input/change,
 * makes the framework's own listeners fire correctly.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillSelect(el: HTMLSelectElement, value: string) {
  const options = Array.from(el.options);
  const match = options.find(
    (opt) =>
      opt.value.toLowerCase() === value.toLowerCase() ||
      opt.text.toLowerCase() === value.toLowerCase(),
  );
  if (match) {
    el.value = match.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export interface AutofillResult {
  filledCount: number;
  resumeFieldFound: HTMLInputElement | null;
  unmatchedLongForm: DetectedField[];
}

export function fillKnownFields(profile: Profile): AutofillResult {
  const fields = detectFields();
  let filledCount = 0;
  let resumeFieldFound: HTMLInputElement | null = null;
  let bestResumeScore = 0;
  const unmatchedLongForm: DetectedField[] = [];

  const [firstName, ...rest] = (profile.full_name ?? "").trim().split(/\s+/);
  const lastName = rest.join(" ");

  for (const field of fields) {
    if (field.isFileInput) {
      // Keep the highest-scoring input; on a tie the earlier one wins.
      const score = resumeUploadScore(
        field.element as HTMLInputElement,
        field.labelText,
        field.isFirstFileInputOnPage,
      );
      if (score > bestResumeScore) {
        bestResumeScore = score;
        resumeFieldFound = field.element as HTMLInputElement;
      }
      continue;
    }

    if (field.isLongForm) {
      unmatchedLongForm.push(field);
      continue;
    }

    if (field.namePart === "first" && firstName) {
      setNativeValue(field.element as HTMLInputElement, firstName);
      filledCount += 1;
      continue;
    }
    if (field.namePart === "last" && lastName) {
      setNativeValue(field.element as HTMLInputElement, lastName);
      filledCount += 1;
      continue;
    }

    if (!field.matchedKey) continue;
    const value = profile[field.matchedKey];
    if (!value) continue;

    if (field.element.tagName === "SELECT") {
      fillSelect(field.element as HTMLSelectElement, value.toString());
    } else {
      setNativeValue(
        field.element as HTMLInputElement | HTMLTextAreaElement,
        value.toString(),
      );
    }
    filledCount += 1;
  }

  return { filledCount, resumeFieldFound, unmatchedLongForm };
}

export function insertAnswer(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  setNativeValue(el, value);
}

export function attachResumeFile(
  input: HTMLInputElement,
  bytes: ArrayBuffer,
  filename: string,
  mimeType: string,
) {
  const file = new File([bytes], filename, { type: mimeType });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

  input.files = dataTransfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  simulateDropOnDropzone(input, dataTransfer);
}

function simulateDropOnDropzone(
  input: HTMLInputElement,
  dataTransfer: DataTransfer,
) {
  // File inputs used by dropzone widgets are often visually hidden and
  // wrapped by the actual drop target. Walk up a few ancestors to find it.
  let target: HTMLElement | null = input.parentElement;
  let depth = 0;
  while (target && depth < 4) {
    const looksLikeDropzone =
      /drop|dnd|upload/i.test(target.className || "") ||
      (target.hasAttribute("data-testid") &&
        /drop|upload/i.test(target.getAttribute("data-testid") || ""));
    if (looksLikeDropzone) break;
    target = target.parentElement;
    depth += 1;
  }
  target = target ?? input.parentElement ?? input;

  const eventInit = {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  } as DragEventInit;
  target.dispatchEvent(new DragEvent("dragenter", eventInit));
  target.dispatchEvent(new DragEvent("dragover", eventInit));
  target.dispatchEvent(new DragEvent("drop", eventInit));
}
