import { useState } from 'react';
import { api } from '../api/client.js';

// Admin-only gate. GitHub Pages serves the shell publicly; no data loads until
// the admin token (same value as the worker ADMIN_TOKEN) is verified.
export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const ok = await api.login(token.trim());
      if (ok) onAuthed();
      else setErr('トークンが違います。worker の ADMIN_TOKEN と同じ値を入力してください。');
    } catch {
      setErr(`${api.base} に接続できません。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card panel" onSubmit={submit}>
        <div className="login-brand">
          <span className="tag">Active</span> Rating
        </div>
        <p className="subtitle" style={{ margin: '0 0 18px' }}>
          管理者ログイン — 能動検証・証跡主義の攻撃面評価
        </p>
        <label className="login-label">
          ADMIN TOKEN
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="管理者トークンを入力"
            autoFocus
            autoComplete="current-password"
          />
        </label>
        <button className="primary" type="submit" disabled={busy || !token.trim()}>
          {busy ? '確認中…' : 'ログイン'}
        </button>
        {err && <div className="result err" style={{ marginTop: 10 }}>{err}</div>}
        <div className="hint" style={{ marginTop: 16 }}>
          このダッシュボードは管理者のみ閲覧できます。データは worker 側で保護されており、
          正しいトークンなしには一切表示されません。
        </div>
      </form>
    </div>
  );
}
