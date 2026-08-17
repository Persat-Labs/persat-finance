// Public Supabase client configuration for the admin console.
// The anon/publishable key is safe to expose in browser code only because
// Supabase RLS protects the data. Never put a service-role/secret key here.
window.PERSAT_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY"
};
