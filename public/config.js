/*
 * KLUBOWICZ – konfiguracja połączenia z Supabase (czytana w przeglądarce).
 *
 * Po wgraniu aplikacji na serwer OVH edytuj TYLKO ten plik:
 *   supabaseUrl            -> Supabase: Project Settings -> Data API -> Project URL
 *                             (lub przycisk "Connect" na górze panelu projektu)
 *   supabasePublishableKey -> Supabase: Project Settings -> API Keys -> Publishable key (sb_publishable_...)
 *                             (starszy klucz "anon public" również zadziała)
 *
 * Te wartości są publiczne z założenia – dane chroni Row Level Security w bazie.
 * NIGDY nie wpisuj tutaj klucza "secret" (sb_secret_...) ani "service_role".
 */
window.__KLUBOWICZ_CONFIG__ = {
  supabaseUrl: 'https://TWOJ-PROJEKT.supabase.co',
  supabasePublishableKey: 'TWOJ-PUBLISHABLE-KEY',
  appName: 'Klubowicz',
};
