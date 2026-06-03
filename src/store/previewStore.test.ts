import { describe, it, expect, beforeEach } from "vitest";
import { usePreviewStore } from "@/store/previewStore";

describe("previewStore", () => {
  beforeEach(() => usePreviewStore.getState().reset());

  it("starts closed with no url", () => {
    const s = usePreviewStore.getState();
    expect(s.open).toBe(false);
    expect(s.url).toBe("");
  });
  it("openPreview opens and optionally sets the url", () => {
    usePreviewStore.getState().openPreview("http://localhost:3000");
    const s = usePreviewStore.getState();
    expect(s.open).toBe(true);
    expect(s.url).toBe("http://localhost:3000");
  });
  it("openPreview without a url keeps the existing url", () => {
    usePreviewStore.getState().setUrl("http://localhost:5173");
    usePreviewStore.getState().closePreview();
    usePreviewStore.getState().openPreview();
    expect(usePreviewStore.getState().url).toBe("http://localhost:5173");
    expect(usePreviewStore.getState().open).toBe(true);
  });
  it("reload bumps reloadNonce", () => {
    const before = usePreviewStore.getState().reloadNonce;
    usePreviewStore.getState().reload();
    expect(usePreviewStore.getState().reloadNonce).toBe(before + 1);
  });
  it("closePreview leaves the url intact for re-open", () => {
    usePreviewStore.getState().openPreview("http://localhost:3000");
    usePreviewStore.getState().closePreview();
    expect(usePreviewStore.getState().open).toBe(false);
    expect(usePreviewStore.getState().url).toBe("http://localhost:3000");
  });
});
