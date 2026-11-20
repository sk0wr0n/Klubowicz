# Klubowicz – wdrożenie krok po kroku (Supabase + hosting WWW OVH)

> Instrukcja „kopiuj-wklej” dla osoby, która ma **klasyczny hosting WWW w OVH (bez Node.js)** i domenę w OVH.
> Czas: ok. 45–60 minut za pierwszym razem.

---

## Jak to działa (w 30 sekund)

```
 Telefon / komputer zawodnika
          │  https://klub.twojadomena.pl
          ▼
 ┌──────────────────────────────┐        ┌───────────────────────────────────┐
 │ Hosting WWW OVH (Apache)     │        │ Supabase (darmowy plan)           │
 │ zwykłe pliki HTML/JS/CSS     │ ─────▶ │ • PostgreSQL + RLS (dane klubów)  │
 │ + config.js + .htaccess      │  API   │ • logowanie Google / link e-mail  │
 │ (bez Node.js, bez PHP)       │        │ • funkcje RPC (zapisy, rozliczenia)│
 └──────────────────────────────┘        └───────────────────────────────────┘
```

- Aplikacja jest zbudowana jako **eksport statyczny Next.js** – to zwykłe pliki, które Apache na OVH serwuje bez żadnego serwera Node.js.
- Cała logika, która musi być bezpieczna (kto co widzi, zapisy bez wyścigów, naliczanie opłat, blokada zawieszonych klubów), działa **w bazie Supabase** (RLS + funkcje SQL). Przeglądarka nie może tego obejść.
- **Vercel ani Cloudflare nie są potrzebne.** (Jeśli kiedyś zechcesz – patrz „Dodatek B”.)

---

## Co wgrywasz na serwer, a czego NIE

| Katalog / plik w projekcie | Co to jest | Na serwer OVH? |
|---|---|---|
| `out/` (po `npm run build`) **lub** gotowa paczka `klubowicz-www.zip` | gotowa aplikacja WWW | ✅ **TAK – tylko zawartość** |
| `database/schema.sql` | jednorazowy skrypt do Supabase (SQL Editor) | ❌ NIE |
| `examples/sample_bank_import.csv` | plik do lokalnego testu importera | ❌ NIE |
| `docs/`, `README.md` | dokumentacja | ❌ NIE |
| `src/`, `public/`, `node_modules/`, `package.json`, `next.config.ts`, `tsconfig.json` | kod źródłowy i narzędzia do budowania | ❌ NIE |
| `.env`, `.env.local`, `.env.example` | zmienne środowiskowe | ❌ NIE (nigdy) |

Dodatkowo plik `.htaccess` blokuje dostęp do plików `.sql`, `.csv`, `.md`, `.env`, `.zip` i ukrytych – na wypadek, gdyby coś trafiło na serwer przez pomyłkę.

---

## Krok 1. Supabase – projekt i baza danych

1. Wejdź na **https://supabase.com** → **Sign in** (np. kontem GitHub lub Google).
2. **New project**:
   - *Name*: `klubowicz`
   - *Database Password*: wygeneruj i zapisz w menedżerze haseł (nie będzie potrzebne w aplikacji).
   - *Region*: **Central EU (Frankfurt)** – najbliżej Polski.
   - Plan: **Free** → **Create new project**. Poczekaj 1–2 minuty.
3. W menu po lewej: **SQL Editor** → **New query**.
4. Otwórz na komputerze plik `database/schema.sql`, zaznacz **całość** (Ctrl+A), skopiuj i wklej do edytora.
5. Kliknij **Run** (lub Ctrl+Enter).
6. ✅ **Oczekiwany wynik** – w dolnym panelu *Results* jeden wiersz:

   ```
   status
   Klubowicz: schemat zainstalowany poprawnie. Klub VCA, link zapraszający: /join/VCA-START2026
   ```

   Jeśli Supabase zapyta o potwierdzenie operacji „destructive” (skrypt zawiera `DROP POLICY IF EXISTS`) – potwierdź **Run this query**. Skrypt można bezpiecznie uruchomić ponownie.

   Utworzył się klub **VolleyClub Alternatywa** (prefiks `VCA`, składka 150 zł, trening 40 zł, wypisanie do 24 h) oraz przykładowe treningi (wtorki i czwartki 19:00 przez 4 tygodnie).

> ℹ️ Darmowy projekt Supabase jest wstrzymywany po ok. tygodniu bez żadnej aktywności. Przy regularnych treningach to się nie zdarzy; jeśli tak – w panelu kliknij **Restore project**.

---

## Krok 2. Logowanie (Google + link e-mail) i adresy URL

Najpierw zdecyduj, pod jakim adresem będzie aplikacja, np. **`https://klub.twojadomena.pl`** (subdomena) albo `https://twojadomena.pl`. Poniżej używam `klub.twojadomena.pl` – podmień na swój adres.

### 2a. URL Configuration (OBOWIĄZKOWE)

Supabase → **Authentication** → **URL Configuration**:

- **Site URL**: `https://klub.twojadomena.pl`
- **Redirect URLs** → *Add URL* (dodaj oba):
  ```
  https://klub.twojadomena.pl/**
  http://localhost:3000/**
  ```
  (drugi tylko do testów na komputerze – możesz go później usunąć)

→ **Save**.

### 2b. Logowanie przez Google

1. Wejdź na **https://console.cloud.google.com** → utwórz projekt (np. „Klubowicz”).
2. **APIs & Services → OAuth consent screen** (lub *Google Auth Platform → Branding*): typ **External**, nazwa aplikacji „Klubowicz”, Twój e-mail → zapisz. W sekcji *Audience* opublikuj aplikację (**Publish app**), aby mogli logować się wszyscy, a nie tylko testerzy.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - *Application type*: **Web application**
   - *Authorized JavaScript origins*: `https://klub.twojadomena.pl`
   - *Authorized redirect URIs*: adres z Supabase w formacie
     ```
     https://TWOJ-PROJEKT.supabase.co/auth/v1/callback
     ```
     (dokładny adres skopiujesz w Supabase: **Authentication → Sign In / Providers → Google → Callback URL**)
4. Skopiuj **Client ID** i **Client secret**.
5. Supabase → **Authentication → Sign In / Providers → Google** → włącz → wklej *Client ID* i *Client Secret* → **Save**.

### 2c. Link e-mail (Magic Link) – WŁASNY SERWER POCZTY (ważne!)

Wbudowana poczta Supabase **wysyła wiadomości tylko do członków zespołu projektu** i ma bardzo niski limit – zwykli zawodnicy zobaczyliby błąd „Email address not authorized”. Dlatego podłącz skrzynkę e-mail z OVH (masz ją zwykle w pakiecie hostingu):

1. OVH Manager → **Web Cloud → E-maile** (lub *Hosting → E-maile*) → utwórz skrzynkę, np. `klubowicz@twojadomena.pl`, ustaw hasło.
2. Supabase → **Authentication → Emails → SMTP Settings** → **Enable Custom SMTP**:
   | Pole | Wartość |
   |---|---|
   | Sender email | `klubowicz@twojadomena.pl` |
   | Sender name | `Klubowicz` |
   | Host | `ssl0.ovh.net` |
   | Port | `465` |
   | Username | `klubowicz@twojadomena.pl` |
   | Password | hasło skrzynki |
   → **Save**.
3. Supabase → **Authentication → Rate Limits**: sprawdź limit e-maili na godzinę (np. 30) – wystarczy dla klubu.

> Jeśli nie chcesz konfigurować poczty – zawodnicy mogą logować się **wyłącznie przez Google** (działa od razu).

### 2d. Szablon e-maila z kodem (dla aplikacji na ekranie głównym telefonu)

Na iPhonie link z e-maila otwiera się w Safari, a nie w aplikacji dodanej do ekranu głównego. Dlatego aplikacja pozwala też wpisać **kod z e-maila**. Dodaj kod do szablonu:

Supabase → **Authentication → Emails → Templates → Magic Link** (*Magic link or OTP*):

- **Subject**: `Logowanie do Klubowicza – kod {{ .Token }}`
- **Body** (zastąp całość):
  ```html
  <h2>Logowanie do aplikacji Klubowicz</h2>
  <p>Kliknij, aby się zalogować:</p>
  <p><a href="{{ .ConfirmationURL }}">Zaloguj się</a></p>
  <p>Korzystasz z aplikacji na ekranie głównym telefonu? Wpisz w niej ten kod:</p>
  <h1 style="letter-spacing:6px">{{ .Token }}</h1>
  <p>Link i kod są ważne przez 1 godzinę. Jeśli to nie Ty – zignoruj tę wiadomość.</p>
  ```
→ **Save**.

---

## Krok 3. Klucze API (Project URL i Publishable key)

Supabase → przycisk **Connect** na górze projektu **lub** **Project Settings**:

- **Project URL** – np. `https://abcdefghijkl.supabase.co` (*Project Settings → Data API*, albo okno *Connect*).
- **Publishable key** – *Project Settings → API Keys* → zakładka *Publishable and secret API keys* → klucz zaczynający się od `sb_publishable_…`
  (jeśli widzisz przycisk **Create new API keys** – kliknij go; starsze projekty mają tylko klucz „anon public”, który również zadziała).

> ⚠️ **Nigdy** nie używaj klucza **secret** (`sb_secret_…`) ani **service_role**. Klucz publishable jest publiczny z założenia – dane chroni RLS.

Te dwie wartości wpiszesz w pliku **`config.js`** (krok 4c).

---

## Krok 4. Wgranie aplikacji na hosting WWW OVH

### 4a. Przygotuj pliki aplikacji

**Wariant A – gotowa paczka (najprościej, bez instalowania czegokolwiek):**
rozpakuj `klubowicz-www.zip` – to zawartość katalogu `out/`, gotowa do wgrania.

**Wariant B – zbuduj samodzielnie** (wymaga Node.js 20+ na komputerze, https://nodejs.org):
```bash
npm install
npm run build
```
Wynik pojawi się w katalogu **`out/`**.

### 4b. Subdomena i certyfikat SSL w OVH

1. OVH Manager → **Web Cloud → Hostingi** → wybierz swój hosting → zakładka **Multisite** → **Dodaj domenę lub subdomenę**.
2. Wybierz domenę `twojadomena.pl`, wpisz subdomenę **`klub`**.
3. **Katalog główny**: `klubowicz` (osobny katalog – Twoja dotychczasowa strona w `www` zostaje nietknięta).
4. Zaznacz **SSL** oraz zgodę na automatyczną konfigurację DNS (gdy domena jest w OVH, rekord dodaje się sam) → **Zatwierdź**.
5. Zakładka **Informacje ogólne** → **Certyfikat SSL** → jeśli nie ma certyfikatu: **Zamów → Let's Encrypt** (darmowy). Jeśli jest – w *Multisite* przy subdomenie użyj **Wygeneruj ponownie certyfikat SSL**.
6. Odczekaj 15–60 minut, aż `https://klub.twojadomena.pl` zacznie odpowiadać (propagacja DNS + certyfikat).

> Chcesz aplikację na głównej domenie? Zamiast punktów 1–4 wgraj pliki do katalogu `www` (zastąpią obecną stronę).

### 4c. Wpisz klucze do `config.js`

W rozpakowanych plikach (lub w `out/`) otwórz w Notatniku plik **`config.js`** i uzupełnij:

```js
window.__KLUBOWICZ_CONFIG__ = {
  supabaseUrl: 'https://abcdefghijkl.supabase.co',
  supabasePublishableKey: 'sb_publishable_XXXXXXXXXXXXXXXXXXXX',
  appName: 'Klubowicz',
};
```

To jedyny plik, który edytujesz. Przy aktualizacjach aplikacji zachowaj swoją kopię `config.js`.

### 4d. Wgraj pliki przez FTP (FileZilla)

1. OVH Manager → Hosting → zakładka **FTP – SSH**: odczytaj **Serwer FTP** (np. `ftp.cluster0XX.hosting.ovh.net`), **Login**, port (21 dla FTP; 22 dla SFTP w ofertach, które go mają). Hasło ustawisz przyciskiem **Zmień hasło**.
2. Zainstaluj **FileZilla** (https://filezilla-project.org) → połącz się.
3. W FileZilli włącz pokazywanie plików ukrytych: menu **Serwer → Wymuś pokazywanie ukrytych plików** (potrzebne dla `.htaccess`).
4. Po prawej (serwer) wejdź do katalogu **`klubowicz`** (ten z kroku 4b; lub `www`).
5. Po lewej wejdź do rozpakowanej paczki / katalogu `out/` i przeciągnij **całą zawartość** (nie sam folder!) na prawo. Muszą się znaleźć m.in.:
   ```
   .htaccess   config.js   index.html   manifest.json   sw.js   404.html
   _next/   icons/   login/   join/   club/   clubs/   account/   superadmin/   auth/
   ```
6. Otwórz `https://klub.twojadomena.pl` → powinien pojawić się ekran logowania.

### 4e. Co z resztą hostingu WWW OVH?

- Twoja dotychczasowa strona (np. wizytówka klubu w `www`) działa dalej – możesz dodać na niej przycisk „Zapisy na treningi” prowadzący do `https://klub.twojadomena.pl`.
- Jeśli wolisz, by `twojadomena.pl/zapisy` przekierowywało do aplikacji – w katalogu `www` w pliku `.htaccess` dopisz:
  ```apache
  Redirect 302 /zapisy https://klub.twojadomena.pl/
  ```

---

## Krok 5. Nadanie sobie ról (Superadmin + Właściciel VCA)

1. Otwórz aplikację i **zaloguj się** (Google lub link e-mail). Podaj imię i nazwisko.
   Zobaczysz ekran „Nie należysz jeszcze do żadnego klubu” – to prawidłowe.
2. Supabase → **SQL Editor → New query** → wklej (podmień e-mail na swój, **małymi literami**):

```sql
-- 1) Superadmin całej platformy
update public.profiles
set is_superadmin = true
where email = 'twoj.email@gmail.com';

-- 2) Właściciel klubu VolleyClub Alternatywa (VCA), status aktywny
insert into public.club_members (club_id, user_id, role, status, billing_mode)
select c.id, p.id, 'owner', 'active', 'monthly'
from public.clubs c, public.profiles p
where c.prefix = 'VCA' and p.email = 'twoj.email@gmail.com'
on conflict (club_id, user_id) do update set role = 'owner', status = 'active';

-- 3) Sprawdzenie
select p.email, p.is_superadmin, c.prefix, m.role, m.status, m.member_code
from public.profiles p
left join public.club_members m on m.user_id = p.id
left join public.clubs c on c.id = m.club_id
where p.email = 'twoj.email@gmail.com';
```

✅ Oczekiwany wynik ostatniego zapytania: `is_superadmin = true`, `VCA`, `owner`, `active`, `VCA-01`.

3. Odśwież aplikację w przeglądarce – trafisz prosto do treningów VCA. Menu (awatar w prawym górnym rogu) zawiera **Panel Superadmina**.

---

## Krok 6. Pierwsze uruchomienie klubu

1. **Zarządzanie → Ustawienia klubu**: wpisz prawdziwy numer konta klubu, odbiorcę, stawki, miejsce treningów.
2. **Zarządzanie → Link zapraszający**: skopiuj link `https://klub.twojadomena.pl/join/VCA-…` i wyślij zawodnikom (np. na grupę WhatsApp/Messenger).
   Możesz wygenerować nowy link – stary przestanie działać.
3. **Zarządzanie → Członkowie**: akceptuj oczekujących, ustaw tryb rozliczeń (abonament / za trening), nadaj rolę **Opiekuna** trenerowi, dodaj **aliasy** (np. nazwisko rodzica płacącego za zawodnika).
4. **Panel Superadmina → Dane platformy**: wpisz numer konta, na który kluby mają płacić za aplikację (pokaże się w banerze zaległości).
5. Usuń lub edytuj przykładowe treningi i dodaj własne (przycisk **Nowy**, opcja „Powtórz co tydzień”).

### Instalacja na telefonie (PWA)

- **iPhone (Safari)**: otwórz adres → przycisk **Udostępnij** → **Do ekranu początkowego** → *Dodaj*.
- **Android (Chrome)**: otwórz adres → menu **⋮** → **Zainstaluj aplikację** / *Dodaj do ekranu głównego*.

### Test importu wyciągu

**Zarządzanie → Import wyciągu CSV** → wybierz `examples/sample_bank_import.csv` (z komputera, nie z serwera). Zobaczysz podgląd z dopasowaniami po kodzie `VCA-XX`, aliasie oraz imieniu i nazwisku (dopasowania zadziałają, gdy w klubie będą osoby o tych nazwiskach/kodach). Nic nie zostanie zaksięgowane bez kliknięcia **Zaksięguj**.

---

## Aktualizacja aplikacji

1. Zbuduj nową wersję (`npm run build`) lub pobierz nową paczkę.
2. Wgraj zawartość `out/` przez FTP, **nadpisując** pliki – ale **nie nadpisuj swojego `config.js`** (albo wgraj go ponownie ze swojej kopii).
3. Jeśli zmienił się `database/schema.sql` – uruchom go ponownie w SQL Editor (skrypt jest bezpieczny przy ponownym uruchomieniu; nie usuwa danych).

---

## Rozwiązywanie problemów

| Objaw | Przyczyna / rozwiązanie |
|---|---|
| „Aplikacja nie jest jeszcze skonfigurowana” | Uzupełnij `config.js` (krok 4c) i odśwież stronę (Ctrl+F5). |
| Po zalogowaniu Google przenosi na `localhost` | Zły **Site URL** w Supabase (krok 2a). |
| „redirect_uri_mismatch” od Google | W Google Cloud brakuje adresu `https://TWOJ-PROJEKT.supabase.co/auth/v1/callback`. |
| „Email address not authorized” | Brak własnego SMTP (krok 2c). |
| Link z e-maila: „Nie udało się zalogować” | Link otworzył się w innej przeglądarce niż ta, w której o niego proszono – wpisz **kod z e-maila** w aplikacji. |
| `/join/KOD` pokazuje 404 | Na serwer nie trafił plik `.htaccess` (włącz pokazywanie ukrytych plików w FileZilli). |
| Strona bez kłódki / „Niezabezpieczona” | Certyfikat SSL jeszcze się generuje (krok 4b, pkt 5) – odczekaj do 24 h. |
| „Klub jest zawieszony…” | Nieopłacona subskrypcja platformy – Superadmin: **Oznacz jako opłacone** lub **Odblokuj klub**. |
| Zmiany po aktualizacji niewidoczne na telefonie | Zamknij i otwórz aplikację ponownie (service worker pobiera nową wersję). |

---

## Dodatek A – model bezpieczeństwa (skrót)

- **RLS na każdej tabeli**: użytkownik widzi tylko dane klubów, w których ma aktywne członkostwo. Członkowie innego klubu nie widzą niczego.
- **Brak bezpośrednich zapisów** do tabel zapisów, transakcji i klubów – tylko funkcje RPC, które sprawdzają `auth.uid()`, rolę w klubie i status subskrypcji (`suspended` blokuje zapisy, rozliczenia, naliczenia i import).
- **Zawodnik** zapisuje/wypisuje tylko siebie i widzi tylko własne transakcje i saldo. **E-maile i aliasy** innych osób są ukryte (uprawnienia na poziomie kolumn).
- **Opiekun** tworzy treningi, sprawdza i zatwierdza obecność, dopisuje obecnych; w zakładce **Zespół** widzi skład i saldo każdej osoby (tylko odczyt, przez RPC `team_overview` / `member_history`). Nie widzi e-maili ani aliasów, nie księguje wpłat, nie nalicza składek, nie importuje CSV i nie zmienia ustawień klubu.
- **Statystyki** (RPC `club_stats`) widzą wszyscy aktywni członkowie klubu: rankingi TOP 10 obecności, przyjazdów autem, integracji i najwyższego salda (tylko wartości dodatnie). Pełne salda pozostałych osób nie są ujawniane zawodnikom.
- **Właściciel** zarządza członkami, stawkami, kontem, składkami, wpłatami i importem.
- **Superadmin** (`profiles.is_superadmin`) tworzy kluby i zarządza abonamentami platformy. Flagi nie da się ustawić z aplikacji – tylko w SQL Editor.
- **Wyścigi o ostatnie miejsce** eliminuje blokada wiersza treningu (`SELECT … FOR UPDATE`) w funkcjach zapisów; kolejka rezerwowa jest FIFO.
- **Podwójne naliczenia** blokują unikalne indeksy (składka: klub+osoba+miesiąc; trening: trening+osoba; import: hash transakcji).

## Dodatek B – alternatywa: Vercel lub Cloudflare Pages

Nie jest potrzebna, ale jeśli kiedyś zechcesz hostować aplikację poza OVH:

- **Cloudflare Pages**: *Create project → Upload assets* → wgraj zawartość `out/` (z uzupełnionym `config.js`). Przekierowanie `/join/*` dodaj w pliku `_redirects`: `/join/* /join/index.html 200`.
- **Vercel**: zaimportuj repozytorium; ustawienia domyślne Next.js; zmienne `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` w *Settings → Environment Variables*; ścieżki `/join/KOD` obsłuż regułą `rewrites` w `vercel.json`.
- **Domena z OVH**: OVH Manager → **Domeny → twojadomena.pl → Strefa DNS → Dodaj wpis → CNAME**: subdomena `klub`, cel podany przez Vercel/Cloudflare (np. `cname.vercel-dns.com.`). Usuń wcześniej subdomenę `klub` z *Multisite* hostingu, jeśli tam była.
- Pamiętaj o aktualizacji **Site URL / Redirect URLs** w Supabase i *Authorized JavaScript origins* w Google.
