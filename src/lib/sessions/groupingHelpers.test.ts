import { describe, it, expect } from "vitest";
import { basename, autoSuffixSessionName, samePath } from "@/lib/sessions/groupingHelpers";

describe("basename", () => {
  it("returns the last segment for posix paths", () => {
    expect(basename("/home/user/project")).toBe("project");
    expect(basename("/home/user/project/")).toBe("project");
  });
  it("returns the last segment for windows paths", () => {
    expect(basename("C:\\Users\\posan\\repo")).toBe("repo");
    expect(basename("C:\\Users\\posan\\repo\\")).toBe("repo");
  });
  it("returns empty string for empty input", () => {
    expect(basename("")).toBe("");
  });
});

describe("samePath", () => {
  it("compares posix paths exactly", () => {
    expect(samePath("/a/b", "/a/b")).toBe(true);
    expect(samePath("/a/b", "/a/c")).toBe(false);
  });
  it("compares windows paths case-insensitively", () => {
    expect(samePath("C:\\Users\\Posan", "c:\\users\\posan")).toBe(true);
  });
  it("normalises trailing slash", () => {
    expect(samePath("/a/b/", "/a/b")).toBe(true);
  });
});

describe("autoSuffixSessionName", () => {
  it("returns the desired name when no collision", () => {
    expect(autoSuffixSessionName("foo", ["bar", "baz"])).toBe("foo");
  });
  it("appends -2 on first collision", () => {
    expect(autoSuffixSessionName("foo", ["foo"])).toBe("foo-2");
  });
  it("walks the suffix until free", () => {
    expect(autoSuffixSessionName("foo", ["foo", "foo-2", "foo-3"])).toBe("foo-4");
  });
});
