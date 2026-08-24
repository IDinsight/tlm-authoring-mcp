/*
 * The OAuth consent page is one generated string with no server logic behind
 * it, so these assert the few things a typo would silently break: the project
 * credentials reach the page, and the Google button is only offered when the
 * provider is actually enabled.
 */
import { describe, it, expect } from "vitest";
import { consentPage } from "../consent.js";

const PROJECT = "https://abc.supabase.co";
const ANON_KEY = "anon-key-123";

describe("consentPage", () => {
  it("passes the project url + anon key to the browser client", () => {
    const html = consentPage(PROJECT, ANON_KEY);
    expect(html).toContain(JSON.stringify(PROJECT));
    expect(html).toContain(JSON.stringify(ANON_KEY));
  });

  it("offers Google by default", () => {
    const html = consentPage(PROJECT, ANON_KEY);
    expect(html).toContain('id="google-block"');
    expect(html).not.toContain('id="google-block" class="hidden"');
  });

  it("hides the Google button when the project has the provider switched off", () => {
    const html = consentPage(PROJECT, ANON_KEY, false);
    expect(html).toContain('id="google-block" class="hidden"');
  });

  it("keeps the password form either way — the experts sign in with one", () => {
    const html = consentPage(PROJECT, ANON_KEY, false);
    expect(html).toContain('id="password"');
    expect(html).toContain("signInWithPassword");
  });

  it("sends the authorization_id back through the Google round trip", () => {
    const html = consentPage(PROJECT, ANON_KEY);
    expect(html).toContain("signInWithOAuth");
    expect(html).toContain("authorization_id=");
  });
});
