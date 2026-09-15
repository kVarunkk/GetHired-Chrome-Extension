import { useEffect, useState } from 'react';
import type { ExtensionMessage, SessionStatusResponse } from '../lib/messages';

function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

export function Popup() {
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sendMessage<SessionStatusResponse>({ type: 'GET_SESSION_STATUS' }).then((res) => {
      setLoggedIn(res.loggedIn);
      if (res.email) setEmail(res.email);
      setLoading(false);
    });
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatusMsg('');
    const res = await sendMessage<SessionStatusResponse>({ type: 'LOGIN', email, password });
    setBusy(false);
    if (res.loggedIn) {
      setLoggedIn(true);
    } else {
      setStatusMsg(res.error ?? 'Login failed');
    }
  }

  async function handleLogout() {
    setBusy(true);
    await sendMessage({ type: 'LOGOUT' });
    setLoggedIn(false);
    setPassword('');
    setBusy(false);
  }

  async function handleFillPage() {
    setBusy(true);
    setStatusMsg('');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatusMsg('No active tab found');
      setBusy(false);
      return;
    }
    try {
      const res = await chrome.tabs.sendMessage<ExtensionMessage, { result: string }>(tab.id, {
        type: 'TRIGGER_AUTOFILL',
      });
      setStatusMsg(res.result);
    } catch {
      setStatusMsg('Reload the page and try again.');
    }
    setBusy(false);
  }

  if (loading) {
    return <div style={{ padding: 16 }}>Loading...</div>;
  }

  if (!loggedIn) {
    return (
      <form onSubmit={handleLogin} style={{ padding: 16, display: 'grid', gap: 10 }}>
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
        <button type="submit" disabled={busy} style={buttonStyle}>
          {busy ? 'Logging in...' : 'Log in'}
        </button>
        {statusMsg && <p style={{ color: '#dc2626', fontSize: 13, margin: 0 }}>{statusMsg}</p>}
      </form>
    );
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Welcome back</h2>
      <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{email}</p>
      <button onClick={handleFillPage} disabled={busy} style={buttonStyle}>
        {busy ? 'Working...' : 'Fill this page'}
      </button>
      <button onClick={handleLogout} disabled={busy} style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }}>
        Log out
      </button>
      {statusMsg && <p style={{ fontSize: 13, margin: 0 }}>{statusMsg}</p>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 6,
  border: 'none',
  background: '#111827',
  color: '#fff',
  fontSize: 14,
  cursor: 'pointer',
};
