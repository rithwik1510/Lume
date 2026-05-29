// SessionGroup — TEMPORARY stub. Task 3a.2 replaces the body with the real
// header + nested SessionRow children. This stub keeps typecheck green for
// Task 3a.1's SessionsSidebar import.
import type { SessionGroupView } from "@/store/sessionsStore";

interface Props {
  group: SessionGroupView;
}

export function SessionGroup({ group }: Props) {
  void group;
  return null;
}
