import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/fsClient", () => ({ listDir: vi.fn() }));
import * as fsClient from "@/lib/fsClient";
import { findFileByName, searchFiles } from "@/lib/fileSearch";
import type { DirEntry } from "@/types/fs";

const mockedList = vi.mocked(fsClient.listDir);

function entry(name: string, path: string, is_dir: boolean): DirEntry {
  return { name, path, is_dir, size: 0, modified_ms: null };
}

/** Wire listDir to resolve against a fake { dirPath: entries } tree. */
function fakeTree(tree: Record<string, DirEntry[]>) {
  mockedList.mockImplementation(async (p: string) => tree[p] ?? []);
}

beforeEach(() => mockedList.mockReset());

describe("findFileByName", () => {
  it("finds a file nested in a subfolder", async () => {
    fakeTree({
      "/root": [entry("docs", "/root/docs", true), entry("README.md", "/root/README.md", false)],
      "/root/docs": [entry("PLAN.md", "/root/docs/PLAN.md", false)],
    });
    expect(await findFileByName("/root", "PLAN.md")).toBe("/root/docs/PLAN.md");
  });

  it("matches case-insensitively", async () => {
    fakeTree({ "/root": [entry("Plan.MD", "/root/Plan.MD", false)] });
    expect(await findFileByName("/root", "plan.md")).toBe("/root/Plan.MD");
  });

  it("returns the shallowest match (breadth-first)", async () => {
    fakeTree({
      "/root": [entry("a", "/root/a", true), entry("b", "/root/b", true)],
      "/root/a": [entry("deep", "/root/a/deep", true)],
      "/root/a/deep": [entry("X.md", "/root/a/deep/X.md", false)],
      "/root/b": [entry("X.md", "/root/b/X.md", false)],
    });
    expect(await findFileByName("/root", "X.md")).toBe("/root/b/X.md");
  });

  it("skips noise directories like node_modules", async () => {
    fakeTree({
      "/root": [entry("node_modules", "/root/node_modules", true)],
      "/root/node_modules": [entry("PLAN.md", "/root/node_modules/PLAN.md", false)],
    });
    expect(await findFileByName("/root", "PLAN.md")).toBeNull();
  });

  it("returns null when the file is absent", async () => {
    fakeTree({ "/root": [] });
    expect(await findFileByName("/root", "missing.md")).toBeNull();
  });

  it("respects maxDepth", async () => {
    fakeTree({
      "/root": [entry("a", "/root/a", true)],
      "/root/a": [entry("b", "/root/a/b", true)],
      "/root/a/b": [entry("deep.md", "/root/a/b/deep.md", false)],
    });
    expect(await findFileByName("/root", "deep.md", { maxDepth: 1 })).toBeNull();
    expect(await findFileByName("/root", "deep.md", { maxDepth: 5 })).toBe(
      "/root/a/b/deep.md"
    );
  });

  it("stops after maxDirs without throwing", async () => {
    // A root with many empty subdirs; target never appears.
    const subdirs = Array.from({ length: 50 }, (_, i) =>
      entry(`d${i}`, `/root/d${i}`, true)
    );
    const tree: Record<string, DirEntry[]> = { "/root": subdirs };
    for (const d of subdirs) tree[d.path] = [];
    fakeTree(tree);
    expect(await findFileByName("/root", "nope.md", { maxDirs: 5 })).toBeNull();
  });
});

describe("searchFiles", () => {
  it("finds a nested markdown file without relying on expanded tree state", async () => {
    fakeTree({
      "/root": [
        entry("frontend", "/root/frontend", true),
        entry("backend", "/root/backend", true),
      ],
      "/root/frontend": [entry("README.md", "/root/frontend/README.md", false)],
      "/root/backend": [
        entry("docs", "/root/backend/docs", true),
        entry("LEVER_ROADMAP.md", "/root/backend/LEVER_ROADMAP.md", false),
      ],
      "/root/backend/docs": [entry("notes.md", "/root/backend/docs/notes.md", false)],
    });

    const results = await searchFiles("/root", "lever_roadmap.md");

    expect(results[0]).toMatchObject({
      relativePath: "backend/LEVER_ROADMAP.md",
      parentRelativePath: "backend",
    });
    expect(results[0]?.entry.path).toBe("/root/backend/LEVER_ROADMAP.md");
  });

  it("ranks exact basename matches before path-only matches", async () => {
    fakeTree({
      "/root": [
        entry("docs", "/root/docs", true),
        entry("PLAN.md", "/root/PLAN.md", false),
      ],
      "/root/docs": [entry("not-plan.md", "/root/docs/not-plan.md", false)],
    });

    const results = await searchFiles("/root", "PLAN.md");

    expect(results.map((r) => r.relativePath)).toEqual([
      "PLAN.md",
      "docs/not-plan.md",
    ]);
  });

  it("matches separator-insensitive queries", async () => {
    fakeTree({
      "/root": [entry("LEVER_ROADMAP.md", "/root/LEVER_ROADMAP.md", false)],
    });

    const results = await searchFiles("/root", "lever roadmap");

    expect(results[0]?.entry.path).toBe("/root/LEVER_ROADMAP.md");
  });

  it("includes matching directories but does not descend into noise folders", async () => {
    fakeTree({
      "/root": [
        entry("docs", "/root/docs", true),
        entry("node_modules", "/root/node_modules", true),
      ],
      "/root/docs": [entry("guide.md", "/root/docs/guide.md", false)],
      "/root/node_modules": [entry("guide.md", "/root/node_modules/guide.md", false)],
    });

    const results = await searchFiles("/root", "docs");

    expect(results[0]?.relativePath).toBe("docs");
    expect(results.map((r) => r.relativePath)).toContain("docs/guide.md");
    expect(await searchFiles("/root", "guide.md")).toHaveLength(1);
  });

  it("honors maxResults after ranking", async () => {
    fakeTree({
      "/root": [
        entry("b.md", "/root/b.md", false),
        entry("a.md", "/root/a.md", false),
      ],
    });

    const results = await searchFiles("/root", ".md", { maxResults: 1 });

    expect(results.map((r) => r.relativePath)).toEqual(["a.md"]);
  });
});
