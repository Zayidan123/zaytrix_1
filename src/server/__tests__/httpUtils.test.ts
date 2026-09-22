import { describe, it, expect } from "vitest";

import { sanitizeHeaderValue } from "../httpUtils";

describe("sanitizeHeaderValue", () => {
  it("strips CR and LF characters to prevent header injection", () => {
    const malicious = "X-Injected\r\nX-Injected2\r\n";
    const clean = sanitizeHeaderValue(malicious);
    expect(clean).toBe("X-InjectedX-Injected2");
  });

  it("leaves safe strings unchanged", () => {
    const safe = "Bearer abc123";
    expect(sanitizeHeaderValue(safe)).toBe(safe);
  });
});
