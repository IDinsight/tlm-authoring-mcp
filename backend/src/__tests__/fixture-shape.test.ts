/*
 * Do the committed fixtures still have the shape the suites were written for?
 *
 * This is the only test that asserts on the test DATA rather than on the code,
 * and it exists because the failure it catches is silent: refresh a fixture from
 * the live store and every other suite keeps passing while quietly standing on a
 * different curriculum. See fixture-shape.ts for what "shape" means and why it
 * is pinned rather than computed.
 *
 * Failing here is not a bug — it is the refresh working. Read the fixture diff,
 * confirm the structural change is one production actually made, then re-pin
 * with `npm run refresh:fixtures` (which rewrites SHAPE.json) or by hand.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixtureShape, shapeDeltas, formatDeltas, type FixtureShapeManifest } from "./fixture-shape.js";
import { fixtureContexts, subjectDir, KG_FIXTURE, SHAPE_MANIFEST } from "./fixtures.js";

const manifest: FixtureShapeManifest = JSON.parse(readFileSync(SHAPE_MANIFEST, "utf8"));
const contexts = fixtureContexts();
const key = (c: { workspace: string; grade: string; subject: string }) => `${c.workspace}/${c.grade}/${c.subject}`;

describe("the committed fixtures still have the shape the suites assume", () => {
  // A fixture nobody pinned is a fixture nobody reviewed: it would be seeded by
  // the harness and asserted against with no record of what it is supposed to
  // hold. Catch it at the roster level, before the per-context checks.
  it("pins every fixture context, and pins no context that is gone", () => {
    expect(contexts.map(key).sort()).toEqual(Object.keys(manifest.contexts).sort());
  });

  for (const context of contexts) {
    it(`${key(context)} matches its pinned shape`, () => {
      const envelope = JSON.parse(readFileSync(resolve(subjectDir(context.workspace, context.grade, context.subject), KG_FIXTURE), "utf8"));
      const pinned = manifest.contexts[key(context)];
      if (!pinned) return; // The roster test above owns this failure; don't report it twice.

      const deltas = shapeDeltas(pinned, fixtureShape(envelope));
      expect(
        deltas.length === 0,
        `${key(context)} drifted from test/fixtures/SHAPE.json:\n${formatDeltas(deltas)}\n\n` +
          `If this is a deliberate refresh, review the fixture diff and re-pin with \`npm run refresh:fixtures\`.`,
      ).toBe(true);
    });
  }
});
