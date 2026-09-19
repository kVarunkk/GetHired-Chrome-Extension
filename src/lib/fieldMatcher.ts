import type { Profile } from "./supabaseClient";

// export type ProfileKey = keyof Omit<
//   Profile,
//   'id' | 'resume_bucket_path' | 'resume_filename'
// >;

export type ProfileKey = keyof Omit<Profile, "user_id">;

export interface DetectedField {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  labelText: string;
  matchedKey: ProfileKey | null;
  isLongForm: boolean;
  isFileInput: boolean;
  isFirstFileInputOnPage: boolean;
}

// Order matters: more specific patterns should come before generic ones.
const PATTERNS: Array<[ProfileKey, RegExp]> = [
  ["full_name", /\b(full\s*name|your\s*name)\b|^name$/i],
  ["email", /\be-?mail\b/i],
  ["linkedin_url", /\blinked\s*in\b/i],
  ["github_url", /\bgit\s*hub\b/i],
];

export const FIRST_NAME_PATTERN = /\b(first\s*name|given\s*name|fname)\b/i;
export const LAST_NAME_PATTERN =
  /\b(last\s*name|surname|family\s*name|lname)\b/i;

// Signals that a field wants long-form free text, not a direct profile value.
const LONG_FORM_HINTS =
  /\b(why|describe|tell us|cover letter|summary|about you)\b/i;

export interface DetectedField {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  labelText: string;
  matchedKey: ProfileKey | null;
  isLongForm: boolean;
  isFileInput: boolean;
}

const LABEL_LIKE_SELECTOR =
  'label, legend, [class*="label" i], [class*="question" i]';

function getAriaGroupLabelText(el: HTMLElement, depth = 10): string {
  // Climbs further than getContainerText, and resolves via the actual
  // aria-labelledby reference rather than guessing from nearby text.
  // Workday's file upload widgets put the real "Resume/CV" heading many
  // levels above the input, referenced this way rather than nested nearby.
  let node: HTMLElement | null = el;
  for (let i = 0; i < depth && node; i += 1) {
    const labelledBy = node.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.innerText?.trim()) return labelEl.innerText.trim();
    }
    node = node.parentElement;
  }
  return "";
}

/** Finds the smallest ancestor that wraps only this one field (no sibling
 * inputs), by walking up until an ancestor would contain more than one
 * form control. Stops there since going further would sweep in text from
 * neighboring fields. */
function findFieldWrapper(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  let last: HTMLElement | null = null;
  let depth = 0;
  while (node && depth < 6) {
    const controlCount = node.querySelectorAll(
      "input, textarea, select",
    ).length;
    if (controlCount > 1) break;
    last = node;
    node = node.parentElement;
    depth += 1;
  }
  return last;
}

/** Clones the wrapper, strips out the actual form control(s), and returns
 * whatever text is left. Works regardless of whether the ATS used a real
 * <label>, a <div>, a <span>, or plain text for the question. This is what
 * catches Greenhouse's "cards[uuid][field0]" custom questions, which have
 * no label markup associated with the input at all. */
function extractWrapperLabelText(wrapper: HTMLElement): string {
  const clone = wrapper.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("input, textarea, select, script, style")
    .forEach((n) => n.remove());
  return clone.innerText?.trim().replace(/\s+/g, " ").slice(0, 200) ?? "";
}

function getFieldLabel(el: HTMLElement): string {
  const input = el as HTMLInputElement;

  if (
    input.labels &&
    input.labels.length > 0 &&
    input.labels[0].innerText?.trim()
  ) {
    return input.labels[0].innerText.trim();
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  if (ariaLabelledBy) {
    const labelEl = document.getElementById(ariaLabelledBy);
    if (labelEl?.innerText?.trim()) return labelEl.innerText.trim();
  }

  // Some ATS platforms use an id="field-N" / id="field-N-label" convention
  // but don't always wire up aria-labelledby on every field. Try the
  // paired id directly before falling back to anything looser.
  if (el.id) {
    const pairedLabel = document.getElementById(`${el.id}-label`);
    if (pairedLabel?.innerText?.trim()) return pairedLabel.innerText.trim();
  }

  const placeholder = el.getAttribute("placeholder");
  if (placeholder) return placeholder;

  // Last resort: smallest wrapper containing ONLY this field (no sibling
  // inputs), minus the control itself. Deliberately does not search wider
  // ancestors for "label-like" elements, that risks grabbing an unrelated
  // field's label text once the ancestor is shared across multiple fields.
  const wrapper = findFieldWrapper(el);
  const wrapperText = wrapper ? extractWrapperLabelText(wrapper) : "";
  if (wrapperText) return wrapperText;

  const name = el.getAttribute("name") || el.getAttribute("id");
  if (name) return name.replace(/[_-]/g, " ");

  return "";
}

function matchField(labelText: string): ProfileKey | null {
  for (const [key, pattern] of PATTERNS) {
    if (pattern.test(labelText)) return key;
  }
  return null;
}

export function detectFields(): DetectedField[] {
  const elements = Array.from(
    document.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input, textarea, select"),
  ).filter((el) => {
    const type = (el as HTMLInputElement).type;
    return ![
      "hidden",
      "submit",
      "button",
      "checkbox",
      "radio",
      "image",
    ].includes(type ?? "");
  });

  let fileInputIndex = 0;
  return elements.map((element) => {
    const isFileInput = (element as HTMLInputElement).type === "file";
    const isFirstFileInputOnPage = isFileInput && fileInputIndex === 0;
    if (isFileInput) fileInputIndex += 1;

    const labelText = isFileInput
      ? getFieldLabel(element) || element.outerHTML.slice(0, 120)
      : getFieldLabel(element);

    console.log("element outerhtml", element.outerHTML);
    console.log("label text", getFieldLabel(element));

    return {
      element,
      labelText,
      matchedKey: isFileInput ? null : matchField(labelText),
      isLongForm:
        !isFileInput &&
        (element.tagName === "TEXTAREA" || LONG_FORM_HINTS.test(labelText)),
      isFileInput,
      isFirstFileInputOnPage,
    };
  });
}

function getContainerText(el: HTMLElement, depth = 6): string {
  let node: HTMLElement | null = el;
  for (let i = 0; i < depth && node; i += 1) {
    node = node.parentElement;
  }
  return node?.innerText?.slice(0, 300) ?? "";
}

function getFieldsetLegend(el: HTMLElement): string {
  return el.closest("fieldset")?.querySelector("legend")?.innerText ?? "";
}

export function isResumeUpload(
  el: HTMLInputElement,
  isFirstFileInputOnPage: boolean,
): boolean {
  const attrBundle = [
    el.getAttribute("name"),
    el.getAttribute("id"),
    el.getAttribute("aria-label"),
    getFieldsetLegend(el),
    getAriaGroupLabelText(el),
    getContainerText(el),
  ]
    .filter(Boolean)
    .join(" ");

  if (/\b(résumé|resume|cv|curriculum)\b/i.test(attrBundle)) return true;

  const accept = el.getAttribute("accept") || "";
  const acceptsDocTypes = /\.(pdf|docx?|rtf)\b/i.test(accept);
  return acceptsDocTypes && isFirstFileInputOnPage;
}
