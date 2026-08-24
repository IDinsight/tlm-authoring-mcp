/*
 * Layer: app · OAuth authorization UI
 *
 * Supabase's OAuth server delegates the login + consent screen to the
 * application: its dashboard "Authorization Path" must point at a page that
 * authenticates the user and approves/denies the authorization request via
 * supabase-js. This serves that page (framework-free, single HTML response) so
 * no separate frontend deployment is needed. It is intentionally public — the
 * user is mid-login here, so bearer auth cannot apply.
 *
 * Flow (per Supabase OAuth Server docs): the authorize endpoint redirects here
 * with ?authorization_id=…; the page signs the user in, fetches the
 * authorization details, and calls approve/deny, then follows the returned
 * redirect back to the client (e.g. Claude).
 *
 * Two ways in. Google leaves the page and comes back — so the return URL keeps
 * `authorization_id`, and the session check at the bottom picks the flow up
 * again on reload. Email+password never leaves the page. `showGoogle` is false
 * only when the Supabase project has the provider switched off, so we don't
 * render a button that dead-ends.
 */
export function consentPage(supabaseUrl: string, anonKey: string, showGoogle = true): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion — MOHEBS TLM</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f6f4; color: #1f2a2a; margin: 0;
         display: grid; place-items: center; min-height: 100vh; }
  .card { background: #fff; border: 1px solid #dde3dd; border-radius: 10px; padding: 2rem;
          width: min(92vw, 24rem); box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  p  { font-size: .9rem; color: #5a6a68; margin: .25rem 0 1rem; }
  label { display: block; font-size: .8rem; font-weight: 600; margin: .75rem 0 .25rem; }
  input { width: 100%; box-sizing: border-box; padding: .55rem .7rem; border: 1px solid #c9d2c9;
          border-radius: 6px; font-size: .95rem; }
  button { width: 100%; margin-top: 1rem; padding: .6rem; border: 0; border-radius: 6px;
           font-size: .95rem; font-weight: 600; cursor: pointer; }
  .primary { background: #177245; color: #fff; }
  .secondary { background: #eef1ee; color: #1f2a2a; margin-top: .5rem; }
  .err { color: #a33; font-size: .85rem; margin-top: .75rem; min-height: 1.2em; }
  .google { display: flex; align-items: center; justify-content: center; gap: .5rem;
            background: #fff; color: #1f2a2a; border: 1px solid #c9d2c9; margin-top: 1rem; }
  .or { display: flex; align-items: center; gap: .6rem; margin: 1rem 0 .25rem; color: #8a9a98; font-size: .8rem; }
  .or::before, .or::after { content: ""; flex: 1; height: 1px; background: #dde3dd; }
  .hidden { display: none; }
  .app { font-weight: 700; }
</style>
</head>
<body>
<div class="card">
  <div id="login">
    <h1>Connexion</h1>
    <p>Connectez-vous avec le compte qui vous a été attribué. <br><small>Sign in with your assigned account.</small></p>
    <div id="google-block"${showGoogle ? "" : ' class="hidden"'}>
      <button class="google" id="google">
        <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="#4285F4" d="M17.6 9.2c0-.6-.05-1.2-.16-1.7H9v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z"/><path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3z"/><path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6z"/></svg>
        Continuer avec Google
      </button>
      <div class="or"><span>ou</span></div>
    </div>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username">
    <label for="password">Mot de passe</label>
    <input id="password" type="password" autocomplete="current-password">
    <button class="primary" id="signin">Se connecter</button>
    <div class="err" id="login-err"></div>
  </div>
  <div id="consent" class="hidden">
    <h1>Autoriser l'accès&nbsp;?</h1>
    <p><span class="app" id="app-name">Une application</span> demande l'accès à votre compte MOHEBS TLM.</p>
    <button class="primary" id="approve">Autoriser</button>
    <button class="secondary" id="deny">Refuser</button>
    <div class="err" id="consent-err"></div>
  </div>
</div>
<script type="module">
  import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
  const supabase = createClient(${JSON.stringify(supabaseUrl)}, ${JSON.stringify(anonKey)});
  const qs = new URLSearchParams(location.search);
  const authorizationId = qs.get("authorization_id");
  const el = (id) => document.getElementById(id);
  const show = (id) => { el("login").classList.add("hidden"); el("consent").classList.add("hidden"); el(id).classList.remove("hidden"); };
  const follow = (data) => { const to = data?.redirect_to ?? data?.redirectTo; if (to) location.assign(to); };

  async function toConsent() {
    if (!authorizationId) { el("consent-err").textContent = "Lien invalide: authorization_id manquant."; show("consent"); return; }
    try {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (error) throw error;
      el("app-name").textContent = data?.client?.client_name ?? data?.client_name ?? "Une application";
      show("consent");
    } catch (e) { el("consent-err").textContent = e.message ?? String(e); show("consent"); }
  }

  el("signin").addEventListener("click", async () => {
    el("login-err").textContent = "";
    const { error } = await supabase.auth.signInWithPassword({ email: el("email").value.trim(), password: el("password").value });
    if (error) { el("login-err").textContent = "Échec de la connexion : " + error.message; return; }
    await toConsent();
  });
  el("password").addEventListener("keydown", (e) => { if (e.key === "Enter") el("signin").click(); });

  el("google").addEventListener("click", async () => {
    el("login-err").textContent = "";
    // Rebuilt rather than reusing location.href: a previous attempt can leave a
    // spent ?code= in the URL, and only authorization_id may survive the trip.
    const returnUrl = location.origin + location.pathname
      + (authorizationId ? "?authorization_id=" + encodeURIComponent(authorizationId) : "");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl } });
    // Success navigates away to Google; only a failure gets this far.
    if (error) el("login-err").textContent = "Échec de la connexion : " + error.message;
  });

  el("approve").addEventListener("click", async () => {
    try {
      const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);
      if (error) throw error;
      follow(data);
    } catch (e) { el("consent-err").textContent = e.message ?? String(e); }
  });
  el("deny").addEventListener("click", async () => {
    try {
      const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId);
      if (error) throw error;
      follow(data);
    } catch (e) { el("consent-err").textContent = e.message ?? String(e); }
  });

  // Also the landing point for the Google round trip: supabase-js has already
  // turned the ?code= it came back with into a session by the time this runs.
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await toConsent();
</script>
</body>
</html>`;
}
