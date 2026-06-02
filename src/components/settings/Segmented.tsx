import styles from "@/components/settings/controls.module.css";

export interface SegmentOption {
  value: string;
  label: string;
}

export function Segmented({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: SegmentOption[];
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={`${styles.segment} ${value === o.value ? styles.segmentOn : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
