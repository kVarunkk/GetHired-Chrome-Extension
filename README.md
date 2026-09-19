# GetHired Chrome Extension

A Chrome extension that autofills job application forms using your GetHired profile, resume, and AI-generated answers for long-form questions.

## Overview

The **GetHired Extension** helps you complete job applications faster by automatically filling in your profile details, attaching your resume, and generating tailored answers for open-ended application questions. It works across major job boards and ATS platforms, and syncs with your GetHired account at `https://gethired.devhub.co.in`.

## Features

- **Autofill profile fields** — automatically fills name, email, phone, LinkedIn, portfolio, location, and other standard fields from your GetHired profile.
- **Resume attachment** — attaches your primary resume from Supabase Storage to the application.
- **AI long-form answers** — generates tailored, first-person answers for open-ended application questions using your resume and profile data.
- **Google OAuth + email/password login** — sign in with your GetHired account using either method.
- **Cross-frame support** — handles embedded application forms (e.g., Greenhouse, AshbyHQ) rendered inside iframes.
- **Manual trigger** — a floating "Autofill with GetHired" button on the page, plus a "Fill this page" button in the popup.
- **Dark/light mode aware** — the autofill button adapts to the page's color scheme.

## Supported Job Boards

Tested and working on:

- Greenhouse
- Lever
- Wellfound
- AshbyHQ
- Workable
- Rippling

The extension uses intelligent field detection (labels, ARIA attributes, placeholders, and form structure) to work across a wide range of ATS platforms.

## Installation

### From Chrome Web Store

The extension will be available on the Chrome Web Store soon.

### Manual Installation (Development)

1. Clone this repository:

   ```bash
   git clone https://github.com/kVarunkk/GetHired-Chrome-Extension.git
   cd GetHired-Chrome-Extension
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file from the example:

   ```bash
   cp .env.example .env
   ```

4. Fill in your Supabase project URL and anon key in `.env`:

   ```env
   VITE_SUPABASE_URL=https://vehnycoyrmqdfywybboc.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_drau1V-mqm1crM0jh5qxfw_t5eTOe_M
   VITE_APP_API_BASE_URL=https://gethired.devhub.co.in
   ```

5. Build the extension:

   ```bash
   npm run build
   ```

6. Load it in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select the `dist/` directory

## Usage

1. Open Chrome and navigate to a job application page on a supported job board.
2. Click the extension icon in the toolbar.
3. Sign in with your GetHired account (email/password or Google OAuth).
4. Click **Fill this page** in the popup, or use the floating **Autofill with GetHired** button on the page.
5. The extension will:
   - Fill in your profile details
   - Attach your primary resume
   - Generate and fill answers for long-form questions
6. Review the filled form and submit the application.

## Privacy

- **No application data is stored.** Filled answers and form data are not persisted by the extension.
- Authentication is handled through Supabase Auth.
- AI answer generation is performed by the GetHired web app API.

## Tech Stack

- **Chrome Extension Manifest V3**
- **TypeScript**
- **React 18**
- **Vite**
- **Supabase Auth + Storage**
- **Vercel AI SDK** (via GetHired backend)

## Project Structure

```
gethired-extension/
├── manifest.json              # Chrome extension manifest
├── src/
│   ├── background.ts          # Service worker: auth, Supabase, API calls
│   ├── content.ts             # Content script: field detection, autofill, iframe support
│   ├── popup/
│   │   ├── Popup.tsx          # Popup UI: login, fill, history
│   │   └── main.tsx           # Popup entry point
│   └── lib/
│       ├── autofill.ts        # Native value setting, resume attachment
│       ├── fieldMatcher.ts    # Intelligent field/question detection
│       ├── messages.ts        # Message types between popup/content/background
│       ├── storageAdapter.ts  # chrome.storage adapter for Supabase
│       ├── supabaseClient.ts  # Supabase client configuration
│       └── binary.ts          # Base64 / ArrayBuffer helpers
├── public/icons/              # Extension and brand icons
├── .env.example               # Environment variable template
├── vite.config.ts             # Vite + CRXJS config
└── README.md
```

## Development

```bash
npm run dev
```

For hot-reloading during development, load the extension from the Vite dev server output.

## Troubleshooting

- **"Couldn't load your profile"** — make sure you're logged in to GetHired and that your profile exists in Supabase.
- **"No primary resume on file"** — upload a resume to your GetHired account and mark it as primary.
- **Fields not filling on a job board** — the extension uses label/ARIA/placeholder detection. If a board uses unusual markup, the field may be skipped.
- **Long-form answers blank** — check your AI credits in GetHired, and ensure the `/api/extension/generate-answer` route is deployed.
- **Popup says "Reload the page and try again"** — the content script may not be injected yet. Reload the page and retry.
- **Google sign-in fails** — ensure the Chrome extension ID and redirect URL are registered in your Supabase Google OAuth provider.

## License

MIT — License file to be added.

## GitHub

Source code: https://github.com/kVarunkk/GetHired-Chrome-Extension
