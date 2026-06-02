import { useState } from "react";
import styles from "@/components/settings/controls.module.css";

export function ChipList({
  values,
  onChange,
  placeholder = "Add…",
  ariaLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className={styles.chipList} aria-label={ariaLabel}>
      <div className={styles.chips}>
        {values.map((v) => (
          <span key={v} className={styles.chip}>
            {v}
            <button
              type="button"
              className={styles.chipRemove}
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        className={styles.chipInput}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
