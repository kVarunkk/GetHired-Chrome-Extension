import { getSupabase, type Profile } from "./lib/supabaseClient";
import { arrayBufferToBase64 } from "./lib/binary";
import type {
  ExtensionMessage,
  ProfileResponse,
  ResumeResponse,
  SessionStatusResponse,
  LongFormAnswersResponse,
} from "./lib/messages";

const AI_API_URL = import.meta.env.VITE_AI_API_URL as string;

const PROFILE_CACHE_KEY = "gethired_profile_cache";
const RESUME_BUCKET = "resumes"; // adjust to match your actual bucket name

async function handleLogin(
  email: string,
  password: string,
): Promise<SessionStatusResponse> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return { loggedIn: false, error: error.message };
  return { loggedIn: true, email: data.user?.email ?? undefined };
}

async function handleLogout(): Promise<{ ok: true }> {
  const supabase = getSupabase();
  await supabase.auth.signOut();
  await chrome.storage.local.remove(PROFILE_CACHE_KEY);
  return { ok: true };
}

async function getSessionStatus(): Promise<SessionStatusResponse> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return { loggedIn: false };
  return { loggedIn: true, email: data.session.user.email ?? undefined };
}

async function getProfile(forceRefresh = false): Promise<ProfileResponse> {
  if (!forceRefresh) {
    const cached = await chrome.storage.local.get(PROFILE_CACHE_KEY);
    if (cached[PROFILE_CACHE_KEY])
      return { profile: cached[PROFILE_CACHE_KEY] as Profile };
  }

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return { profile: null, error: "Not logged in" };

  const { data, error } = await supabase
    .from("user_info")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error) return { profile: null, error: error.message };
  await chrome.storage.local.set({ [PROFILE_CACHE_KEY]: data });
  return { profile: data as Profile };
}

async function getResume(): Promise<ResumeResponse> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user)
    return {
      base64: null,
      filename: null,
      mimeType: null,
      error: "Not logged in",
    };

  const { data: resume, error: resumeError } = await supabase
    .from("resumes")
    .select("resume_path, name")
    .eq("user_id", user.id)
    .eq("is_primary", true)
    .maybeSingle();

  if (resumeError || !resume?.resume_path) {
    return {
      base64: null,
      filename: null,
      mimeType: null,
      error: "No primary resume on file",
    };
  }

  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .download(resume.resume_path);
  if (error || !data) {
    return {
      base64: null,
      filename: null,
      mimeType: null,
      error: error?.message ?? "Download failed",
    };
  }

  const arrayBuffer = await data.arrayBuffer();
  return {
    base64: arrayBufferToBase64(arrayBuffer),
    filename:
      resume.name ?? resume.resume_path.split("/").pop() ?? "resume.pdf",
    mimeType: data.type || "application/pdf",
  };
}

async function handleLongFormAnswers(
  questions: string[],
  jobContext?: string,
): Promise<LongFormAnswersResponse> {
  console.log("handleLongFormAnswers", questions, jobContext);
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return { answers: {}, error: "Not logged in" };

  const token = session.access_token;
  try {
    const res = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ questions, jobContext: jobContext ?? "" }),
    });
    console.log("handleLongFormAnswers response", res);
    if (!res.ok) {
      const errBody = await res.text();
      return { answers: {}, error: `API error ${res.status}: ${errBody}` };
    }
    const data = await res.json();
    return { answers: data.answers ?? {}, error: data.error ?? undefined };
  } catch (e: any) {
    return { answers: {}, error: e?.message ?? "Fetch failed" };
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    (async () => {
      switch (message.type) {
        case "LOGIN":
          sendResponse(await handleLogin(message.email, message.password));
          break;
        case "LOGOUT":
          sendResponse(await handleLogout());
          break;
        case "GET_SESSION_STATUS":
          sendResponse(await getSessionStatus());
          break;
        case "GET_PROFILE":
          sendResponse(await getProfile());
          break;
        case "GET_RESUME":
          sendResponse(await getResume());
          break;
        case "GET_LONG_FORM_ANSWERS":
          sendResponse(
            await handleLongFormAnswers(message.questions, message.jobContext),
          );
          break;
        default:
          sendResponse({ error: "Unknown message type" });
      }
    })();
    return true; // keep the message channel open for the async response
  },
);
