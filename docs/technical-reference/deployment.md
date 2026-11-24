## Deployment & hosting

### Production deployment (current state)

The server is **live on Cloud Run**: project `senegal-ci-maths`, region `europe-west1`,
service `senegal-mohebs-tlm`, capped at one instance.

- **Users connect** from any MCP client — Claude, Codex, ChatGPT, Gemini — by giving it one
  address, `https://senegal-mohebs-tlm-148764688487.europe-west1.run.app/mcp`, or by
  installing the plugin, which carries that address. First use runs an OAuth login (Supabase
  project `senegal-tlm-auth`, IDinsight org) on a consent page this server hosts at
  `/oauth/consent`. See [What a client needs from the server](#what-a-client-needs-from-the-server).
- **Accounts.** IDinsight colleagues sign in with Google and get their role from a
  workspace **domain rule**; anyone else is given access with `invite_member`, keyed by
  their email, and claims it on first login. Neither needs a dashboard visit. Creating a
  user by hand (Authentication → Users → *Create new user*) still works for a password
  account. Supabase's own invite-email flow is **not** used — its link expects a
  password-setup page that hasn't been built. See
  [`member-onboarding.md`](../design-notes/member-onboarding.md).
- **A user's grade/subject selection is sticky per person** (persisted at
  `_state/<user-id>.json` in the bucket) because web clients open a fresh MCP session per
  tool call.
- **Merging to `main` does NOT deploy.** CI builds and tests only. A deploy rolls the single
  Cloud Run instance and drops in-memory MCP sessions, so it is triggered **on demand from
  GitHub Actions** — the "Deploy to Cloud Run" workflow (`.github/workflows/deploy.yml`): the
  **Run workflow** button, or pushing a `v*` git tag. It builds from the checked-out repo
  (source `backend/`) and authenticates with no JSON key via Workload Identity Federation.
  Existing env vars and public-access settings are preserved. A laptop `gcloud run deploy
  --source backend` still works as a fallback. Full runbook incl. WIF setup, first-time setup,
  Supabase dashboard config, and post-deploy smoke checks: [`DEPLOY.md`](../../DEPLOY.md).

### Remote (HTTP) mode — central hosting

`npm run start:http` starts a Streamable HTTP server (for e.g. Cloud Run) instead of stdio.
Each MCP session gets its own active context and caches, so concurrent users can work on
different grades/subjects without interfering. Stdio mode (`npm start`) is unchanged.

| Env | Meaning |
|---|---|
| `PORT` | Listen port (default 8080) |
| `PUBLIC_URL` | This server's public base URL (required when auth is on) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` — enables OAuth (Supabase Auth is the authorization server; this server only validates its JWTs) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Optional, sensitive.** Enables `list_unaffiliated_users` only. See the warning below |
| `ALLOW_UNAUTHENTICATED` | `1` to run without auth — local testing only |

> **`SUPABASE_SERVICE_ROLE_KEY` is not like the others.** It bypasses row-level security
> and can mint tokens and delete users — it is the Supabase equivalent of root. The server
> reads it in exactly one place (`src/identity/supabase.ts`) for one read-only call, listing
> accounts so `list_unaffiliated_users` can find people who signed in and got no role. Leave
> it unset and that one tool reports itself unavailable; nothing else changes. If you do set
> it, set it as a **secret** (`--set-secrets`), not a plain env var, and rotate it if the
> service's env is ever exposed. It is never logged and never returned to a caller.

With auth on, unauthenticated calls get a 401 pointing at
`/.well-known/oauth-protected-resource/mcp`, which advertises the Supabase authorization
server — an MCP client discovers the login flow from there (next section). Every tool call is
logged with the caller's identity.
`GET /health` is unauthenticated. (Use `/health`, not `/healthz`, for external checks — Google's Front End reserves the literal `/healthz` path and 404s it before the request reaches the container.)

#### What a client needs from the server

Nothing here is specific to one vendor: a client is given the `/mcp` address and finds the
rest by itself, in four steps. Each step is something this deployment has to keep serving,
and a client that fails to sign in is failing at one of them.

| Step | What the client does | What must be true here |
|---|---|---|
| 1 | Calls `/mcp` with no token | The 401 carries `WWW-Authenticate: … resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp"` |
| 2 | Reads that address | Its `resource` is **exactly** the address the client connected to, `<PUBLIC_URL>/mcp`, and `authorization_servers` names `<SUPABASE_URL>/auth/v1` |
| 3 | Reads the authorization server's own metadata | Supabase lists a `registration_endpoint` — that is the **Dynamic OAuth Apps** switch in the dashboard. A client registers itself there; no client id is handed out by us |
| 4 | Sends the user to sign in | Supabase delegates the page to `<PUBLIC_URL>/oauth/consent`, which this server hosts |

Step 2 is the one that bit: until 2026-11-24 `resource` named the bare host, which RFC 9728
§7.3 forbids. Claude does not check it; Gemini CLI does, and refused to sign in. `PUBLIC_URL`
must therefore be the service's base address **with no path** — the server appends `/mcp`
itself (and drops a trailing slash).

Which clients have been through it:

| Client | State |
|---|---|
| Claude (Cowork, Claude Code, claude.ai) | in daily use |
| Codex | plugin install and sign-in checked 2026-11-24 (codex-cli 0.172); no model has called a tool through it yet |
| Gemini CLI | step 2 fixed and live; a full sign-in has not been re-run since |
| Antigravity | plugin manifest built from its documentation, not yet installed on a real copy |
| ChatGPT (custom MCP server, web, Business / Enterprise / Edu) | not yet run by us. What its documentation asks of a server is met on paper: PKCE `S256` advertised, self-registration, refresh tokens. One gap is known — see below |
| Gemini app (custom app) | not yet run by us. Google's documentation asks for a registration endpoint, which is there |

**The known gap: no tool says it only reads.** MCP lets a tool declare `readOnlyHint`. The
server declares it on none of its 74 tools. Claude works without it. ChatGPT does not: its
documentation says a tool without the hint is treated as a write, and writes
ask for confirmation by default. So in ChatGPT every call — `start_here`, `find_node`, a walk —
would stop for a click, and a ChatGPT Pro account, which may only *read* through a custom
server, could call nothing. Declaring the hint on the read tools is a small server change, not
yet made.

**Helper agents are the plugin's, not the server's.** The plugin's skills hand long reads to
sub-agents, which only Cowork and Claude Code run. A tool that runs none does the same work in
the main thread, and the skills say so ([`plugin/README.md`](../../plugin/README.md)).

The server asks nothing of a client beyond tools: it opens no elicitation dialog and needs
no completions, and its four prompts are a convenience, not a dependency.

#### Supabase project settings this server depends on

Four dashboard settings are load-bearing. The server probes
`/auth/v1/settings` once at startup and logs a warning about the last.

| Setting | Where | Why |
|---|---|---|
| **OAuth Server** on, with **Dynamic OAuth Apps** | Authentication → OAuth Server | What lets a client that has never seen this server register itself and sign a user in (step 3 above). With it off, only a client whose id was created by hand in the dashboard can connect. |
| **Google provider** enabled | Authentication → Providers → Google | Turns on the "Continuer avec Google" button (the consent page and the explorer both hide it when the provider is off) and is what makes **domain auto-join** possible — a rule only admits sign-ins from a provider that vouches for the address. Needs a Google Cloud OAuth client, with `https://<ref>.supabase.co/auth/v1/callback` as an authorized redirect URI. |
| **Redirect URLs** allow-listed | Authentication → URL Configuration | The Google round trip returns to `<PUBLIC_URL>/oauth/consent` and to the explorer's origin. Both must be listed or the login bounces. |
| **Confirm email** ON | Authentication → Providers → Email | An invite is claimable by whoever holds a token for that address. With confirmations off, someone can sign up *as* an invited colleague and take their invite. The server logs a loud `WARNING` at boot if it detects auto-confirm. |

#### Per-request actor identity

Every MCP request is bound to a request-scoped `Actor` derived **only** from the
verified Supabase JWT (`sub`, `email`, `iss`) — see [`src/actor.ts`](../../backend/src/actor.ts).
Tool handlers read the caller via `currentActor()` (nested inside the existing
`runInSession` context); tool arguments, request bodies, and client-settable
headers are never trusted for identity. Each non-GET request emits one
structured JSON audit line to stderr — `{ actor, tool, grade, subject, … }` —
as the seed for the audit store planned in a later phase.

**Defaulted decision — unknown-actor policy.** With `SUPABASE_URL` set the
bearer middleware 401s any unverified caller before we resolve an actor, so
`actor.unknown` is only reachable via `ALLOW_UNAUTHENTICATED=1` (local
testing). In that mode, unknown actors currently proceed since no roles are
enforced yet. Flip this by editing the `unknown-actor policy` block in
[`src/http.ts`](../../backend/src/http.ts) — it is the one place to change.

### Wiring the stdio server into a host

For local development only: this runs the server as a child process of the host, with
Firebase credentials on the developer's machine and no sign-in. The block below is the
`mcpServers` shape Claude Desktop, Claude Code and Gemini CLI share; Codex takes the same
command and environment as `codex mcp add <name> --env KEY=VALUE -- node /absolute/path/to/dist/index.js`.

```jsonc
{
  "mcpServers": {
    "senegal-mohebs-tlm": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "SERVICE_ACCOUNT_KEY_PATH": "/absolute/path/to/serviceAccount.json",
        "FIREBASE_STORAGE_BUCKET": "your-project.appspot.com",
        "TLM_GRADE": "ci",
        "TLM_SUBJECT": "maths"
      }
    }
  }
}
```

`TLM_GRADE`/`TLM_SUBJECT` are optional — omit them and the agent picks a pair with `set_context` at the start of a session.
