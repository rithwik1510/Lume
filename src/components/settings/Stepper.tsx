import styles from "@/components/settings/controls.module.css";

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  ariaLabel: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const decimals = Math.max(0, (step.toString().split(".")[1] ?? "").length);
  const round = (n: number) => parseFloat((Math.round(n / step) * step).toFixed(decimals));
  return (
    <div className={styles.stepper} aria-label={ariaLabel}>
      <button
        type="button"
        className={styles.stepperBtn}
        aria-label="Decrease"
        disabled={value <= min}
        onClick={() => onChange(clamp(round(value - step)))}
      >
        −
      </button>
      <span className={styles.stepperValue}>{Number(value.toFixed(2))}</span>
      <button
        type="button"
        className={styles.stepperBtn}
        aria-label="Increase"
        disabled={value >= max}
        onClick={() => onChange(clamp(round(value + step)))}
      >
        +
      </button>
    </div>
  );
}
