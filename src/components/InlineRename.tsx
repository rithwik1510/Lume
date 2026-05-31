// InlineRename — controlled input swap used by SessionRow and SessionGroup.
// Enter to commit, Escape to cancel, blur commits. autoFocus on mount.
//
// `done` guard: Escape calls onCancel, which the parent uses to unmount this
// input. Unmounting a focused input fires a synthetic blur → onBlur={commit}.
// Without the guard, Escape would spuriously commit the edited value instead
// of discarding it (caught in the Phase 3-5 review). The guard makes the
// first terminal action (commit OR cancel) win and no-ops the trailing blur.

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
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value.trim());
  };

  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
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
