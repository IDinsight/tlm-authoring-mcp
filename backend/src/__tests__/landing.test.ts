/*
 * The root landing page is one generated string with no server logic behind it.
 * What a typo would silently break is the part that matters: a sign-in Supabase
 * bounced to this service — token in the fragment — must be forwarded to the
 * explorer rather than dead-ending here.
 */
import { describe, it, expect } from "vitest";
import { landingPage } from "../landing.js";
import { explorerOrigins } from "../config.js";

const EXPLORER = "https://senegal-ci-maths.web.app";

describe("landingPage", () => {
  it("hands the explorer origin to the browser script and the manual link", () => {
    const html = landingPage(EXPLORER);
    expect(html).toContain(JSON.stringify(EXPLORER));
    expect(html).toContain(`href="${EXPLORER}"`);
  });

  it("forwards a stranded access token, fragment intact", () => {
    const html = landingPage(EXPLORER);
    expect(html).toContain('params.has("access_token")');
    expect(html).toContain("location.replace(target)");
    expect(html).toContain("location.hash");
  });

  it("reports a failed sign-in in place instead of forwarding the error", () => {
    const html = landingPage(EXPLORER);
    expect(html).toContain('params.has("error")');
    expect(html).toContain('show("failed")');
  });

  it("otherwise says what the service is — it is the MCP connector URL", () => {
    const html = landingPage(EXPLORER);
    expect(html).toContain("connecteur");
    expect(html).toContain("MCP");
  });
});

describe("explorerOrigins", () => {
  it("defaults to the Firebase Hosting origins, explorer first", () => {
    delete process.env.KG_ALLOWED_ORIGINS;
    expect(explorerOrigins()[0]).toBe(EXPLORER);
  });

  it("is overridable per deployment, trailing slashes trimmed", () => {
    process.env.KG_ALLOWED_ORIGINS = " https://a.example/ ,https://b.example ";
    expect(explorerOrigins()).toEqual(["https://a.example", "https://b.example"]);
    delete process.env.KG_ALLOWED_ORIGINS;
  });
});
