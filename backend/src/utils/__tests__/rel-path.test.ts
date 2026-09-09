/*
 * assertSafeRelPath — the guard on every caller-supplied object path.
 *
 * Object keys are `<namespace prefix>/ + relPath` with no validation, so this is
 * the one place a `..` or an absolute path is refused before it becomes a key.
 * Defensive: on Cloud Storage `..` does not traverse (flat keys), but a clear
 * refusal beats a key that silently resolves to nothing, and it matters for any
 * path-based backend.
 */
import { describe, it, expect } from "vitest";
import { assertSafeRelPath, CodedError } from "../index.js";

const rejects = (relPath: string) => {
  try {
    assertSafeRelPath(relPath);
  } catch (e) {
    expect(e).toBeInstanceOf(CodedError);
    expect((e as CodedError).code).toBe("VALIDATION_ERROR");
    return;
  }
  throw new Error(`expected '${relPath}' to be rejected`);
};

describe("assertSafeRelPath", () => {
  it("accepts an ordinary namespace-relative path", () => {
    expect(() => assertSafeRelPath("chapitre_05/Manuel - Chapitre 5.docx")).not.toThrow();
    expect(() => assertSafeRelPath("media/lecon-22/photo.png")).not.toThrow();
    // A leading dot in a filename is fine; only a `..` SEGMENT is a climb.
    expect(() => assertSafeRelPath(".hidden/x.png")).not.toThrow();
  });

  it("rejects a path that climbs out with `..`", () => {
    rejects("../other/x.docx");
    rejects("a/../../b.docx");
    rejects("..");
  });

  it("rejects an absolute path and the empty string", () => {
    rejects("/etc/passwd");
    rejects("");
  });
});
