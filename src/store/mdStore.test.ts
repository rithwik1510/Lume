// src/store/mdStore.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";

// The persist middleware loads from @tauri-apps/plugin-store on hydrate;
// mock it so the test runner doesn't try to call into Tauri at module load.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));

import { useMdStore } from "@/store/mdStore";
import { useToastStore } from "@/store/toastStore";

vi.mock("@/lib/fsClient", () => ({
  readTextFile: vi.fn(async (p: string) => `contents of ${p}`),
  writeTextFile: vi.fn(async () => undefined),
}));

// fileSearch is exercised in its own suite; here we stub it so the Quick Viewer
// fallback path is controllable without standing up a fake fs tree.
vi.mock("@/lib/fileSearch", () => ({ findFileByName: vi.fn(async () => null) }));

// Helper to get the mocked fsClient functions with correct types
import * as fsClient from "@/lib/fsClient";
import * as fileSearch from "@/lib/fileSearch";
const mockedRead = vi.mocked(fsClient.readTextFile);
const mockedWrite = vi.mocked(fsClient.writeTextFile);
const mockedFind = vi.mocked(fileSearch.findFileByName);

describe("mdStore — Quick Viewer", () => {
  beforeEach(() => {
    useMdStore.getState().reset();
    useToastStore.getState().reset();
    mockedRead.mockImplementation(async (p: string) => `contents of ${p}`);
    mockedFind.mockResolvedValue(null);
  });

  it("starts with quick viewer closed", () => {
    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(false);
    expect(s.quickViewer.path).toBeNull();
  });

  it("openMdInQuickViewer loads file contents", async () => {
    await useMdStore.getState().openMdInQuickViewer("/tmp/x.md");
    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(true);
    expect(s.quickViewer.path).toBe("/tmp/x.md");
    expect(s.quickViewer.content).toBe("contents of /tmp/x.md");
  });

  it("closeQuickViewer resets state", async () => {
    await useMdStore.getState().openMdInQuickViewer("/tmp/x.md");
    useMdStore.getState().closeQuickViewer();
    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(false);
    expect(s.quickViewer.path).toBeNull();
    expect(s.quickViewer.content).toBe("");
  });

  it("openMdInQuickViewer last-call-wins when two reads resolve out of order", async () => {
    // Deferred promise for the first read (file A), resolves after file B
    let resolveA!: (v: string) => void;
    const promiseA = new Promise<string>((res) => { resolveA = res; });

    mockedRead
      .mockImplementationOnce(() => promiseA)                         // call 1 → file A, delayed
      .mockImplementationOnce(async () => "contents of /tmp/b.md");  // call 2 → file B, instant

    // Start both opens; B finishes first because its read is synchronous
    const openA = useMdStore.getState().openMdInQuickViewer("/tmp/a.md");
    const openB = useMdStore.getState().openMdInQuickViewer("/tmp/b.md");

    // Let B complete
    await openB;
    expect(useMdStore.getState().quickViewer.path).toBe("/tmp/b.md");

    // Now resolve A's read — it should be ignored because B was newer
    resolveA("contents of /tmp/a.md");
    await openA;

    const s = useMdStore.getState();
    expect(s.quickViewer.path).toBe("/tmp/b.md");
    expect(s.quickViewer.content).toBe("contents of /tmp/b.md");
  });

  it("openMdLinkInQuickViewer falls through to the next candidate when the first read fails", async () => {
    mockedRead.mockImplementation(async (p: string) => {
      if (p === "C:\\cwd/a.md") throw new Error("ENOENT");
      return `contents of ${p}`;
    });

    await useMdStore
      .getState()
      .openMdLinkInQuickViewer(["C:\\cwd/a.md", "C:\\folder/a.md"], "a.md");

    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(true);
    expect(s.quickViewer.path).toBe("C:\\folder/a.md");
  });

  it("openMdLinkInQuickViewer toasts and stays closed when no candidate reads", async () => {
    mockedRead.mockImplementation(async () => {
      throw new Error("ENOENT");
    });

    await useMdStore
      .getState()
      .openMdLinkInQuickViewer(["C:\\cwd/missing.md"], "missing.md");

    expect(useMdStore.getState().quickViewer.open).toBe(false);
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].severity).toBe("warn");
    expect(toasts[0].message).toContain("missing.md");
  });

  it("searches the session folder for a bare filename when direct candidates miss", async () => {
    mockedRead.mockImplementation(async (p: string) => {
      if (p === "C:\\proj\\docs\\PLAN.md") return "found via search";
      throw new Error("ENOENT");
    });
    mockedFind.mockResolvedValue("C:\\proj\\docs\\PLAN.md");

    await useMdStore
      .getState()
      .openMdLinkInQuickViewer(["C:\\proj\\PLAN.md"], "PLAN.md", "C:\\proj");

    expect(mockedFind).toHaveBeenCalledWith("C:\\proj", "PLAN.md");
    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(true);
    expect(s.quickViewer.path).toBe("C:\\proj\\docs\\PLAN.md");
  });

  it("toasts when the search fallback also misses", async () => {
    mockedRead.mockImplementation(async () => {
      throw new Error("ENOENT");
    });
    mockedFind.mockResolvedValue(null);

    await useMdStore
      .getState()
      .openMdLinkInQuickViewer(["C:\\proj\\missing.md"], "missing.md", "C:\\proj");

    expect(useMdStore.getState().quickViewer.open).toBe(false);
    expect(
      useToastStore.getState().toasts.some((t) => t.message.includes("missing.md"))
    ).toBe(true);
  });
});

describe("mdStore — MD Editor tabs", () => {
  beforeEach(() => {
    useMdStore.getState().reset();
    useToastStore.getState().reset();
    mockedRead.mockImplementation(async (p: string) => `contents of ${p}`);
    mockedWrite.mockImplementation(async () => undefined);
  });

  it("openMdTab called twice concurrently for the same path results in exactly one tab", async () => {
    // Both calls will pass the pre-await dedup check (tabs is empty at that point)
    // and then both await the same deferred read. The post-await re-check should
    // ensure only one tab ends up in state.
    let resolveRead!: (v: string) => void;
    const pendingRead = new Promise<string>((res) => { resolveRead = res; });
    mockedRead.mockImplementation(() => pendingRead);

    const p1 = useMdStore.getState().openMdTab("/tmp/same.md");
    const p2 = useMdStore.getState().openMdTab("/tmp/same.md");

    // Unblock both reads at once
    resolveRead("hello");
    await Promise.all([p1, p2]);

    const { tabs } = useMdStore.getState();
    expect(tabs.length).toBe(1);
    expect(tabs[0].path).toBe("/tmp/same.md");
  });

  it("closeMdTab on a dirty tab pushes a warn toast", async () => {
    await useMdStore.getState().openMdTab("/tmp/dirty.md");
    const { tabs } = useMdStore.getState();
    const id = tabs[0].id;

    // Mark the tab dirty by editing its content
    useMdStore.getState().setTabContent(id, "edited content");
    expect(useMdStore.getState().tabs[0].dirty).toBe(true);

    useMdStore.getState().closeMdTab(id);

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].severity).toBe("warn");
    expect(toasts[0].message).toContain("dirty.md");
    expect(toasts[0].message).toContain("unsaved changes");
  });

  it("closeMdTab on a clean tab does NOT push a toast", async () => {
    await useMdStore.getState().openMdTab("/tmp/clean.md");
    const { tabs } = useMdStore.getState();
    const id = tabs[0].id;

    expect(tabs[0].dirty).toBe(false);

    useMdStore.getState().closeMdTab(id);

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(0);
  });

  it("saveMdTab keeps dirty === true when content changes during the write", async () => {
    await useMdStore.getState().openMdTab("/tmp/race.md");
    const { tabs } = useMdStore.getState();
    const id = tabs[0].id;

    // Make the tab dirty first
    useMdStore.getState().setTabContent(id, "version 1");

    // Deferred write — we control when it resolves
    let resolveWrite!: () => void;
    mockedWrite.mockImplementationOnce(
      () => new Promise<void>((res) => { resolveWrite = res; }),
    );

    // Start the save (it is now awaiting the write)
    const savePromise = useMdStore.getState().saveMdTab(id);

    // Simulate user typing while the write is still in-flight
    useMdStore.getState().setTabContent(id, "version 2");

    // Resolve the write
    resolveWrite();
    await savePromise;

    // The tab content is now "version 2" which differs from "version 1" that
    // was written; dirty must stay true.
    const tab = useMdStore.getState().tabs.find((t) => t.id === id);
    expect(tab?.content).toBe("version 2");
    expect(tab?.dirty).toBe(true);
  });
});
