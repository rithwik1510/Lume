// src/lib/paneIds.ts
//
// Single source of truth for paneId generation. Both keyboard shortcuts
// (split via Ctrl+Alt+arrow) and the TopBar Split button mint paneIds —
// they must agree on the scheme so ids never collide and stay stable
// across the session. Seeded high enough that it never clashes with the
// App.tsx bootstrap ids (pane-1..pane-4).

let counter = 100;

export function nextPaneId(): string {
  counter += 1;
  return `pane-${counter}`;
}

/** Test/bootstrap helper: ensure the counter starts above n. */
export function reservePaneIdsAtLeast(n: number): void {
  if (n > counter) counter = n;
}
