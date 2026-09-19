import { useEffect, useState } from "react";
import type {
  ExtensionMessage,
  SessionStatusResponse,
  ProfileResponse,
} from "../lib/messages";

function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

const LOGO_URL = chrome.runtime.getURL("icons/icon48.png");

function Header({ loggedIn }: { loggedIn: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <img
          src={LOGO_URL}
          width={24}
          height={24}
          style={{ borderRadius: 6 }}
          alt=""
        />
        <span style={{ fontWeight: 600, fontSize: 15 }}>GetHired</span>
      </div>
      {!loggedIn && (
        <a
          href="https://gethired.devhub.co.in/auth/sign-up"
          target="_blank"
          style={{ color: "blue", textDecoration: "underline" }}
        >
          Sign up
        </a>
      )}
    </div>
  );
}

export function Popup() {
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<ProfileResponse["profile"]>(null);
  const [password, setPassword] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function refreshStatus() {
      sendMessage<SessionStatusResponse>({ type: "GET_SESSION_STATUS" }).then(
        (res) => {
          setLoggedIn(res.loggedIn);
          if (res.email) setEmail(res.email);
          if (res.loggedIn) {
            sendMessage<ProfileResponse>({ type: "GET_PROFILE" }).then((p) =>
              setProfile(p.profile),
            );
          } else {
            setProfile(null);
          }
        },
      );
    }

    refreshStatus();
    setLoading(false);
    setBusy(false);

    // The background worker writes the new session to chrome.storage.local
    // once the Google auth window closes. Listen directly rather than
    // guessing when to re-check, covers the popup staying open the whole
    // time or being reopened fresh either way.
    function onStorageChange(
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) {
      if (
        area === "local" &&
        Object.keys(changes).some((k) => k.startsWith("sb-"))
      ) {
        refreshStatus();
      }
    }
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);

  async function openWebApp() {
    chrome.tabs.create({ url: "https://gethired.devhub.co.in" });
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatusMsg("");
    const res = await sendMessage<SessionStatusResponse>({
      type: "LOGIN",
      email,
      password,
    });
    setBusy(false);
    if (res.loggedIn) {
      setLoggedIn(true);
      sendMessage<ProfileResponse>({ type: "GET_PROFILE" }).then((p) =>
        setProfile(p.profile),
      );
    } else {
      setStatusMsg(res.error ?? "Login failed");
    }
  }

  async function handleGoogleLogin() {
    setBusy(true);
    setStatusMsg("");
    const res = await sendMessage<SessionStatusResponse>({
      type: "GOOGLE_LOGIN",
    });
    setBusy(false);
    if (res.loggedIn) {
      setLoggedIn(true);
      if (res.email) setEmail(res.email);
      sendMessage<ProfileResponse>({ type: "GET_PROFILE" }).then((p) =>
        setProfile(p.profile),
      );
    } else {
      setStatusMsg(res.error ?? "Google sign-in failed");
    }
  }

  async function handleLogout() {
    setBusy(true);
    await sendMessage({ type: "LOGOUT" });
    setLoggedIn(false);
    setProfile(null);
    setPassword("");
    setBusy(false);
  }

  async function handleFillPage() {
    setBusy(true);
    setStatusMsg("");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      setStatusMsg("No active tab found");
      setBusy(false);
      return;
    }
    try {
      const res = await chrome.tabs.sendMessage<
        ExtensionMessage,
        { result: string }
      >(tab.id, {
        type: "TRIGGER_AUTOFILL",
      });
      setStatusMsg(res.result);
    } catch {
      setStatusMsg("Reload the page and try again.");
    }
    setBusy(false);
  }

  if (loading) {
    return <div style={{ padding: 16 }}>Loading...</div>;
  }

  if (!loggedIn) {
    return (
      <form
        onSubmit={handleLogin}
        style={{ padding: 16, display: "grid", gap: 10 }}
      >
        <Header loggedIn={false} />
        <h2 style={{ margin: 0, fontSize: 16 }}>Log in to GetHired</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            ...buttonStyle,
            opacity: busy ? "70%" : "unset",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Logging in..." : "Log in"}
        </button>

        <div style={{ textAlign: "center" }}>OR</div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={busy}
          style={{
            ...secondaryButtonStyle,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            opacity: busy ? "70%" : "unset",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          <img
            src={chrome.runtime.getURL("icons/google-icon.svg")}
            width={18}
            height={18}
            alt=""
            style={{ objectFit: "contain" }}
          />
          {busy ? "Logging in" : "Continue with Google"}
        </button>

        {statusMsg && (
          <p style={{ color: "#dc2626", fontSize: 13, margin: 0 }}>
            {statusMsg}
          </p>
        )}
      </form>
    );
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 10 }}>
      <Header loggedIn={true} />

      {profile?.full_name ? (
        <>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{email}</p>
          <button onClick={handleFillPage} disabled={busy} style={buttonStyle}>
            {busy ? "Working..." : "Fill this page"}
          </button>
          <button
            onClick={openWebApp}
            style={{ ...buttonStyle, background: "#e5e7eb", color: "#000000" }}
          >
            Visit GetHired App
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, color: "#dc2626" }}>
            Your profile is incomplete. Complete it to start autofilling.
          </p>
          <button onClick={openWebApp} style={buttonStyle}>
            Complete Profile
          </button>
        </>
      )}
      <button
        onClick={handleLogout}
        disabled={busy}
        style={{
          ...buttonStyle,
          background: "#fee2e2",
          color: "#dc2626",
          border: "1px solid #fecaca",
        }}
      >
        Log out
      </button>
      {statusMsg && <p style={{ fontSize: 13, margin: 0 }}>{statusMsg}</p>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 6,
  border: "none",
  background: "#000000",
  color: "#fff",
  fontSize: 14,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 6,
  border: "1px solid #000000",
  background: "#ffffff",
  color: "#000000",
  fontSize: 14,
  cursor: "pointer",
};
