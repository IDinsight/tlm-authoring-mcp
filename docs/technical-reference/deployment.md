## Deployment & hosting

### Production deployment (current state)

The server is **live on Cloud Run**: project `senegal-ci-maths`, region `europe-west1`,
service `senegal-mohebs-tlm`, capped at one instance.

- **Users connect** via a Claude custom connector pointing at
  `https://senegal-mohebs-tlm-148764688487.europe-west1.run.app/mcp`. First use runs an
  OAuth login (Supabase project `senegal-tlm-auth`, IDinsight org) on a consent page this
  server hosts at `/oauth/consent`.
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
| `ALLOW_UNAUTHENTICATED` | `1` to run without auth — local testing only |

With auth on, unauthenticated calls get a 401 pointing at `/.well-known/oauth-protected-resource`,
which advertises the Supabase authorization server — MCP clients (e.g. Claude connectors)
discover the login flow from there. Every tool call is logged with the caller's identity.
`GET /health` is unauthenticated. (Use `/health`, not `/healthz`, for external checks — Google's Front End reserves the literal `/healthz` path and 404s it before the request reaches the container.)

#### Supabase project settings this server depends on

Three dashboard settings are load-bearing. The server probes
`/auth/v1/settings` once at startup and logs a warning about the third.

| Setting | Where | Why |
|---|---|---|
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

### Wiring into a host (e.g. Claude Desktop)

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
