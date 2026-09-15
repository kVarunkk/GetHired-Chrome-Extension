import type { Profile } from './supabaseClient';

export type ExtensionMessage =
  | { type: 'GET_SESSION_STATUS' }
  | { type: 'LOGIN'; email: string; password: string }
  | { type: 'LOGOUT' }
  | { type: 'GET_PROFILE' }
  | { type: 'GET_RESUME' }
  | { type: 'TRIGGER_AUTOFILL' }
  | { type: 'GET_LONG_FORM_ANSWERS'; questions: string[]; jobContext?: string };

export interface LongFormAnswersResponse {
  answers: Record<string, string>;
  error?: string;
}

export interface SessionStatusResponse {
  loggedIn: boolean;
  email?: string;
  error?: string;
}

export interface ProfileResponse {
  profile: Profile | null;
  error?: string;
}

export interface ResumeResponse {
  // ArrayBuffer isn't reliably structured-cloneable across all message paths,
  // so we send it as a base64 string and decode on the receiving side.
  base64: string | null;
  filename: string | null;
  mimeType: string | null;
  error?: string;
}
