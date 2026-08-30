import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorBanner } from '../components/Page';

export function LoginPage() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone.trim(), password);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="centered">
      <form className="card" style={{ width: '100%', maxWidth: 360 }} onSubmit={submit}>
        <h2 style={{ margin: 0 }}>EGOMOT</h2>
        <p className="muted" style={{ margin: 0 }}>Системага кирүү</p>
        <ErrorBanner message={error} />
        <label>
          Телефон
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="username"
            inputMode="tel"
            required
          />
        </label>
        <label>
          Сырсөз
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Кирүүдө…' : 'Кирүү'}
        </button>
      </form>
    </main>
  );
}
