// src/components/Preview.tsx
//
// Localhost preview panel — a sibling to the MD Quick Viewer. Renders a
// localhost URL in an <iframe>. The iframe is keyed by reloadNonce so the
// reload button forces a fresh load. "Open external" is the escape hatch for
// dev servers that refuse to be iframed (X-Frame-Options / CSP).

import { useEffect, useState } from "react";

import styles from "@/components/Preview.module.css";
import { IconClose } from "@/components/icons";
import { usePreviewStore } from "@/store/previewStore";
import { normalizePreviewUrl } from "@/lib/normalizePreviewUrl";
import { openExternal } from "@/lib/openExternal";
import { useToastStore } from "@/store/toastStore";

/** Lucide-style reload arrow. */
function IconReload({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** Lucide-style external-link. */
function IconExternal({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function Preview() {
  const url = usePreviewStore((s) => s.url);
  const reloadNonce = usePreviewStore((s) => s.reloadNonce);
  const setUrl = usePreviewStore((s) => s.setUrl);
  const reload = usePreviewStore((s) => s.reload);
  const closePreview = usePreviewStore((s) => s.closePreview);

  // Local draft so typing in the bar doesn't reload on every keystroke; commit
  // (normalize + store) on Enter or blur. Seeded from the store url.
  const [draft, setDraft] = useState(url);
  useEffect(() => setDraft(url), [url]);

  const commit = () => {
    const normalized = normalizePreviewUrl(draft);
    if (normalized === null) {
      // Empty/whitespace input — snap the bar back to the live URL rather
      // than leaving it blank while the iframe still shows the old page.
      setDraft(url);
      return;
    }
    setUrl(normalized);
    setDraft(normalized);
  };

  const onExternal = () => {
    if (url === "") return;
    void openExternal(url).catch((err) => {
      useToastStore.getState().push({
        severity: "error",
        message: `Couldn't open externally: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <input
          className={styles.urlInput}
          type="text"
          value={draft}
          placeholder="localhost:3000"
          aria-label="Preview URL"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
        />
        <div className={styles.actions}>
          <button className={styles.iconButton} title="Reload" aria-label="Reload preview" onClick={reload}>
            <IconReload />
          </button>
          <button
            className={styles.iconButton}
            title="Open in external browser"
            aria-label="Open in external browser"
            onClick={onExternal}
          >
            <IconExternal />
          </button>
          <button className={styles.iconButton} title="Close" aria-label="Close preview" onClick={closePreview}>
            <IconClose size={13} />
          </button>
        </div>
      </div>
      <div className={styles.body}>
        {url === "" ? (
          <div className={styles.placeholder}>
            Enter a localhost URL above (e.g. <code>3000</code> or <code>localhost:5173</code>) to preview your
            running app.
          </div>
        ) : (
          <iframe
            key={`${reloadNonce}:${url}`}
            className={styles.frame}
            src={url}
            title="Localhost preview"
          />
        )}
      </div>
    </div>
  );
}
