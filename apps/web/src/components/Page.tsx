import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Page({
  title,
  back,
  actions,
  children,
}: {
  title: string;
  back?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="page">
      {back && (
        <Link to={back} className="muted">
          ← Артка
        </Link>
      )}
      <div className="row">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </main>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="banner error">{message}</p>;
}

export function Loading({ what = 'Жүктөлүүдө…' }: { what?: string }) {
  return <p className="muted">{what}</p>;
}

export function Empty({ text }: { text: string }) {
  return <p className="muted">{text}</p>;
}
