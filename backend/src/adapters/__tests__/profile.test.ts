/*
 * SubjectProfile schema + generic builder.
 *
 * Phase 2 of the authorable catalog moves each subject from a hand-written
 * behavior module to a declarative profile read by one generic builder. That
 * trade only holds if a malformed profile fails LOUDLY at the boundary (the
 * design note's "runtime vs compile-time validation" risk) — so these tests pin
 * the guard, plus the synthesized bit a reviewer can't see by eye: the
 * capability-gated domain-rotation helpers.
 */
import { describe, it, expect } from "vitest";
import { validateProfile } from "../profile.js";
import { buildAdapterFromProfile } from "../build.js";
import { CI_MATHS_PROFILE } from "../profiles/senegal/ci-maths.js";
import { CE1_READING_PROFILE } from "../profiles/senegal/ce1-reading.js";
import { NIGERIA_MATHS_PROFILE } from "../profiles/nigeria/primary-1-3-maths.js";

describe("SubjectProfile validation", () => {
  it("accepts every shipped profile", () => {
    for (const p of [CI_MATHS_PROFILE, CE1_READING_PROFILE, NIGERIA_MATHS_PROFILE]) {
      expect(() => validateProfile(p)).not.toThrow();
    }
  });

  it("rejects an out-of-range numberFrom", () => {
    const bad = { ...CI_MATHS_PROFILE, parse: { ...CI_MATHS_PROFILE.parse, numberFrom: "ordinal" } };
    expect(() => validateProfile(bad)).toThrow(/numberFrom/);
  });

  it("rejects unknown top-level keys (strict) so a typo can't silently no-op", () => {
    const bad = { ...CI_MATHS_PROFILE, capabilties: {} }; // misspelled
    expect(() => validateProfile(bad)).toThrow();
  });
});

describe("buildAdapterFromProfile — synthesized behavior", () => {
  it("builds the same adapter shape for every subject", () => {
    // The last subject-CONDITIONAL surface (the capability-gated domain helpers)
    // was retired with the CI-maths tools, so two unrelated subjects must now
    // differ only in the data their profile supplies.
    const maths = buildAdapterFromProfile(CI_MATHS_PROFILE, "ci", "maths");
    const reading = buildAdapterFromProfile(CE1_READING_PROFILE, "ce1", "reading");
    expect(Object.keys(maths).sort()).toEqual(Object.keys(reading).sort());
    expect(maths.id).not.toBe(reading.id);
  });
});

describe("retired profile keys", () => {
  // Every profile cell published before this change still carries `capabilities`
  // (and the older ones `deliverables`). The schema is strict, so without the
  // strip shim those cells would fail validation and their namespace would
  // refuse to activate — a hard outage, not a degraded read.
  it("a live cell carrying capabilities/deliverables still validates", () => {
    const legacy = {
      ...CI_MATHS_PROFILE,
      capabilities: { exampleDomainRotation: true },
      deliverables: ["chapter"],
    };
    const parsed = validateProfile(legacy);
    expect(parsed.id).toBe(CI_MATHS_PROFILE.id);
    expect(parsed).not.toHaveProperty("capabilities");
    expect(parsed).not.toHaveProperty("deliverables");
  });
});
