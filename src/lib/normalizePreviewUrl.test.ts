import { describe, it, expect } from "vitest";
import { normalizePreviewUrl } from "@/lib/normalizePreviewUrl";

describe("normalizePreviewUrl", () => {
  it("returns null for empty / whitespace input", () => {
    expect(normalizePreviewUrl("")).toBeNull();
    expect(normalizePreviewUrl("   ")).toBeNull();
  });
  it("treats a bare port as localhost", () => {
    expect(normalizePreviewUrl("3000")).toBe("http://localhost:3000");
  });
  it("prefixes http:// onto localhost:port", () => {
    expect(normalizePreviewUrl("localhost:5173")).toBe("http://localhost:5173");
  });
  it("leaves an explicit http/https URL untouched", () => {
    expect(normalizePreviewUrl("http://localhost:8080/app")).toBe("http://localhost:8080/app");
    expect(normalizePreviewUrl("https://localhost:8443")).toBe("https://localhost:8443");
  });
  it("prefixes http:// onto an IP:port", () => {
    expect(normalizePreviewUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizePreviewUrl("  3000 ")).toBe("http://localhost:3000");
  });
  it("rejects javascript: scheme", () => {
    expect(normalizePreviewUrl("javascript:alert(1)")).toBeNull();
  });
  it("rejects file: scheme", () => {
    expect(normalizePreviewUrl("file:///c:/x")).toBeNull();
  });
});
