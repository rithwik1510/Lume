/* Lume site — interactive keyboard demo.
   A miniature Lume window that obeys the real shortcuts. A ghost operator
   cycles through them on autoplay; put your pointer over the window and the
   keys are yours (Ctrl+W stays unbound — that's your tab). */

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initKeysDemo() {
  const sec = document.getElementById("keyboard");
  const win = document.getElementById("kbWin");
  if (!sec || !win) return;
  const side = win.querySelector(".kb-side");
  const panesEl = win.querySelector(".kb-panes");
  const sps = [...panesEl.querySelectorAll(".kb-sp")];
  const rows = [...sec.querySelectorAll(".keyrow")];

  /* layout states: pane geometry in % — same trick as the split section */
  const GAP = 1.2;
  const LAYOUTS = {
    1: [[0, 0, 100, 100]],
    2: [[0, 0, 50 - GAP / 2, 100], [50 + GAP / 2, 0, 50 - GAP / 2, 100]],
    3: [[0, 0, 50 - GAP / 2, 100], [50 + GAP / 2, 0, 50 - GAP / 2, 50 - GAP / 2], [50 + GAP / 2, 50 + GAP / 2, 50 - GAP / 2, 50 - GAP / 2]],
  };
  let count = 1;
  let focus = 0;
  let sidebarOn = true;

  function apply() {
    const L = LAYOUTS[count];
    sps.forEach((sp, i) => {
      const g = L[i];
      if (!g) { sp.style.opacity = "0"; sp.style.pointerEvents = "none"; return; }
      sp.style.opacity = "1"; sp.style.pointerEvents = "auto";
      sp.style.left = g[0] + "%"; sp.style.top = g[1] + "%";
      sp.style.width = g[2] + "%"; sp.style.height = g[3] + "%";
      sp.classList.toggle("focused", i === focus);
    });
    side.classList.toggle("off", !sidebarOn);
  }
  apply();

  /* flash the matching shortcut row + depress its keycaps */
  function flash(rowIdx) {
    const row = rows[rowIdx];
    if (!row) return;
    row.classList.add("hit");
    row.querySelectorAll(".kbd").forEach((k) => k.classList.add("press"));
    setTimeout(() => {
      row.classList.remove("hit");
      row.querySelectorAll(".kbd").forEach((k) => k.classList.remove("press"));
    }, 460);
  }

  /* actions (row indices follow the markup order) */
  const A = {
    splitRight() { if (count < 2) { count = 2; focus = 1; } else if (count < 3) { count = 3; focus = 2; } flash(0); apply(); },
    splitDown() { if (count === 2) { count = 3; focus = 2; flash(0); apply(); } else A.splitRight(); },
    focusNext() { focus = (focus + 1) % count; flash(1); apply(); },
    sidebar() { sidebarOn = !sidebarOn; flash(4); apply(); },
    close() { if (count > 1) { count--; focus = Math.min(focus, count - 1); } flash(5); apply(); },
  };

  /* ---- autoplay: the ghost operator ---- */
  let userUntil = 0;
  let step = 0;
  const SCRIPT = [A.splitRight, A.splitDown, A.focusNext, A.focusNext, A.sidebar, A.sidebar, A.close, A.close];
  let timer = null;
  function tick() {
    if (performance.now() > userUntil) {
      SCRIPT[step % SCRIPT.length]();
      step++;
    }
  }
  const io = new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      if (e.isIntersecting && !timer && !reduce) timer = setInterval(tick, 1700);
      else if (!e.isIntersecting && timer) { clearInterval(timer); timer = null; }
    });
  }, { threshold: 0.3 });
  io.observe(sec);

  /* ---- real keys, when the pointer is over the window ---- */
  let hot = false;
  win.addEventListener("pointerenter", () => { hot = true; win.classList.add("hot"); });
  win.addEventListener("pointerleave", () => { hot = false; win.classList.remove("hot"); });
  window.addEventListener("keydown", (e) => {
    if (!hot) return;
    const hit = () => { e.preventDefault(); userUntil = performance.now() + 6000; };
    if (e.ctrlKey && e.altKey && e.key === "ArrowRight") { hit(); A.splitRight(); }
    else if (e.ctrlKey && e.altKey && e.key === "ArrowDown") { hit(); A.splitDown(); }
    else if (e.ctrlKey && !e.altKey && e.key === "ArrowRight") { hit(); A.focusNext(); }
    else if (e.ctrlKey && !e.altKey && (e.key === "b" || e.key === "B")) { hit(); A.sidebar(); }
  });
  /* pane ✕ buttons close (Ctrl+W is left to the browser) */
  sps.forEach((sp) => {
    sp.querySelector(".kb-x")?.addEventListener("click", () => { userUntil = performance.now() + 6000; A.close(); });
  });
}
