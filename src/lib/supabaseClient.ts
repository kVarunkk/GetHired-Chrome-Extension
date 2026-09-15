import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromeStorageAdapter } from "./storageAdapter";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let cachedClient: SupabaseClient | null = null;

/**
 * Lazily creates (or returns) the Supabase client.
 * Wrapped in try/catch: supabase-js can throw during init if
 * chrome.storage.local was just cleared (e.g. right after logout).
 * In that case we treat it as "no session" rather than crashing.
 */
export function getSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient;

  try {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: chromeStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false, // no OAuth redirect to parse in v1
      },
    });
    return cachedClient;
  } catch (err) {
    console.error(
      "[GetHired] Supabase client init failed, treating as logged out",
      err,
    );
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storage: chromeStorageAdapter, persistSession: true },
    });
    return cachedClient;
  }
}

// ---- Shared types, mirror your `profiles` table shape ----
// export interface Profile {
//   id: string;
//   first_name: string | null;
//   last_name: string | null;
//   email: string | null;
//   phone: string | null;
//   linkedin_url: string | null;
//   portfolio_url: string | null;
//   city: string | null;
//   country: string | null;
//   resume_bucket_path: string | null;
//   resume_filename: string | null;
// }

export interface Profile {
  user_id: string;
  full_name: string | null;
  email: string;
  linkedin_url: string | null;
  github_url: string | null;
  preferred_locations: string[] | null;
  experience_years: number | null;
}

export interface Resume {
  resume_path: string | null;
  name: string | null;
}
