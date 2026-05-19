import { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 p-4">
        <h1 className="text-xl font-bold text-primary-500">Nelson App</h1>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
