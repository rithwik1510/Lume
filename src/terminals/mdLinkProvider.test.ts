import { describe, expect, it } from "vitest";
import {
  findMdLinks,
  resolveMdPath,
  shouldActivateMdLink,
  mdLinkCandidates,
} from "@/terminals/mdLinkProvider";

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

  it("returns UNC paths unchanged", () => {
    expect(resolveMdPath("\\\\server\\share\\notes.md", "C:\\cwd")).toBe(
      "\\\\server\\share\\notes.md"
    );
  });

  it("joins relative path with cwd using OS separator on Windows", () => {
    // resolveMdPath uses simple string join — the Rust side canonicalises.
    expect(resolveMdPath("./a.md", "C:\\cwd")).toBe("C:\\cwd/./a.md");
  });

  it("returns null when cwd is null", () => {
    expect(resolveMdPath("./a.md", null)).toBeNull();
  });
});

describe("shouldActivateMdLink", () => {
  const plain = { ctrlKey: false, metaKey: false };
  const ctrl = { ctrlKey: true, metaKey: false };
  const meta = { ctrlKey: false, metaKey: true };

  it("follows a plain click in a bare shell (no mouse capture)", () => {
    expect(shouldActivateMdLink("none", plain)).toBe(true);
  });

  it("requires Ctrl when a TUI owns the mouse", () => {
    // Claude Code / vim style mouse-reporting modes.
    for (const mode of ["x10", "vt200", "drag", "any"] as const) {
      expect(shouldActivateMdLink(mode, plain)).toBe(false);
      expect(shouldActivateMdLink(mode, ctrl)).toBe(true);
      expect(shouldActivateMdLink(mode, meta)).toBe(true);
    }
  });

  it("still follows Ctrl+Click in a bare shell", () => {
    expect(shouldActivateMdLink("none", ctrl)).toBe(true);
  });
});

describe("mdLinkCandidates", () => {
  it("returns an absolute path as the sole candidate", () => {
    expect(mdLinkCandidates("C:\\x\\y.md", "C:\\cwd", "C:\\folder")).toEqual([
      "C:\\x\\y.md",
    ]);
  });

  it("returns a UNC path as the sole candidate", () => {
    expect(mdLinkCandidates("\\\\server\\share\\notes.md", "C:\\cwd", "C:\\folder")).toEqual([
      "\\\\server\\share\\notes.md",
    ]);
  });

  it("resolves a relative path against cwd then session folder", () => {
    expect(mdLinkCandidates("docs/a.md", "C:\\cwd", "C:\\folder")).toEqual([
      "C:\\cwd/docs/a.md",
      "C:\\folder/docs/a.md",
    ]);
  });

  it("dedupes when cwd and folder are identical", () => {
    expect(mdLinkCandidates("a.md", "C:\\same", "C:\\same")).toEqual([
      "C:\\same/a.md",
    ]);
  });

  it("skips null bases", () => {
    expect(mdLinkCandidates("a.md", null, "C:\\folder")).toEqual([
      "C:\\folder/a.md",
    ]);
    expect(mdLinkCandidates("a.md", null, null)).toEqual([]);
  });
});
