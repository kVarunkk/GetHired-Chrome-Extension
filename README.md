# GetHired Autofill (v1)

Chrome extension that logs in with the same Supabase project as the Next.js
app, then autofills job application forms anywhere on the web using the
user's saved profile and resume.

## Scope (v1)

- Email/password login (Google OAuth deferred to v1.1, see notes below)
- Autofill: name, email, phone, LinkedIn, portfolio, city, country
- Resume file attachment from Supabase Storage
- Works on any site via `<all_urls>` + label/placeholder-based fuzzy field matching
- Manual trigger only (floating button + popup button), no auto-run on page load

## Setup

1. `cp .env.example .env` and fill in your Supabase project URL + anon key
   (same values your Next.js app uses).
2. Add real `icon16.png`, `icon48.png`, `icon128.png` to `public/icons/`.
3. `npm install`
4. `npm run dev` for a hot-reloading dev build, or `npm run build` for
   production output in `dist/`.
5. Go to `chrome://extensions`, enable Developer mode, click "Load unpacked",
   select the `dist/` folder (or the dev build output folder).

## Before shipping: RLS checklist

This extension uses the anon key + the user's JWT after login, exactly like
the web app. Security depends entirely on RLS being correct:

- [ ] `profiles` table has RLS enabled
- [ ] No lingering `select` policy scoped to the `anon` role on `profiles`
- [ ] A policy scoped to `authenticated` exists: `using (auth.uid() = id)`
- [ ] The resume storage bucket is private, with policies scoped to the
      owning user (not public)
- [ ] Storage bucket CORS allows the extension origin
      (`chrome-extension://<your-extension-id>`)

## Adjust to your schema

- `src/lib/supabaseClient.ts` — `Profile` interface should match your actual
  `profiles` table columns.
- `src/background.ts` — `RESUME_BUCKET` constant should match your actual
  Supabase Storage bucket name.
- `src/lib/fieldMatcher.ts` — the `PATTERNS` dictionary is the fuzzy matching
  logic for external job boards. Expand this over time as you see forms it
  misses.

## Known v1 limitations / deferred to v1.1+

- No Google OAuth (requires `chrome.identity.launchWebAuthFlow` + a
  registered `https://<extension-id>.chromiumapp.org/` redirect URI, and
  possibly an offscreen document for the PKCE exchange)
- No AI-generated answers for open-ended/long-form questions (requires a
  proxy API route on the Next.js app that verifies the Supabase JWT
  server-side before calling Gemini via the Vercel AI SDK — never call
  Gemini directly from the extension, it would require embedding a secret
  API key in the bundle)
- No profile editing or resume upload inside the extension itself
- Long-form fields (`isLongForm` in `fieldMatcher.ts`) are detected but
  intentionally left unfilled in v1
