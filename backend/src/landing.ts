/*
 * Layer: app · root landing page
 *
 * What `GET /` answers. The service is an MCP server plus the `/kg` read API —
 * neither is meant to be browsed — so the root used to be Express's bare
 * "Cannot GET /".
 *
 * That mattered because it is where a broken sign-in lands. Both login flows
 * (the explorer's Google button, and the /oauth/consent page Claude sends you
 * to when adding the connector) hand Supabase a `redirectTo`; when that URL is
 * not on the project's Redirect URLs allow-list, Supabase silently falls back
 * to the project's **Site URL** — this service's root — with the freshly minted
 * token in the fragment. The sign-in worked; only the landing spot was wrong,
 * and the user saw a dead end.
 *
 * So this page does two jobs: it forwards a stranded token to the explorer
 * (the fragment never reaches the server, so the hand-off has to happen in the
 * browser), and it tells anyone else who opens the URL what the service is.
 * It is a fallback, not the fix — see DEPLOY.md's Supabase section.
 */
export function landingPage(explorerUrl: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MOHEBS TLM</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f6f4; color: #1f2a2a; margin: 0;
         display: grid; place-items: center; min-height: 100vh; }
  .card { background: #fff; border: 1px solid #dde3dd; border-radius: 10px; padding: 2rem;
          width: min(92vw, 30rem); box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  h1 { font-size: 1.15rem; margin: 0 0 .5rem; }
  p  { font-size: .9rem; color: #5a6a68; margin: .5rem 0; line-height: 1.5; }
  a  { color: #177245; }
  small { color: #8a9a98; }
  .err { color: #a33; }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="card">
  <div id="info">
    <h1>MOHEBS TLM — serveur</h1>
    <p>Cette adresse est le <strong>serveur MCP</strong> : elle s'ajoute comme connecteur dans
       Claude, elle ne se consulte pas dans un navigateur.</p>
    <p>Pour parcourir les graphes de connaissances, ouvrez
       <a id="explorer-link" href="${explorerUrl}">l'explorateur</a>.</p>
    <p><small>This address is the MCP server — add it as a connector in Claude. To browse the
       knowledge graphs, open the explorer.</small></p>
  </div>
  <div id="forwarding" class="hidden">
    <h1>Connexion réussie</h1>
    <p>Redirection vers l'explorateur…
       <a id="forward-link" href="${explorerUrl}">Continuer</a> si rien ne se passe.</p>
    <p><small>Signed in — forwarding you to the explorer.</small></p>
  </div>
  <div id="failed" class="hidden">
    <h1>Échec de la connexion</h1>
    <p class="err" id="failed-msg"></p>
    <p>Réessayez depuis <a href="${explorerUrl}">l'explorateur</a>, ou depuis Claude si vous
       ajoutiez le connecteur.</p>
    <p><small>Sign-in failed. Retry from the explorer, or from Claude if you were adding the
       connector.</small></p>
  </div>
</div>
<script type="module">
  const EXPLORER = ${JSON.stringify(explorerUrl)};
  const show = (id) => document.getElementById(id).classList.remove("hidden");
  const hide = (id) => document.getElementById(id).classList.add("hidden");

  // Supabase returns the implicit-flow result in the FRAGMENT, which no server
  // ever sees — so read it here. A token means the login succeeded and only its
  // destination was wrong: carry it, unread, to the explorer, which turns it
  // into a session. An error is reported in place rather than forwarded.
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("access_token")) {
    hide("info");
    show("forwarding");
    const target = EXPLORER.replace(/\\/+$/, "") + "/" + location.hash;
    document.getElementById("forward-link").href = target;
    location.replace(target);
  } else if (params.has("error") || params.has("error_description")) {
    hide("info");
    document.getElementById("failed-msg").textContent =
      params.get("error_description") || params.get("error") || "";
    show("failed");
  }
</script>
</body>
</html>`;
}
