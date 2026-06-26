import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/fsClient", () => ({ listDir: vi.fn() }));
import * as fsClient from "@/lib/fsClient";
import { findFileByName } from "@/lib/fileSearch";
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
