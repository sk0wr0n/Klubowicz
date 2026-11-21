// Klubowicz – wysyłka powiadomień e-mail z kolejki public.notification_outbox.
// Wywoływana przez pg_cron/pg_net z nagłówkiem x-cron-secret (sprawdzanym w bazie).
// Wysyła: nową prośbę o dołączenie (do Właściciela) i nowe obciążenia (do zawodnika, zgrupowane per operacja).
// Wymagane sekrety: SMTP_PASSWORD (hasło aplikacji Gmail). Opcjonalnie SMTP_USER, SMTP_HOST, SMTP_PORT, APP_URL.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const APP_URL = Deno.env.get("APP_URL") ?? "https://klubowicz.pages.dev";
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "januszagentai@gmail.com";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD") ?? "";

type Row = {
  id: number;
  to_email: string;
  kind: "new_member" | "charge" | "backup";
  club_id: string | null;
  user_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const zl = (v: unknown) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number(v ?? 0));
const plDate = (d: unknown) => {
  const s = String(d ?? "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
};
const POS: Record<string, string> = {
  setter: "rozgrywający",
  outside: "przyjmujący",
  opposite: "atakujący",
  middle: "środkowy",
  libero: "libero",
};

function layout(title: string, inner: string, cta?: { href: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9">
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
  <div style="background:#4f46e5;color:#fff;border-radius:14px 14px 0 0;padding:14px 20px;font-weight:bold;font-size:18px">🏐 Klubowicz</div>
  <div style="background:#fff;border-radius:0 0 14px 14px;padding:20px">
    <h2 style="margin:0 0 12px;font-size:19px">${esc(title)}</h2>
    ${inner}
    ${cta ? `<p style="margin:20px 0 0"><a href="${cta.href}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:bold">${esc(cta.label)}</a></p>` : ""}
  </div>
  <p style="font-size:11px;color:#94a3b8;margin:12px 4px">Powiadomienia możesz wyłączyć w aplikacji: Moje konto → Powiadomienia e-mail.</p>
</div></body></html>`;
}

function bankBox(p: Record<string, unknown>, amount?: number) {
  if (!p.bank_account) return "";
  return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-top:14px;font-size:14px">
    <b>Dane do przelewu</b><br>
    ${p.bank_recipient ? `Odbiorca: ${esc(p.bank_recipient)}<br>` : ""}
    Konto: <span style="font-family:monospace">${esc(p.bank_account)}</span><br>
    Tytuł: ${esc(p.transfer_title)}
    ${amount && amount > 0 ? `<br>Kwota: <b>${zl(amount)}</b>` : ""}
  </div>`;
}

function render(r: Row): { subject: string; html: string } {
  const p = r.payload;
  if (r.kind === "new_member") {
    const pos = p.position ? POS[String(p.position)] ?? String(p.position) : "nie podano";
    const mode = p.billing_mode === "monthly" ? "składka miesięczna" : "płatność za trening";
    return {
      subject: `Nowa osoba chce dołączyć: ${p.name} (${p.club_name})`,
      html: layout(
        "Nowa prośba o dołączenie",
        `<p style="margin:0 0 10px"><b>${esc(p.name)}</b> (${esc(p.email)}) chce dołączyć do klubu <b>${esc(p.club_name)}</b>.</p>
         <p style="margin:0;font-size:14px;color:#475569">Pozycja: ${esc(pos)}<br>Rozliczenie: ${esc(mode)}</p>
         <p style="margin:12px 0 0">Zaakceptuj lub odrzuć w aplikacji: Zarządzanie → Członkowie.</p>`,
        { href: `${APP_URL}/club/members/?id=${encodeURIComponent(String(p.club_id ?? ""))}`, label: "Przejdź do członków" },
      ),
    };
  }
  return { subject: "", html: "" };
}

const TABLE_LABEL: Record<string, string> = {
  profiles: "Profile (osoby)",
  clubs: "Kluby",
  club_members: "Członkostwa",
  trainings: "Treningi",
  training_signups: "Zapisy na treningi",
  training_attendance: "Obecności",
  transactions: "Wpłaty i obciążenia",
  tournaments: "Turnieje",
  tournament_signups: "Zapisy na turnieje",
  tournament_extras: "Opłaty dodatkowe turniejów",
  billing_mode_changes: "Zmiany trybu rozliczeń",
  training_coach_votes: "Głosy na trenera",
  training_mvp_votes: "Głosy MVP",
  auth_users: "Konta logowania",
};

/** Kopia zapasowa: mail z załącznikiem JSON ze wszystkimi danymi. */
function renderBackup(r: Row): { subject: string; html: string; filename: string; json: string } {
  const snap = (r.payload.snapshot ?? {}) as { created_at?: string; tables?: Record<string, unknown[]> };
  const d = new Date(snap.created_at ?? Date.now());
  const date = d.toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  const iso = d.toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" });
  const tables = snap.tables ?? {};
  const rows = Object.entries(tables)
    .filter(([k]) => TABLE_LABEL[k])
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 0;font-size:14px">${esc(TABLE_LABEL[k])}</td><td style="padding:4px 0;text-align:right;font-weight:bold">${Array.isArray(v) ? v.length : 0}</td></tr>`,
    )
    .join("");
  const json = JSON.stringify(snap);
  return {
    subject: `Kopia zapasowa Klubowicza – ${date}`,
    filename: `klubowicz-kopia-${iso}.json`,
    json,
    html: layout(
      "Kopia zapasowa danych",
      `<p style="margin:0 0 10px">W załączniku jest pełna kopia danych aplikacji z ${esc(date)} (${Math.round(json.length / 1024)} KB).
       Zachowaj tego maila – w razie awarii dane można z niego odtworzyć.</p>
       <table style="width:100%;border-collapse:collapse">${rows}</table>
       <p style="margin:12px 0 0;font-size:12px;color:#94a3b8">Kopia wysyłana automatycznie w poniedziałki i czwartki wieczorem. Plik zawiera dane osobowe (imiona, e-maile, salda) – nie przekazuj go dalej.</p>`,
    ),
  };
}

/** Jeden mail na osobę z obciążeniami z jednej operacji (np. rozliczenie treningu, zamknięcie zapisów turnieju). */
function renderCharges(rows: Row[], balance: number): { subject: string; html: string } {
  const p = rows[0].payload;
  const items = rows.map((r) => r.payload);
  const sum = items.reduce((s, i) => s + Number(i.amount), 0);
  const list = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:14px">${esc(i.description)}<br><span style="color:#94a3b8;font-size:12px">${plDate(i.date)}</span></td><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;text-align:right;color:#dc2626;font-weight:bold;white-space:nowrap">−${zl(i.amount)}</td></tr>`,
    )
    .join("");
  const first = p.name ? ` ${esc(String(p.name).split(" ")[0])}` : "";
  const what = items.length === 1 ? String(items[0].description ?? "opłata") : `${items.length} pozycje`;
  return {
    subject: balance < 0 ? `Naliczono −${zl(sum)}: ${what} · saldo ${zl(balance)}` : `Naliczono −${zl(sum)}: ${what}`,
    html: layout(
      items.length === 1 ? "Nowe obciążenie na Twoim koncie" : "Nowe obciążenia na Twoim koncie",
      `<p style="margin:0 0 10px">Cześć${first}! W klubie <b>${esc(p.club_name)}</b> naliczono:</p>
       <table style="width:100%;border-collapse:collapse">${list}</table>
       <p style="margin:12px 0 0;font-size:15px">Twoje saldo: <b style="color:${balance < 0 ? "#dc2626" : "#059669"}">${zl(balance)}</b></p>
       ${
         balance < 0
           ? `<p style="margin:6px 0 0;font-size:14px">Do zapłaty: <b>${zl(-balance)}</b> – prosimy o wpłatę. 🙏</p>${bankBox(p, -balance)}`
           : `<p style="margin:8px 0 0;font-size:14px;color:#475569">Masz nadpłatę – nic nie musisz robić. 👍</p>`
       }`,
      { href: `${APP_URL}/club/finance/?id=${encodeURIComponent(String(p.club_id ?? ""))}`, label: "Zobacz finanse" },
    ),
  };
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const secret = req.headers.get("x-cron-secret") ?? "";
  const { data: ok } = await supabase.rpc("_check_cron_secret", { p_secret: secret });
  if (!ok) return new Response("forbidden", { status: 403 });

  if (!SMTP_PASSWORD) {
    return new Response(JSON.stringify({ error: "Brak sekretu SMTP_PASSWORD – wiadomości czekają w kolejce." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // chwila na zatwierdzenie całej operacji – obciążenia z niej trafią do jednego maila
  await new Promise((r) => setTimeout(r, 3000));
  const { data: rows, error } = await supabase.rpc("_claim_outbox", { p_limit: 60 });
  if (error) return new Response(error.message, { status: 500 });
  if (!rows?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { "Content-Type": "application/json" } });

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });

  // grupy: każda wiadomość „new_member” osobno, obciążenia razem per osoba i klub
  const groups: Row[][] = [];
  const byKey = new Map<string, Row[]>();
  for (const r of rows as Row[]) {
    if (r.kind === "charge") {
      const k = `${r.to_email}|${r.club_id}`;
      if (!byKey.has(k)) {
        const g: Row[] = [];
        byKey.set(k, g);
        groups.push(g);
      }
      byKey.get(k)!.push(r);
    } else groups.push([r]);
  }

  let sent = 0;
  for (const g of groups) {
    const ids = g.map((r) => r.id);
    try {
      let msg: { subject: string; html: string };
      let attachments: { filename: string; content: string; contentType: string }[] | undefined;
      if (g[0].kind === "backup") {
        const b = renderBackup(g[0]);
        msg = b;
        attachments = [{ filename: b.filename, content: b.json, contentType: "application/json" }];
      } else if (g[0].kind === "charge") {
        const { data: bal } = await supabase.rpc("_member_balance", { p_club: g[0].club_id, p_user: g[0].user_id });
        msg = renderCharges(g, Number(bal ?? 0));
      } else {
        msg = render(g[0]);
      }
      await transporter.sendMail({
        from: { name: "Klubowicz", address: SMTP_USER },
        to: g[0].to_email,
        subject: msg.subject,
        text: "Ta wiadomość wymaga programu pocztowego obsługującego HTML.",
        html: msg.html,
        attachments,
      });
      await supabase
        .from("notification_outbox")
        .update({
          sent_at: new Date().toISOString(),
          last_error: null,
          ...(g[0].kind === "backup" ? { payload: { sent: true } } : {}),
        })
        .in("id", ids);
      sent += 1;
    } catch (e) {
      await supabase
        .from("notification_outbox")
        .update({ claimed_at: null, last_error: String(e instanceof Error ? e.message : e).slice(0, 500) })
        .in("id", ids);
    }
  }
  try {
    transporter.close();
  } catch {
    /* */
  }
  return new Response(JSON.stringify({ sent, rows: rows.length }), { headers: { "Content-Type": "application/json" } });
});
