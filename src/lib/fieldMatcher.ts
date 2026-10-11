import type { Profile } from "./supabaseClient";

// export type ProfileKey = keyof Omit<
//   Profile,
//   'id' | 'resume_bucket_path' | 'resume_filename'
// >;

export type ProfileKey = keyof Omit<Profile, "user_id">;

export type NamePart = "first" | "last";

export interface DetectedField {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  labelText: string;
  matchedKey: ProfileKey | null;
  namePart: NamePart | null;
  isLongForm: boolean;
  isFileInput: boolean;
  isFirstFileInputOnPage: boolean;
}

// Order matters: more specific patterns should come before generic ones.
// linkedin_url sits before github_url so "LinkedIn or website" goes to LinkedIn.
// The profile has no separate portfolio field, so generic "website / portfolio
// / your work" questions fall back to the GitHub URL.
const PATTERNS: Array<[ProfileKey, RegExp]> = [
  ["full_name", /\b(full\s*name|your\s*name|legal\s*name)\b|^name$/i],
  ["email", /\be-?mail\b/i],
  ["linkedin_url", /\blinked\s*in\b/i],
  [
    "github_url",
    /\b(git\s*hub|portfolio|personal\s*(web\s*)?site|website|your\s*work)\b/i,
  ],
  [
    "experience_years",
    /\byears?\s+of\s+(professional\s+|relevant\s+|work\s+)?experience\b/i,
  ],
];

// Standard HTML autocomplete tokens are the most reliable signal when a site
// sets them, since they don't depend on label wording or language.
const AUTOCOMPLETE_KEYS: Record<string, ProfileKey> = {
  name: "full_name",
  email: "email",
};

const FIRST_NAME_PATTERN = /\b(first\s*name|given\s*name|fname)\b/i;
const LAST_NAME_PATTERN = /\b(last\s*name|surname|family\s*name|lname)\b/i;

// Signals that a field wants long-form free text, not a direct profile value.
const LONG_FORM_HINTS =
  /\b(why|describe|tell us|cover letter|summary|about you)\b/i;

/** Strips "(optional)", "(required)" and asterisks so they don't break
 * matching or get sent to the answer generator as part of the question. */
function cleanLabel(text: string): string {
  return text
    .replace(/\((optional|required)\)/gi, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Skips fields a person can't see or edit. Besides being pointless to fill,
 * these are often spam honeypots ("Leave this field empty"), and filling one
 * can get the application silently discarded. */
function isHiddenOrHoneypot(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): boolean {
  if (el.disabled) return true;
  // File inputs are routinely hidden behind a styled button or dropzone.
  if ((el as HTMLInputElement).type === "file") return false;
  if ((el as HTMLInputElement).readOnly) return true;
  if (el.closest('[aria-hidden="true"]')) return true;
  if (el.getClientRects().length === 0) return true; // display: none
  if (getComputedStyle(el).visibility === "hidden") return true;
  const rect = el.getBoundingClientRect();
  if (rect.right + window.scrollX <= 0 || rect.bottom + window.scrollY <= 0)
    return true; // positioned off-screen
  return false;
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

function getAutocompleteToken(el: HTMLElement): string {
  // e.g. "section-apply shipping email" -> "email"
  const tokens = (el.getAttribute("autocomplete") || "")
    .toLowerCase()
    .trim()
    .split(/\s+/);
  return tokens[tokens.length - 1] ?? "";
}

function matchPatterns(text: string): ProfileKey | null {
  for (const [key, pattern] of PATTERNS) {
    if (pattern.test(text)) return key;
  }
  return null;
}

function matchField(el: HTMLElement, labelText: string): ProfileKey | null {
  const autocompleteKey = AUTOCOMPLETE_KEYS[getAutocompleteToken(el)];
  if (autocompleteKey) return autocompleteKey;
  if ((el as HTMLInputElement).type === "email") return "email";

  const fromLabel = matchPatterns(labelText);
  if (fromLabel) return fromLabel;

  // Weaker signal: name/id attributes like "linkedin_profile" or "portfolio".
  const attrText = [el.getAttribute("name"), el.id]
    .filter(Boolean)
    .join(" ")
    .replace(/[_-]/g, " ");
  return attrText ? matchPatterns(attrText) : null;
}

function matchNamePart(el: HTMLElement, labelText: string): NamePart | null {
  const token = getAutocompleteToken(el);
  if (token === "given-name") return "first";
  if (token === "family-name") return "last";
  if (FIRST_NAME_PATTERN.test(labelText)) return "first";
  if (LAST_NAME_PATTERN.test(labelText)) return "last";
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
    ].includes(type ?? "") && !isHiddenOrHoneypot(el);
  });

  let fileInputIndex = 0;
  return elements.map((element) => {
    const isFileInput = (element as HTMLInputElement).type === "file";
    const isFirstFileInputOnPage = isFileInput && fileInputIndex === 0;
    if (isFileInput) fileInputIndex += 1;

    const labelText = isFileInput
      ? getFieldLabel(element) || element.outerHTML.slice(0, 120)
      : cleanLabel(getFieldLabel(element));
    const namePart = isFileInput ? null : matchNamePart(element, labelText);

    return {
      element,
      labelText,
      matchedKey:
        isFileInput || namePart ? null : matchField(element, labelText),
      namePart,
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

// Hosted ATS / job board domains. Pages here only need a light signal.
const KNOWN_ATS_HOST =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|ats\.rippling\.com|wellfound\.com|myworkdayjobs\.com|smartrecruiters\.com|bamboohr\.com|jobvite\.com|icims\.com|recruitee\.com|teamtailor\.com|breezy\.hr|applytojob\.com)$/i;

const JOB_PAGE_HINT =
  /\b(apply|application|careers?|jobs?|hiring|positions?|openings?|vacanc(y|ies)|join[\s-]us)\b/i;

/** Decides whether to show the floating button. Deliberately stricter than
 * what autofill itself can handle: login pages, newsletter signups and
 * contact forms also have name/email fields, and showing the button there
 * is noise. The popup's "Fill this page" still works on any page. */
export function looksLikeJobApplication(fields: DetectedField[]): boolean {
  const hasResumeUpload = fields.some(
    (f) =>
      f.isFileInput &&
      resumeUploadScore(
        f.element as HTMLInputElement,
        f.labelText,
        f.isFirstFileInputOnPage,
      ) >= 2,
  );
  if (hasResumeUpload) return true;

  const matchedCount = fields.filter((f) => f.matchedKey || f.namePart).length;
  if (KNOWN_ATS_HOST.test(location.hostname)) {
    return matchedCount >= 2 || fields.some((f) => f.isFileInput);
  }

  const hasEmail = fields.some((f) => f.matchedKey === "email");
  const hasName = fields.some(
    (f) => f.matchedKey === "full_name" || f.namePart,
  );
  if (!hasEmail || !hasName) return false;

  const hasLinkedIn = fields.some((f) => f.matchedKey === "linkedin_url");
  const pageText = `${location.hostname} ${location.pathname} ${document.title}`;
  return hasLinkedIn || JOB_PAGE_HINT.test(pageText);
}

const RESUME_PATTERN = /\b(résumé|resume|cv|curriculum)\b/i;
const OTHER_DOCUMENT_PATTERN =
  /\b(cover\s*letter|transcript|portfolio|writing\s*sample|work\s*sample|certificates?|certifications?|references?|photo|headshot)\b/i;

/** Scores how likely a file input is the resume upload (0 = not a resume).
 * The input's own label and attributes are checked first. Wider context
 * (legend, aria group, ancestor text) is only a fallback, because on forms
 * like Ashby that context spans neighbouring fields: the "Cover Letter"
 * input's ancestors also contain the "Resume" field's text. */
export function resumeUploadScore(
  el: HTMLInputElement,
  labelText: string,
  isFirstFileInputOnPage: boolean,
): number {
  // Underscores/dashes become spaces so "_systemfield_resume" hits \bresume.
  const ownText = [
    labelText,
    el.getAttribute("name"),
    el.getAttribute("id"),
    el.getAttribute("aria-label"),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/[_-]/g, " ");

  if (RESUME_PATTERN.test(ownText)) return 3;
  if (OTHER_DOCUMENT_PATTERN.test(ownText)) return 0;

  const groupText = [getFieldsetLegend(el), getAriaGroupLabelText(el)]
    .filter(Boolean)
    .join(" ");
  if (RESUME_PATTERN.test(groupText)) return 2;

  if (RESUME_PATTERN.test(getContainerText(el))) return 1;

  const accept = el.getAttribute("accept") || "";
  const acceptsDocTypes = /\.(pdf|docx?|rtf)\b/i.test(accept);
  return acceptsDocTypes && isFirstFileInputOnPage ? 1 : 0;
}
