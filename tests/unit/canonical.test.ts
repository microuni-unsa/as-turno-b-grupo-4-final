import { hashCanonicalContent } from "@pims/notices";
import { CanonicalizationError, canonicalizeJson } from "@pims/types";
import { describe, expect, it } from "vitest";

describe("Canonical JSON (single implementation)", () => {
  it("is independent of object key order", () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalizeJson({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    expect(canonicalizeJson({ z: { y: 2, x: 1 }, a: [3, 2, 1] })).toBe(
      '{"a":[3,2,1],"z":{"x":1,"y":2}}',
    );
  });

  it("preserves array order", () => {
    expect(canonicalizeJson([1, 2, 3])).not.toBe(canonicalizeJson([3, 2, 1]));
  });

  it("rejects non-JSON values instead of emitting invalid JSON", () => {
    for (const value of [
      { a: undefined },
      { a: new Date("2026-10-30T12:00:00.000Z") },
      { a: Number.NaN },
      { a: Number.POSITIVE_INFINITY },
      { a: 1n },
    ]) {
      expect(() => canonicalizeJson(value)).toThrow(CanonicalizationError);
    }
  });

  it("reports structured validation issues for non-JSON values", () => {
    try {
      canonicalizeJson({ outer: { inner: undefined } });
      expect.unreachable("Should have thrown CanonicalizationError");
    } catch (err) {
      expect(err).toBeInstanceOf(CanonicalizationError);
      const error = err as CanonicalizationError;
      expect(error.code).toBe("CANONICALIZATION_ERROR");
      const issues = error.details?.issues;
      expect(Array.isArray(issues)).toBe(true);
      expect(issues).not.toHaveLength(0);
    }
  });

  it("strips only top-level envelope keys when hashing notice content", () => {
    const withNestedEnvelope = {
      incident_code: "INC-2026-001",
      state: "draft",
      nested: { state: "sent", review_approval_id: "kept" },
    };

    const withoutTopLevelKeys = {
      incident_code: "INC-2026-001",
      nested: { state: "sent", review_approval_id: "kept" },
    };

    expect(hashCanonicalContent(withNestedEnvelope)).toBe(
      hashCanonicalContent(withoutTopLevelKeys),
    );

    const alteredNested = {
      incident_code: "INC-2026-001",
      nested: { state: "approved", review_approval_id: "kept" },
    };
    expect(hashCanonicalContent(withNestedEnvelope)).not.toBe(
      hashCanonicalContent(alteredNested),
    );
  });

  it("rejects non-JSON notice packs", () => {
    expect(() => hashCanonicalContent({ state: undefined })).toThrow(
      CanonicalizationError,
    );
  });
});
