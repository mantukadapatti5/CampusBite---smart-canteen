import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { homeForRole } from '../utils/roleHome.js';
import { API_BASE } from '../api/baseUrl.js';

// One-click demo accounts (created automatically by the backend on start-up).
const DEMO = [
  { label: 'Student', portal: '/student', usn: 'student1', password: 'STUDENT12' },
  { label: 'Kitchen', portal: '/kitchen', usn: 'kitchen1', password: 'KITCHEEN12' },
  { label: 'Manager', portal: '/manager', usn: 'manager', password: 'MANAGER12' },
  { label: 'Admin', portal: '/admin', usn: 'admin1', password: 'ADMIN12' },
];

function explainError(err) {
  if (!err.response) {
    return `Cannot reach the server at ${API_BASE}. Make sure the backend is running ("docker compose up --build") and open ${API_BASE}/health in your browser to check.`;
  }
  const { status, data } = err.response;
  if (status === 401) return 'Wrong USN/ID or password. Use the demo buttons below, or check the Caps Lock key (passwords are case-sensitive).';
  if (status >= 500) return `${data?.error || 'Server error'} (HTTP ${status}) - check the backend logs: docker compose logs backend`;
  return data?.error || `Login failed (HTTP ${status})`;
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [usn, setUsn] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(params.get('expired') ? 'Your session expired or was reset. Please log in again.' : '');
  const [loading, setLoading] = useState(false);
  const [server, setServer] = useState({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/health`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => { if (!cancelled) setServer(ok ? { state: 'online', users: body.users } : { state: 'degraded', detail: body.error }); })
      .catch(() => { if (!cancelled) setServer({ state: 'offline' }); });
    return () => { cancelled = true; };
  }, []);

  async function doLogin(id, pw) {
    setError('');
    setLoading(true);
    try {
      const user = await login(id.trim(), pw);
      navigate(homeForRole(user.role));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    doLogin(usn, password);
  }

  function quick(d) {
    setUsn(d.usn);
    setPassword(d.password);
    doLogin(d.usn, d.password);
  }

  const banner = {
    checking: ['text-paper/50', 'Checking server…'],
    online: ['text-leaf', server.users === 0 ? 'Server online, but there are no accounts yet - restart the backend to create the demo accounts.' : `Server online (${API_BASE})`],
    degraded: ['text-chili', `Server reachable but the database is not ready${server.detail ? `: ${server.detail}` : ''}`],
    offline: ['text-chili', `Server offline - cannot reach ${API_BASE}. Start the backend (docker compose up --build).`],
  }[server.state];

  return (
    <div className="max-w-sm mx-auto mt-10 card p-6">
      <h1 className="font-display text-3xl text-paper mb-1">Welcome back</h1>
      <p className="text-sm text-paper/60 mb-2">Log in with your USN or staff ID.</p>
      <p className={`text-[11px] mb-4 ${banner[0]}`}>● {banner[1]}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs text-paper/60 mb-1">USN / Staff ID</label>
          <input
            required
            autoComplete="username"
            value={usn}
            onChange={(e) => setUsn(e.target.value)}
            className="w-full bg-panel2 border border-white/10 rounded-lg px-3 py-2 text-paper outline-none focus:border-signal"
            placeholder="e.g. 4AT22CS000"
          />
        </div>
        <div>
          <label className="block text-xs text-paper/60 mb-1">Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-panel2 border border-white/10 rounded-lg px-3 py-2 text-paper outline-none focus:border-signal"
            placeholder="••••••••"
          />
        </div>

        {error && <p className="text-chili text-sm">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <div className="mt-5">
        <p className="text-xs text-paper/50 mb-2">Quick demo login (one click):</p>
        <div className="grid grid-cols-2 gap-2">
          {DEMO.map((d) => (
            <button key={d.label} type="button" disabled={loading} onClick={() => quick(d)} className="btn-ghost text-sm">
              {d.label} portal
            </button>
          ))}
        </div>
        <p className="text-[11px] text-paper/30 mt-2">
          student1 / STUDENT12 · kitchen1 / KITCHEEN12 · manager / MANAGER12 · admin1 / ADMIN12 (passwords are case-sensitive)
        </p>
      </div>

      <div className="flex justify-between mt-4 text-xs">
        <Link to="/register" className="text-signal">Create account</Link>
        <Link to="/forgot-password" className="text-paper/50 hover:text-signal">Forgot password?</Link>
      </div>
    </div>
  );
}
