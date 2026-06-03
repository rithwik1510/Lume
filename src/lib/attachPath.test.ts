// src/lib/attachPath.test.ts
import { describe, it, expect } from "vitest";
import {
  relativeUnder,
  quoteIfNeeded,
  formatAttachPath,
  LUME_FILE_MIME,
} from "@/lib/attachPath";

describe("relativeUnder", () => {
  it("returns a forward-slash relative path when file is under the folder", () => {
    expect(relativeUnder("C:\\proj\\src\\auth.ts", "C:\\proj")).toBe("src/auth.ts");
  });
  it("is case-insensitive on the folder prefix (Windows)", () => {
    expect(relativeUnder("C:\\Proj\\a.ts", "c:\\proj")).toBe("a.ts");
  });
  it("tolerates a trailing slash on the folder", () => {
    expect(relativeUnder("C:\\proj\\a.ts", "C:\\proj\\")).toBe("a.ts");
  });
  it("returns null when the file is not under the folder", () => {
    expect(relativeUnder("D:\\other\\a.ts", "C:\\proj")).toBeNull();
  });
  it("returns null when file equals folder", () => {
    expect(relativeUnder("C:\\proj", "C:\\proj")).toBeNull();
  });
});

describe("quoteIfNeeded", () => {
  it("quotes paths containing whitespace", () => {
    expect(quoteIfNeeded("C:\\my files\\a.ts")).toBe('"C:\\my files\\a.ts"');
  });
  it("leaves space-free paths untouched", () => {
    expect(quoteIfNeeded("src/a.ts")).toBe("src/a.ts");
  });
});

describe("formatAttachPath", () => {
  it("relativizes when under the session folder", () => {
    expect(formatAttachPath("C:\\proj\\src\\a.ts", "C:\\proj")).toBe("src/a.ts");
  });
  it("falls back to the absolute path when not under the folder", () => {
    expect(formatAttachPath("D:\\ext\\spec.md", "C:\\proj")).toBe("D:\\ext\\spec.md");
  });
  it("uses the absolute path when no session folder is known", () => {
    expect(formatAttachPath("D:\\ext\\spec.md", null)).toBe("D:\\ext\\spec.md");
  });
  it("quotes a relativized path that contains spaces", () => {
    expect(formatAttachPath("C:\\proj\\my dir\\a.ts", "C:\\proj")).toBe('"my dir/a.ts"');
  });
});

describe("LUME_FILE_MIME", () => {
  it("is a private vendor MIME type", () => {
    expect(LUME_FILE_MIME).toBe("application/x-lume-file");
  });
});
