import { useState } from "react";
import { makeT } from "../i18n";
import type { Lang } from "../types";

type Props = {
  lang: Lang;
  onSubmit: (email: string, password: string) => Promise<string | null>;
  // Absent when the Supabase project has no Google provider configured, in
  // which case no button is drawn.
  onGoogle?: () => Promise<string | null>;
};

// Login gate shown when the server reports authRequired and there is no live
// Supabase session. Two ways in: Google (IDinsight staff, who also auto-join by
// email domain) and email+password (invited experts). On success the parent
// resumes the boot flow.
export function LoginGate({ lang, onSubmit, onGoogle }: Props) {
  const t = makeT(lang);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const attempt = async () => {
    setError("");
    setBusy(true);
    const err = await onSubmit(email, password);
    setBusy(false);
    if (err) setError(err);
  };

  // Google navigates the page away, so `busy` stays set: there is nothing to
  // come back to unless the hand-off itself failed.
  const attemptGoogle = async () => {
    if (!onGoogle) return;
    setError("");
    setBusy(true);
    const err = await onGoogle();
    if (err) {
      setBusy(false);
      setError(err);
    }
  };

  return (
    <div className="grid min-h-[70vh] place-items-center p-5">
      <div className="w-[min(92vw,24rem)] rounded-xl border border-line bg-panel p-[26px]">
        <h2 className="text-base font-semibold">{t("loginTitle")}</h2>
        <p className="mb-3.5 mt-1 text-[12.5px] text-muted">
          {lang === "fr" ? "Connectez-vous pour continuer." : "Sign in to continue."}
        </p>

        {onGoogle && (
          <>
            <button
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-line bg-panel2 px-3 py-2.5 text-sm font-semibold text-txt disabled:opacity-60"
              onClick={() => void attemptGoogle()}
              disabled={busy}
            >
              <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
                <path fill="#4285F4" d="M17.6 9.2c0-.6-.05-1.2-.16-1.7H9v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z" />
                <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3z" />
                <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6z" />
              </svg>
              {lang === "fr" ? "Continuer avec Google" : "Continue with Google"}
            </button>
            <div className="my-3.5 flex items-center gap-2.5 text-[11px] text-muted before:h-px before:flex-1 before:bg-line before:content-[''] after:h-px after:flex-1 after:bg-line after:content-['']">
              {lang === "fr" ? "ou" : "or"}
            </div>
          </>
        )}

        <label className="mb-1.5 mt-3 block text-[11px] font-semibold text-muted">
          Email
        </label>
        <input
          type="email"
          autoComplete="username"
          className="w-full rounded-md border border-line bg-panel2 px-[11px] py-[9px] text-sm text-txt"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="mb-1.5 mt-3 block text-[11px] font-semibold text-muted">
          {lang === "fr" ? "Mot de passe" : "Password"}
        </label>
        <input
          type="password"
          autoComplete="current-password"
          className="w-full rounded-md border border-line bg-panel2 px-[11px] py-[9px] text-sm text-txt"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void attempt();
          }}
        />

        <button
          className="mt-4 w-full rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-[#08130e] disabled:opacity-60"
          onClick={() => void attempt()}
          disabled={busy}
        >
          {t("signin")}
        </button>
        <div className="mt-2.5 min-h-[1.2em] text-xs text-err">{error}</div>
      </div>
    </div>
  );
}
