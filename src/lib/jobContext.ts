/**
 * Pulls the company name, role title and job description off the current
 * page so long-form answers ("Why do you want to work at X?") can be specific.
 *
 * Sources, most reliable first:
 *  1. schema.org JobPosting JSON-LD (published for Google Jobs by many ATSes)
 *  2. Hosted job board URLs (jobs.ashbyhq.com/<company>/..., etc.)
 *  3. og: meta tags and document.title
 *  4. The largest text block that reads like a job description
 */

export interface JobContext {
  company?: string;
  title?: string;
  description?: string;
  url: string;
}

// The backend keeps the first 4000 chars of jobContext; leave room for the
// company/role/URL header lines.
const MAX_DESCRIPTION_CHARS = 3500;

// Hosted job boards put the company slug in the URL path.
const ATS_COMPANY_SLUG: Array<[RegExp, (url: URL) => string | null]> = [
  [/^jobs\.ashbyhq\.com$/, (u) => pathSegment(u, 0)],
  [
    /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/,
    // Embedded forms live at /embed/job_app?for=<company>
    (u) =>
      pathSegment(u, 0) === "embed"
        ? u.searchParams.get("for")
        : pathSegment(u, 0),
  ],
  [/^jobs\.(eu\.)?lever\.co$/, (u) => pathSegment(u, 0)],
  [/^apply\.workable\.com$/, (u) => pathSegment(u, 0)],
  [/^ats\.rippling\.com$/, (u) => pathSegment(u, 0)],
  [
    /^(www\.)?wellfound\.com$/,
    (u) => (pathSegment(u, 0) === "company" ? pathSegment(u, 1) : null),
  ],
];

const DESCRIPTION_KEYWORDS =
  /responsibilit|requirement|qualification|about the role|about the job|what you('|’)ll do|what you will do|what we('|’)re looking for|who you are|you will|nice to have|about us/gi;

// Paragraphs that eat the character budget without saying anything about
// the role itself.
const BOILERPLATE =
  /equal (employment )?opportunity|\beeo\b|affirmative action|protected veteran|disabilit|reasonable accommodation|gender identity|sexual orientation|national origin|privacy (policy|notice)|background check|e-?verify/i;

const GENERIC_TITLE_SEGMENT =
  /^(careers?|jobs?|job application|apply|application|job board|home|open positions)$/i;

function pathSegment(url: URL, index: number): string | null {
  return url.pathname.split("/").filter(Boolean)[index] ?? null;
}

function slugToName(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function meta(property: string): string | undefined {
  const value = document
    .querySelector<HTMLMetaElement>(
      `meta[property="${property}"], meta[name="${property}"]`,
    )
    ?.content?.trim();
  return value || undefined;
}

/** Converts an HTML string (JSON-LD descriptions are HTML, sometimes
 * entity-escaped twice) to plain text with paragraph breaks kept. */
function htmlToText(html: string): string {
  let text = html;
  for (let i = 0; i < 2; i += 1) {
    const withBreaks = text.replace(
      /<\s*(br|\/p|\/li|\/h[1-6]|\/div|\/ul|\/ol)\b[^>]*>/gi,
      "\n",
    );
    text =
      new DOMParser().parseFromString(withBreaks, "text/html").body
        .textContent ?? "";
    if (!/<\/?[a-z][^>]*>/i.test(text)) break;
  }
  return text;
}

function findJobPosting(node: unknown, depth = 0): Record<string, any> | null {
  if (!node || typeof node !== "object" || depth > 5) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, any>;
  const type = obj["@type"];
  if (
    type === "JobPosting" ||
    (Array.isArray(type) && type.includes("JobPosting"))
  ) {
    return obj;
  }
  return obj["@graph"] ? findJobPosting(obj["@graph"], depth + 1) : null;
}

function fromJsonLd(): Partial<JobContext> {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  );
  for (const script of Array.from(scripts)) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent || "");
    } catch {
      continue;
    }
    const posting = findJobPosting(data);
    if (!posting) continue;
    const org = posting.hiringOrganization;
    return {
      title: typeof posting.title === "string" ? posting.title : undefined,
      company: typeof org === "string" ? org : org?.name,
      description:
        typeof posting.description === "string"
          ? htmlToText(posting.description)
          : undefined,
    };
  }
  return {};
}

function companyFromUrl(): string | undefined {
  const url = new URL(location.href);
  for (const [host, getSlug] of ATS_COMPANY_SLUG) {
    if (!host.test(url.hostname)) continue;
    const slug = getSlug(url);
    return slug ? slugToName(decodeURIComponent(slug)) : undefined;
  }
  return undefined;
}

/** "careers.byteask.com" -> "Byteask". Only used for company career sites,
 * never for hosted job boards (that would give "Greenhouse"). */
function companyFromDomain(): string | undefined {
  const labels = location.hostname.replace(/^www\./, "").split(".");
  if (labels.length < 2) return undefined;
  const isCountrySecondLevel =
    labels.length >= 3 && /^(co|com|org|net|ac)$/.test(labels[labels.length - 2]);
  const name = labels[labels.length - (isCountrySecondLevel ? 3 : 2)];
  return name && name !== "localhost" ? slugToName(name) : undefined;
}

function isHostedJobBoard(): boolean {
  return ATS_COMPANY_SLUG.some(([host]) => host.test(location.hostname));
}

/** "Founding Engineer - Factory" / "Factory | Careers" -> role guess. */
function titleFromDocument(company?: string): string | undefined {
  const raw = meta("og:title") || document.title;
  if (!raw) return undefined;
  const segments = raw
    .replace(/^(job )?application for\s+/i, "") // Greenhouse page titles
    .split(/\s+[|\-–—@]\s+|\s+at\s+/i)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        !GENERIC_TITLE_SEGMENT.test(s) &&
        s.toLowerCase() !== company?.toLowerCase(),
    );
  return segments[0];
}

/** Picks the element that most looks like a job description: lots of text,
 * description-style headings, and no form controls (which keeps the
 * application form itself, and page-wide wrappers around it, out). */
function descriptionFromPage(): string | undefined {
  let best: HTMLElement | null = null;
  let bestScore = 0;

  const candidates = document.querySelectorAll<HTMLElement>(
    "main, article, section, div",
  );
  for (const el of Array.from(candidates)) {
    // textContent is used for scoring because it doesn't force layout;
    // innerText is only read once, for the winner.
    const length = el.textContent?.length ?? 0;
    if (length < 400 || length > 30000) continue;
    if (el.closest("nav, header, footer, aside, form")) continue;
    if (el.querySelector("input, textarea, select, nav, footer")) continue;

    const hits = el.textContent?.match(DESCRIPTION_KEYWORDS)?.length ?? 0;
    if (hits === 0) continue;
    const score = length * Math.min(hits, 5);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best?.innerText;
}

function cleanDescription(text: string): string {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p && !BOILERPLATE.test(p));

  let out = "";
  for (const p of paragraphs) {
    if (out.length + p.length + 1 > MAX_DESCRIPTION_CHARS) break;
    out += (out ? "\n" : "") + p;
  }
  return out;
}

export function extractJobContext(): JobContext {
  const fromLd = fromJsonLd();

  const company =
    fromLd.company ||
    companyFromUrl() ||
    (isHostedJobBoard() ? undefined : meta("og:site_name") || companyFromDomain());

  const title = fromLd.title || titleFromDocument(company);

  const rawDescription = fromLd.description || descriptionFromPage();
  const description = rawDescription ? cleanDescription(rawDescription) : "";

  return {
    company: company?.trim() || undefined,
    title: title?.trim() || undefined,
    description: description || undefined,
    url: location.href,
  };
}

/** Combines what the top page and an embedded form's iframe each found.
 * The top page wins (it's the company's own site), the iframe fills gaps. */
export function mergeJobContext(
  primary: JobContext | undefined,
  fallback: JobContext,
): JobContext {
  if (!primary) return fallback;
  return {
    company: primary.company || fallback.company,
    title: primary.title || fallback.title,
    description: primary.description || fallback.description,
    url: primary.url,
  };
}

export function formatJobContext(ctx: JobContext): string {
  return [
    ctx.company && `Company: ${ctx.company}`,
    ctx.title && `Role: ${ctx.title}`,
    `URL: ${ctx.url}`,
    ctx.description && `Job description:\n${ctx.description}`,
  ]
    .filter(Boolean)
    .join("\n");
}
