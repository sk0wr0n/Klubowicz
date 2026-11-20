# Klubowicz

Wieloklubowa (multi-tenant) aplikacja PWA do zapisów na treningi, sprawdzania obecności i rozliczeń amatorskich klubów sportowych. Pierwszy klub w systemie to **VolleyClub Alternatywa** (prefiks `VCA`).

- **Frontend:** Next.js 16 (App Router, eksport statyczny) + TypeScript + Tailwind CSS 4 + Lucide Icons
- **Backend:** Supabase (PostgreSQL + Row Level Security + funkcje RPC + Auth: Google / Magic Link / kod e-mail)
- **Hosting:** klasyczny hosting WWW OVH (Apache, **bez Node.js**) – wgrywasz gotowe pliki przez FTP
- **PWA:** `manifest.json`, ikony, service worker – instalacja na ekranie głównym iPhone'a i Androida

➡️ **Instrukcja wdrożenia krok po kroku: [`docs/DEPLOY_OVH_SUPABASE.md`](docs/DEPLOY_OVH_SUPABASE.md)**

---

## Struktura projektu

```
klubowicz/
├── database/                  ❌ NIE na serwer – jednorazowo do Supabase SQL Editor
│   └── schema.sql             tabele, indeksy, RLS, triggery, RPC, dane startowe VCA
├── examples/                  ❌ NIE na serwer – lokalne testy
│   └── sample_bank_import.csv 5 fikcyjnych przelewów do testu importera
├── docs/                      ❌ NIE na serwer
│   └── DEPLOY_OVH_SUPABASE.md
├── public/                    statyczne pliki aplikacji (trafiają do out/)
│   ├── .htaccess              HTTPS, linki /join/KOD, nagłówki bezpieczeństwa, cache
│   ├── config.js              ← TU wpisujesz Project URL i Publishable key Supabase
│   ├── manifest.json          PWA
│   ├── sw.js                  service worker
│   └── icons/                 ikony PWA / apple-touch-icon
├── src/
│   ├── app/                   strony (App Router)
│   │   ├── page.tsx           inteligentny routing po zalogowaniu
│   │   ├── login/             Google + link e-mail + kod
│   │   ├── auth/callback/     powrót z logowania
│   │   ├── join/              dołączanie do klubu: /join/KOD
│   │   ├── clubs/             wybór klubu / ekran powitalny
│   │   ├── account/           profil (imię i nazwisko)
│   │   ├── superadmin/        panel Superadmina (kluby, abonamenty platformy)
│   │   └── club/              widoki klubu (?id=…)
│   │       ├── page.tsx       treningi: lista + kalendarz
│   │       ├── training/      szczegóły, zapisy, 🚗/🍺, obecność, rozliczenie
│   │       ├── team/          Zespół: skład i salda (Opiekun + Właściciel)
│   │       ├── stats/         Statystyki TOP 10 (wszyscy członkowie)
│   │       ├── finance/       Moje finanse (saldo, dane do przelewu, historia)
│   │       ├── admin/         hub Właściciela + link zapraszający
│   │       ├── members/       akceptacja, role, tryby rozliczeń, aliasy
│   │       ├── payments/      salda, składki miesięczne, wpłaty ręczne
│   │       ├── import/        import wyciągu CSV
│   │       └── settings/      ustawienia klubu
│   ├── components/            komponenty UI
│   └── lib/                   Supabase, auth, CSV, formatowanie, typy
├── out/                       ✅ wynik `npm run build` – TYLKO TO na serwer OVH
├── .env.example               opcjonalne zmienne (alternatywa dla config.js)
├── .gitignore
├── next.config.ts             output: 'export'
└── package.json
```

## Szybki start (lokalnie)

```bash
npm install
cp .env.example .env.local     # uzupełnij URL i Publishable key Supabase
npm run dev                    # http://localhost:3000
npm run build                  # gotowa aplikacja w katalogu out/
```

Lokalnie linki zaproszeń otwieraj w formie `http://localhost:3000/join/?code=VCA-START2026` (forma `/join/KOD` działa na serwerze dzięki `.htaccess`).

## Role

| Rola | Gdzie | Uprawnienia |
|---|---|---|
| **Superadmin** | `profiles.is_superadmin = true` | tworzy kluby, przypisuje Właścicieli, plany 0/50/100 zł, naliczenia, „opłacone”, zawieszanie/odblokowanie |
| **Właściciel** | `club_members.role = 'owner'` | członkowie, role Opiekuna, tryby rozliczeń, stawki, konto, składki, wpłaty, import CSV, treningi |
| **Opiekun / Trener** | `club_members.role = 'caretaker'` | treningi, sprawdzanie obecności, dopisywanie „zapominalskich”, zakładka **Zespół** (cały skład i saldo każdej osoby – tylko odczyt); **bez** wpłat, składek, importu CSV i ustawień klubu |
| **Zawodnik** | `club_members.role = 'member'` | zapis/wypis siebie, ikonki 🚗/🍺, lista zapisanych, własne saldo i historia |

## Zasady rozliczeń

- **Abonament (`monthly`)** – Właściciel klika „Nalicz składkę za [miesiąc]”; ponowne naliczenie tego samego miesiąca jest zablokowane w bazie.
- **Za trening (`per_session`)** – przy zapisie gracz widzi ostrzeżenie o kwocie. Po treningu Opiekun zaznacza obecnych (może dopisać osoby niezapisane w aplikacji) i klika **„Zatwierdź obecność”** – system sam obciąża faktycznie obecnych graczy `per_session`; abonenci (`monthly`) nie płacą za trening. Ekran obecności celowo nie pokazuje kwot.
- **Status obecności** – Opiekun i Właściciel widzą przy minionych treningach oznaczenie „Obecność niesprawdzona” / „✓ Obecność sprawdzona” oraz sekcję „Obecność do sprawdzenia”.
- **Późne wypisanie** – gracz `per_session`, który wypisze się później niż `cancellation_deadline_hours` przed treningiem, trafia na listę „wypisani po terminie”; Opiekun decyduje przy rozliczeniu, czy naliczyć opłatę.
- **Lista rezerwowa (FIFO)** – po zwolnieniu miejsca pierwsza osoba z rezerwy awansuje automatycznie.

## Statystyki (dla wszystkich członków)

Zakładka **Statystyki** pokazuje rankingi TOP 10 za wybrany okres (ten miesiąc / ten rok / od początku): najwięcej treningów, najczęściej autem 🚗, najczęściej na integracji 🍺 oraz najwyższe saldo (tylko nadpłaty). Liczą się wyłącznie treningi z zatwierdzoną obecnością. Każdy widzi też swoje wyniki i miejsce w rankingu. Funkcja `club_stats` zwraca tylko czołówkę – pełna lista sald nie jest dostępna dla zawodników.

## Import CSV

Plik jest parsowany **lokalnie w przeglądarce** (UTF-8 / Windows-1250, separator `;` `,` lub tabulator, automatyczne wykrycie wiersza nagłówka). Wpływy są dopasowywane po kodzie zawodnika (`VCA-04`, `VCA 4`, `vca04`), aliasach oraz imieniu i nazwisku. Przed zaksięgowaniem widać podgląd; duplikaty są wykrywane po hashu SHA-256 transakcji (również przy ponownym imporcie tego samego pliku).

## Monetyzacja platformy

`platform_subscriptions` (plan, kwota, `grace_period_days`, `suspend_after_days`, status) i `platform_invoices` (naliczenia miesięczne). Status jest przeliczany automatycznie przy każdym użyciu klubu: po okresie karencji → `past_due` (baner z kwotą i danymi do przelewu dla Właściciela), po `suspend_after_days` → `suspended` (blokada zapisów, rozliczeń treningów, naliczeń i importu CSV).
