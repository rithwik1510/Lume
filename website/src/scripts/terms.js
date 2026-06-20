/* Lume site — real terminal engine.
   The hero panes and the Flood Test run actual xterm.js on the WebGL
   renderer — the same stack the app ships. Everything here lazy-loads on
   first intersection so the static HTML mock is what paints first. */

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- palette (truecolor — a terminal shows its program's colors, these
   are the authentic agent signatures and stay fixed across site themes) --- */
const RGB = {
  cl: "224;138;99",   // Claude Code terracotta
  cx: "31;189;128",   // Codex green
  gm: "122;162;255",  // Gemini blue
  ok: "127;194;107",
  er: "232;90;90",
  dim: "106;106;106",
  fg: "230;230;230",
};
const F = (k, s) => `\x1b[38;2;${RGB[k]}m${s}\x1b[0m`;
const B = (s) => `\x1b[1m${s}\x1b[22m`;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
export function xtermTheme() {
  return {
    background: cssVar("--bg-0"),
    foreground: cssVar("--fg-1"),
    cursor: cssVar("--accent"),
    cursorAccent: cssVar("--bg-0"),
    selectionBackground: cssVar("--accent-alpha"),
  };
}

/* ---- lazy module + instance registry ---------------------------------- */
let xtermMod = null;
async function loadXterm() {
  if (xtermMod) return xtermMod;
  // xterm's stylesheet is imported eagerly in the page (index.astro) so it's
  // bundled into the page CSS and always served — importing it here as a lazy
  // chunk made Vite reference a CSS asset it never emitted (404 → unstyled,
  // zero-height terminals that render blank).
  const [{ Terminal }, { WebglAddon }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-webgl"),
    import("@xterm/addon-fit"),
  ]);
  xtermMod = { Terminal, WebglAddon, FitAddon };
  return xtermMod;
}

const live = []; // every terminal we created — for theme re-sync

export async function makeTerm(host, opts = {}) {
  const { Terminal, WebglAddon, FitAddon } = await loadXterm();
  const term = new Terminal({
    fontFamily: '"JetBrains Mono Variable","JetBrains Mono",Consolas,monospace',
    fontSize: opts.fontSize || 12,
    lineHeight: 1.45,
    letterSpacing: 0,
    cursorBlink: !!opts.cursorBlink,
    cursorStyle: "block",
    disableStdin: opts.input !== true,
    scrollback: opts.scrollback ?? 400,
    allowProposedApi: true,
    theme: xtermTheme(),
    convertEol: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  try {
    const gl = new WebglAddon();
    gl.onContextLoss(() => gl.dispose()); // falls back to DOM renderer
    term.loadAddon(gl);
  } catch (_) { /* DOM renderer fallback */ }
  const refit = () => { try { fit.fit(); } catch (_) {} };
  refit();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(refit);
    ro.observe(host);
  }
  live.push(term);
  return term;
}

/* theme hot-swap: the site dispatches lume:settheme when a palette card or
   the command palette changes the theme — re-skin every live terminal */
window.addEventListener("lume:settheme", () => {
  const t = xtermTheme();
  live.forEach((term) => { term.options.theme = t; });
});

/* ---- tiny async helpers ------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let heroVisible = true;
async function gate() { while (!heroVisible) await sleep(300); }

/* ---- script player ------------------------------------------------------
   steps: { type: "..." }  → typed char-by-char (human cadence)
          { out:  "..." }  → written at once
          { spin: {k, frames, ms} } → glyph spinner in place
          { wait: n }      → extra pause */
async function play(term, steps, { loop = true } = {}) {
  for (;;) {
    for (const st of steps) {
      await gate();
      if (st.type != null) {
        for (const ch of st.type) {
          term.write(ch);
          if (!reduce) await sleep(26 + Math.random() * 44);
        }
      }
      if (st.out != null) term.write(st.out);
      if (st.spin && !reduce) {
        const { k, frames, ms = 1400 } = st.spin;
        const t0 = performance.now();
        let i = 0;
        while (performance.now() - t0 < ms) {
          term.write("\b" + F(k, frames[i++ % frames.length]));
          await sleep(120);
        }
        term.write("\b" + F(k, frames[0]));
      }
      await sleep(reduce ? 60 : (st.wait ?? 340));
    }
    if (!loop) return;
    await sleep(3200);
    term.write("\r\n");
  }
}

/* ---- the three hero agent sessions ------------------------------------- */
const CL = [
  { out: `${F("cl", "✻")} ${B("Claude Code")} ${F("dim", "· opus 4.8 · ~/projects/auth")}\r\n\r\n`, wait: 500 },
  { out: F("cl", "> "), wait: 120 },
  { type: "wire the session refresh flow", wait: 520 },
  { out: `\r\n\r\n${F("cl", "⏺")} ${F("fg", "Read")}${F("dim", "(src/auth/session.ts)")}\r\n`, wait: 420 },
  { out: `${F("dim", "  ⎿  142 lines")}\r\n`, wait: 600 },
  { out: `${F("cl", "⏺")} ${F("fg", "Update")}${F("dim", "(src/auth/session.ts)")}\r\n`, wait: 380 },
  { out: `${F("ok", '  +  import { tokenStore } from "./tokenStore"')}\r\n`, wait: 300 },
  { out: `${F("er", '  -  localStorage.getItem("session")')}\r\n`, wait: 300 },
  { out: `${F("ok", "  +  await tokenStore.read()")}\r\n`, wait: 700 },
  { out: `${F("cl", "⏺")} ${F("fg", "Bash")}${F("dim", "(npm test)")}\r\n`, wait: 350 },
  { out: F("cl", "✻") + " ", spin: { k: "cl", frames: ["✻", "✶", "✳", "∗"], ms: 1700 }, wait: 100 },
  { out: `\r${F("ok", "  ⎿  ✓ 24 passed")} ${F("dim", "(1.8s)")}\r\n\r\n`, wait: 500 },
  { out: `${F("cl", "✻")} ${F("fg", "Sessions persist via the token store.")}\r\n\r\n`, wait: 2400 },
  { out: F("cl", "> "), wait: 140 },
  { type: "tighten the retry budget on refresh()", wait: 520 },
  { out: `\r\n\r\n${F("cl", "⏺")} ${F("fg", "Update")}${F("dim", "(src/auth/tokenStore.ts)")}\r\n`, wait: 420 },
  { out: `${F("ok", "  +  const RETRY_BUDGET = 3")}\r\n`, wait: 320 },
  { out: `${F("ok", "  +  backoff: 250 * 2 ** attempt")}\r\n\r\n`, wait: 500 },
  { out: `${F("cl", "✻")} ${F("fg", "Refresh now gives up gracefully after 3 tries.")}\r\n\r\n`, wait: 2000 },
];

const CX = [
  { out: `${F("cx", "▌")} ${B("OpenAI Codex")} ${F("dim", "· gpt-5.5 · pwsh")}\r\n\r\n`, wait: 700 },
  { out: F("cx", "› "), wait: 200 },
  { type: "add the db migration script", wait: 600 },
  { out: `\r\n${F("cx", "•")} ${F("fg", "Editing")} ${F("dim", "migrate.ts")}\r\n`, wait: 900 },
  { out: `${F("cx", "•")} ${F("fg", "npm run build")}\r\n`, wait: 250 },
  { out: F("cx", "◐") + " ", spin: { k: "cx", frames: ["◐", "◓", "◑", "◒"], ms: 1900 }, wait: 80 },
  { out: `\r${F("ok", "  ✓ built in 3.2s")}\r\n\r\n`, wait: 2600 },
  { out: F("cx", "› "), wait: 200 },
  { type: "run it against the staging db", wait: 600 },
  { out: `\r\n${F("cx", "•")} ${F("fg", "node migrate.js --env staging")}\r\n`, wait: 800 },
  { out: `${F("dim", "  12 tables · 4 indexes")}\r\n`, wait: 400 },
  { out: `${F("ok", "  ✓ migrated in 840ms")}\r\n\r\n`, wait: 2400 },
];

const GM = [
  { out: `${F("gm", "✦")} ${B("Gemini")} ${F("dim", "· 3.0 pro · wsl")}\r\n\r\n`, wait: 900 },
  { out: F("gm", "✦ "), wait: 200 },
  { type: "review the diff", wait: 600 },
  { out: `\r\n${F("dim", "  3 files ·")} ${F("ok", "+84")} ${F("er", "−12")}\r\n`, wait: 500 },
  { out: F("gm", "✦") + " ", spin: { k: "gm", frames: ["✦", "✧", "✶", "✧"], ms: 2200 }, wait: 80 },
  { out: `\r${F("gm", "✦")} ${F("fg", "Token-store path is solid. One nit: name the")}\r\n`, wait: 200 },
  { out: `${F("fg", "  retry constant. Otherwise — ship it.")}\r\n\r\n`, wait: 3000 },
];

/* ---- HERO: hydrate the static mock into live terminals ------------------ */
export function initHeroTerms() {
  const stage = document.querySelector(".stage");
  if (!stage) return;
  const mounts = stage.querySelectorAll("[data-term]");
  if (!mounts.length) return;

  const vis = new IntersectionObserver((ents) => {
    ents.forEach((e) => { heroVisible = e.isIntersecting; });
  }, { threshold: 0.05 });
  vis.observe(stage);

  const boot = () => {
    const scripts = { cl: CL, cx: CX, gm: GM };
    // Hydrate each pane independently. One pane failing to mount (e.g. a WebGL
    // context drop on the focused pane) must never blank that pane or block its
    // siblings — so no shared await chain, and the static mock is restored on
    // any failure or stall instead of leaving an empty pane.
    mounts.forEach((el) => {
      const kind = el.getAttribute("data-term");
      const fallback = el.innerHTML;
      const restore = () => { el.classList.remove("term-host"); el.innerHTML = fallback; };
      el.classList.add("term-host");
      el.textContent = "";
      const stall = setTimeout(() => { if (!el.querySelector(".xterm")) restore(); }, 4000);
      makeTerm(el, { fontSize: kind === "cl" ? 12 : 11.5 })
        .then((term) => { clearTimeout(stall); play(term, scripts[kind] || CL); })
        .catch(() => { clearTimeout(stall); restore(); });
    });
  };

  // Keep the 430 KB of xterm/webgl chunks off the initial load path. The static
  // HTML mock paints first (by design), so we only arm the intersection-boot
  // after the window `load` event and an idle slot — xterm never competes with
  // first paint, and `loadEventEnd` stays tiny.
  const arm = () => {
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        boot();
      });
    }, { rootMargin: "200px" });
    io.observe(stage);
  };
  const schedule = () =>
    window.requestIdleCallback ? requestIdleCallback(arm, { timeout: 1500 }) : setTimeout(arm, 200);
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}

/* ============================================================================
   FLOOD TEST — the proof section. Three panes get blasted with output while
   an FPS meter and a typing-latency meter read out live. The fourth pane is
   yours: type into it during the flood and watch the latency stay flat.
   ========================================================================== */
const WORDS = ["pane", "grid", "pty", "session", "render", "buffer", "splash", "cursor", "theme", "stream", "vite", "tauri", "xterm", "tokio", "ipc", "frame"];
const pick = (a) => a[(Math.random() * a.length) | 0];
const hex = (n) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");

function floodLine(style) {
  switch (style) {
    case 0: // cargo-ish
      return `${F("dim", "   Compiling")} lume-${pick(WORDS)} v0.${(Math.random() * 9) | 0}.${(Math.random() * 20) | 0}`;
    case 1: // vite-ish
      return `${F("ok", "✓")} src/ui/${pick(WORDS)}/${pick(WORDS)}.tsx ${F("dim", `${(Math.random() * 40 + 2) | 0}ms`)}`;
    case 2: // test-ish
      return `${F("ok", "PASS")} ${F("dim", `tests/${pick(WORDS)}.test.ts`)} ${pick(WORDS)} ${F("dim", `(${(Math.random() * 90 + 4) | 0}ms)`)}`;
    default: // log-ish
      return `${F("dim", hex(8))} ${pick(WORDS)}::${pick(WORDS)} ${F("ok", "ok")} ${F("dim", `${hex(4)}`)}`;
  }
}

export function initFlood() {
  const sec = document.getElementById("flood");
  if (!sec) return;
  const mounts = sec.querySelectorAll("[data-flood]");
  const inputMount = sec.querySelector("[data-flood-input]");
  const btn = sec.querySelector("#floodBtn");
  const fpsEl = sec.querySelector("#fpsVal");
  const lpsEl = sec.querySelector("#lpsVal");
  const latEl = sec.querySelector("#latVal");
  const totEl = sec.querySelector("#totVal");
  if (!mounts.length || !btn) return;

  let terms = [];
  let inputTerm = null;
  let booted = false;
  let flooding = false;
  let inView = false;
  let total = 0;
  let linesThisSec = 0;
  let lastSecT = performance.now();

  /* fps meter — only runs while the section is on screen */
  let fps = 60, lastT = 0, rafFps = 0;
  function fpsLoop(t) {
    if (lastT) {
      const inst = 1000 / (t - lastT);
      fps += (inst - fps) * 0.08;
    }
    lastT = t;
    if (fpsEl) fpsEl.textContent = String(Math.min(999, Math.round(fps)));
    if (inView) rafFps = requestAnimationFrame(fpsLoop);
  }

  function floodFrame() {
    if (!flooding) return;
    const perPane = 22;
    terms.forEach((term, i) => {
      let buf = "";
      for (let j = 0; j < perPane; j++) buf += floodLine((i + j) % 4) + "\r\n";
      term.write(buf);
    });
    const n = perPane * terms.length;
    total += n; linesThisSec += n;
    const now = performance.now();
    if (now - lastSecT >= 500) {
      if (lpsEl) lpsEl.textContent = Math.round(linesThisSec * 1000 / (now - lastSecT)).toLocaleString();
      if (totEl) totEl.textContent = total.toLocaleString();
      linesThisSec = 0; lastSecT = now;
    }
    requestAnimationFrame(floodFrame);
  }

  function setFlood(on) {
    flooding = on;
    btn.classList.toggle("on", on);
    btn.querySelector(".bl").textContent = on ? "Stop the flood" : "Flood every pane";
    sec.classList.toggle("flooding", on);
    if (on) { lastSecT = performance.now(); linesThisSec = 0; requestAnimationFrame(floodFrame); }
    else if (lpsEl) lpsEl.textContent = "0";
  }

  async function boot() {
    if (booted) return; booted = true;
    for (const el of mounts) {
      el.textContent = ""; el.classList.add("term-host");
      const t = await makeTerm(el, { fontSize: 11, scrollback: 120 });
      t.write(`${F("dim", "ready — waiting for the flood…")}\r\n`);
      terms.push(t);
    }
    if (inputMount) {
      inputMount.textContent = ""; inputMount.classList.add("term-host");
      inputTerm = await makeTerm(inputMount, { fontSize: 12, input: true, cursorBlink: true, scrollback: 120 });
      inputTerm.write(`${F("dim", "this pane is yours — click and type while it floods")}\r\n${F("fg", "you@lume")} ${F("dim", "~")} ${F("ok", "$")} `);
      let lat = 0;
      inputTerm.onData((d) => {
        const t0 = performance.now();
        let echo = d;
        if (d === "\r") echo = `\r\n${F("fg", "you@lume")} ${F("dim", "~")} ${F("ok", "$")} `;
        else if (d === "\x7f") echo = "\b \b";
        inputTerm.write(echo, () => {
          requestAnimationFrame(() => {
            const ms = performance.now() - t0;
            lat = lat ? lat + (ms - lat) * 0.3 : ms;
            if (latEl) latEl.textContent = lat.toFixed(1);
          });
        });
      });
    }
  }

  btn.addEventListener("click", async () => {
    await boot();
    setFlood(!flooding);
    if (flooding && inputTerm) inputTerm.focus();
  });

  const io = new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      inView = e.isIntersecting;
      if (inView) { boot(); lastT = 0; rafFps = requestAnimationFrame(fpsLoop); }
      else { cancelAnimationFrame(rafFps); if (flooding) setFlood(false); }
    });
  }, { threshold: 0.15 });
  io.observe(sec);
}
