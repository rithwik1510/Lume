import { describe, expect, it } from "vitest";
import { findMdLinks, resolveMdPath } from "@/terminals/mdLinkProvider";

describe("findMdLinks", () => {
  it("finds a relative .md path in a line", () => {
    const line = "see ./docs/plan.md for details";
    const matches = findMdLinks(line);
    expect(matches.length).toBe(1);
    expect(matches[0].text).toBe("./docs/plan.md");
    expect(matches[0].start).toBe(4);
    expect(matches[0].end).toBe(18);
  });

  it("finds a windows absolute .md path", () => {
    const line = 'open "C:\\Users\\posan\\notes.md" now';
    const matches = findMdLinks(line);
    expect(matches.length).toBe(1);
    expect(matches[0].text).toBe("C:\\Users\\posan\\notes.md");
  });

  it("finds multiple matches", () => {
    const line = "a.md and ./b.md";
    expect(findMdLinks(line).length).toBe(2);
  });

  it("ignores non-md paths", () => {
    expect(findMdLinks("./foo.txt").length).toBe(0);
  });
});

describe("resolveMdPath", () => {
  it("returns absolute path unchanged", () => {
    expect(resolveMdPath("C:\\x\\y.md", "C:\\cwd")).toBe("C:\\x\\y.md");
  });

  it("joins relative path with cwd using OS separator on Windows", () => {
    // resolveMdPath uses simple string join — the Rust side canonicalises.
    expect(resolveMdPath("./a.md", "C:\\cwd")).toBe("C:\\cwd/./a.md");
  });

  it("returns null when cwd is null", () => {
    expect(resolveMdPath("./a.md", null)).toBeNull();
  });
});
