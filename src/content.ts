import {
  fillKnownFields,
  attachResumeFile,
  insertAnswer,
} from "./lib/autofill";
import { base64ToArrayBuffer } from "./lib/binary";
import { detectFields, looksLikeJobApplication } from "./lib/fieldMatcher";
import {
  extractJobContext,
  formatJobContext,
  mergeJobContext,
  type JobContext,
} from "./lib/jobContext";
import type {
  ExtensionMessage,
  LongFormAnswersResponse,
  ProfileResponse,
  ResumeResponse,
} from "./lib/messages";

const BUTTON_ID = "gethired-autofill-trigger";
const isTopFrame = window === window.top;

function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

/** Runs `callback` once DOM changes settle, instead of on every mutation.
 * React-heavy pages fire thousands of mutations, and field detection reads
 * computed styles for every input. */
function observeDomChanges(callback: () => void) {
  let timer: number | undefined;
  new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(callback, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

/** `parentContext` is what the top page found when the form is embedded in
 * an iframe; the job description usually lives on that outer page. */
async function runAutofill(parentContext?: JobContext): Promise<string> {
  const { profile, error }: ProfileResponse = await sendMessage({
    type: "GET_PROFILE",
  });

  if (error || !profile) {
    return error === "Not logged in"
      ? "Log in to GetHired from the extension popup first."
      : `Couldn't load your profile: ${error}`;
  }

  const { filledCount, resumeFieldFound, unmatchedLongForm } =
    fillKnownFields(profile);

  let longFormFilled = 0;
  let longFormError = "";
  if (unmatchedLongForm.length > 0) {
    const questions = unmatchedLongForm.map((f) => f.labelText.trim());
    try {
      const jobContext = formatJobContext(
        mergeJobContext(parentContext, extractJobContext()),
      );
      const res: LongFormAnswersResponse = await sendMessage({
        type: "GET_LONG_FORM_ANSWERS",
        questions,
        jobContext,
      });
      if (res.answers && !res.error) {
        // The API may echo questions back with different whitespace, casing
        // or punctuation, so fall back to a normalized lookup.
        const normalize = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const normalizedAnswers = new Map(
          Object.entries(res.answers).map(([q, a]) => [normalize(q), a]),
        );
        for (const field of unmatchedLongForm) {
          const key = field.labelText.trim();
          const answer = res.answers[key] ?? normalizedAnswers.get(normalize(key));
          if (answer) {
            insertAnswer(
              field.element as HTMLInputElement | HTMLTextAreaElement,
              answer,
            );
            longFormFilled += 1;
          } else {
            console.warn("[GetHired] no answer returned for question", key);
          }
        }
      } else if (res.error) {
        console.warn("[GetHired] long-form answers failed", res.error);
        longFormError = res.error;
      }
    } catch (err) {
      // If batch fails, leave long-form fields blank (as instructed)
      console.warn("[GetHired] long-form answers request errored", err);
      longFormError = err instanceof Error ? err.message : String(err);
    }
  }
  const longFormMsg = longFormError
    ? ` (AI answers skipped: ${longFormError})`
    : "";

  let resumeMsg = "";
  if (resumeFieldFound) {
    const resume: ResumeResponse = await sendMessage({ type: "GET_RESUME" });
    if (resume.base64 && resume.filename && resume.mimeType) {
      const bytes = base64ToArrayBuffer(resume.base64);
      attachResumeFile(
        resumeFieldFound,
        bytes,
        resume.filename,
        resume.mimeType,
      );
      resumeMsg = " and attached your resume";
    } else if (resume.error) {
      resumeMsg = ` (resume not attached: ${resume.error})`;
    }
  }

  return `Filled ${filledCount} field${filledCount === 1 ? "" : "s"}${longFormFilled > 0 ? ` and ${longFormFilled} long-form answer${longFormFilled === 1 ? "" : "s"}` : ""}${resumeMsg}${longFormMsg}.`;
}

const STYLE_ID = "gethired-autofill-styles";

function ensureButtonStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      background: #000000;
      color: #ffffff;
      border: none;
    }
    @media (prefers-color-scheme: dark) {
      #${BUTTON_ID} {
        background: #ffffff;
        color: #000000;
        border: 1px solid #e5e7eb;
      }
    }
  `;
  document.head.appendChild(style);
}

function injectButton(onClick: () => Promise<string>) {
  if (document.getElementById(BUTTON_ID)) return;

  ensureButtonStyles();

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  // button.textContent = "Autofill with GetHired";
  Object.assign(button.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "system-ui, sans-serif",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
  } as CSSStyleDeclaration);

  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("public/icons/icon32.png");
  Object.assign(icon.style, {
    width: "16px",
    height: "16px",
    borderRadius: "4px",
  } as CSSStyleDeclaration);

  const label = document.createElement("span");
  label.textContent = "Autofill with GetHired";

  button.appendChild(icon);
  button.appendChild(label);

  button.addEventListener("click", async () => {
    button.disabled = true;
    const original = button.textContent;
    label.textContent = "Filling...";
    try {
      label.textContent = await onClick();
    } catch (err) {
      label.textContent = "Something went wrong. Try again.";
      console.error("[GetHired] autofill failed", err);
    } finally {
      button.disabled = false;
      setTimeout(() => {
        label.textContent = original;
      }, 3000);
    }
  });

  document.body.appendChild(button);
}

if (isTopFrame) {
  // If the form lives directly in the top page (no iframe), handle it locally.
  let targetFrameWindow: Window | null = null;
  let hasStrongLocalFields = false;

  async function handleClick(): Promise<string> {
    if (targetFrameWindow && !hasStrongLocalFields) {
      // Form lives in a subframe. Ask it to run, and wait for its result.
      return new Promise((resolve) => {
        function onResult(e: MessageEvent) {
          if (
            e.source !== targetFrameWindow ||
            e.data?.type !== "GETHIRED_AUTOFILL_RESULT"
          )
            return;
          window.removeEventListener("message", onResult);
          resolve(e.data.result as string);
        }
        window.addEventListener("message", onResult);
        targetFrameWindow!.postMessage(
          {
            type: "GETHIRED_TRIGGER_AUTOFILL",
            jobContext: extractJobContext(),
          },
          "*",
        );
      });
    }
    return runAutofill();
  }

  let targetFrameLooksLikeApplication = false;

  const checkLocalFields = () => {
    // A real form has an email or name field, not just any matched key
    // (e.g. a "location" field alone isn't a strong enough signal).
    const fields = detectFields();
    hasStrongLocalFields = fields.some(
      (f) => f.matchedKey === "email" || f.matchedKey === "full_name",
    );
    // The floating button only appears on pages that look like a job
    // application; elsewhere the popup's "Fill this page" still works.
    if (looksLikeJobApplication(fields)) injectButton(handleClick);
  };
  checkLocalFields();
  observeDomChanges(checkLocalFields);

  // A subframe (e.g. an embedded Ashby/Greenhouse form) announces itself
  // once its fields render. Only act on this if the top frame doesn't
  // already have a real local form, otherwise an unrelated iframe (chat
  // widget, etc.) could hijack a working local form's button. A frame that
  // looks like an application also wins over one that merely has fields.
  window.addEventListener("message", (e) => {
    if (
      e.data?.type !== "GETHIRED_FORM_DETECTED" ||
      !e.source ||
      hasStrongLocalFields
    )
      return;
    const looksLikeApplication = e.data.looksLikeApplication === true;
    if (looksLikeApplication || !targetFrameLooksLikeApplication) {
      targetFrameWindow = e.source as Window;
      targetFrameLooksLikeApplication = looksLikeApplication;
    }
    if (looksLikeApplication) injectButton(handleClick);
  });

  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      if (message.type === "TRIGGER_AUTOFILL") {
        handleClick().then((result) => sendResponse({ result }));
        return true;
      }
      return false;
    },
  );
} else {
  // We're inside an iframe. Don't show our own button, announce readiness
  // to the top frame instead and run the actual fill when asked.
  const announce = () => {
    const fields = detectFields();
    if (fields.some((f) => f.matchedKey || f.isFileInput || f.isLongForm)) {
      window.top?.postMessage(
        {
          type: "GETHIRED_FORM_DETECTED",
          looksLikeApplication: looksLikeJobApplication(fields),
        },
        "*",
      );
    }
  };
  announce();
  observeDomChanges(announce);

  window.addEventListener("message", async (e) => {
    if (e.data?.type === "GETHIRED_TRIGGER_AUTOFILL") {
      const ctx = e.data.jobContext;
      const parentContext: JobContext | undefined =
        ctx && typeof ctx === "object" && typeof ctx.url === "string"
          ? {
              url: ctx.url,
              company: typeof ctx.company === "string" ? ctx.company : undefined,
              title: typeof ctx.title === "string" ? ctx.title : undefined,
              description:
                typeof ctx.description === "string"
                  ? ctx.description
                  : undefined,
            }
          : undefined;
      const result = await runAutofill(parentContext);
      window.top?.postMessage(
        { type: "GETHIRED_AUTOFILL_RESULT", result },
        "*",
      );
    }
  });
}
