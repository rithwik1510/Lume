// src/components/MdEditorTabStrip.tsx
import styles from "@/components/MdEditorTabStrip.module.css";
import { useMdStore } from "@/store/mdStore";

export function MdEditorTabStrip() {
  const tabs = useMdStore((s) => s.tabs);
  const activeTabId = useMdStore((s) => s.activeTabId);
  const setActiveTab = useMdStore((s) => s.setActiveTab);
  const closeMdTab = useMdStore((s) => s.closeMdTab);
  return (
    <div className={styles.strip}>
      {tabs.map((t) => {
        const fileName = t.path.split(/[/\\]/).pop() ?? t.path;
        const isActive = t.id === activeTabId;
        return (
          <div
            key={t.id}
            className={`${styles.tab} ${isActive ? styles.active : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            <span className={styles.label}>
              {t.dirty && <span className={styles.dirty}>●</span>}
              {fileName}
            </span>
            <button
              className={styles.close}
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeMdTab(t.id);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
