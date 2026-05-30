// InlineRename — controlled input swap used by SessionRow and SessionGroup.
// Enter to commit, Escape to cancel, blur commits. autoFocus on mount.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "@/components/InlineRename.module.css";

interface Props {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}

export function InlineRename({ initial, onCommit, onCancel, className }: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    onCommit(value.trim());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={ref}
      className={`${styles.input} ${className ?? ""}`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
