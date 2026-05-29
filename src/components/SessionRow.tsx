// SessionRow — TEMPORARY stub. Task 3a.3 replaces the body with the real
// dot + name + trash UI. This stub keeps typecheck green for Task 3a.2's
// SessionGroup import.

import type { Session } from "@/store/sessionsStore";

interface Props {
  session: Session;
}

export function SessionRow({ session }: Props) {
  void session;
  return null;
}
