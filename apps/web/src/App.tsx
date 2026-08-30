import { useEffect, useState } from 'react';

type Health = { status: string; db: string };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>EGOMOT</h1>
      <p>Module 0 — Foundation (skeleton)</p>
      {error && <p style={{ color: 'crimson' }}>API: {error}</p>}
      {health && (
        <p>
          API: {health.status} · DB: {health.db}
        </p>
      )}
    </main>
  );
}
