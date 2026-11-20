import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-bold text-indigo-600">404</p>
      <h1 className="text-xl font-semibold">Nie znaleziono strony</h1>
      <p className="text-sm text-slate-500">Ta strona nie istnieje lub link jest nieaktualny.</p>
      <Link href="/" className="btn btn-primary">
        Przejdź do aplikacji
      </Link>
    </main>
  );
}
