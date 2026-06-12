/* Lume site — ambient effects & text motion.
   Everything sits on the product's one easing curve, pauses offscreen, and
   collapses to a static state under prefers-reduced-motion. */

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = document.documentElement;

/* ---- glyph constellation -------------------------------------------------
   A quiet canvas field of agent glyphs (✻ ▌ ✦ …) drifting like idle agents
   behind the hero. Colors are read from the live CSS vars so theme swaps
   re-tint it instantly. */
export function initConstellation() {
  const cv = document.getElementById("constellation");
  if (!cv || reduce) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;

  const GLYPHS = ["✻", "✶", "✦", "✧", "▌", "∗", "·", "✳", "◐"];
  let W = 0, H = 0, dpr = 1, raf = 0, running = false;

  const N = window.innerWidth < 760 ? 24 : 48;
  const pts = Array.from({ length: N }, () => {
    const p = 0.25 + Math.random() * 0.75; // parallax depth — also drives size/brightness
    return {
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.022, vy: (Math.random() - 0.5) * 0.016,
      g: GLYPHS[(Math.random() * GLYPHS.length) | 0],
      s: 10 + p * 12,                      // 10–22px: near glyphs are clearly glyphs
      a: 0.10 + p * 0.26,                  // 0.10–0.36 base alpha
      p,
      tw: Math.random() * Math.PI * 2,     // twinkle phase
      spin: (Math.random() - 0.5) * 0.5,   // slow rotation, rad/s
    };
  });

  function size() {
    const r = cv.parentElement.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function vget(n) { return getComputedStyle(root).getPropertyValue(n).trim(); }
  let accent = "#5fa8ff", fg = "#9a9a9a";
  function recolor() { accent = vget("--accent") || accent; fg = vget("--fg-2") || fg; }
  recolor();
  window.addEventListener("lume:settheme", () => setTimeout(recolor, 50));

  let t = 0;
  function draw() {
    if (!running) return;
    t += 0.016;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const p of pts) {
      p.x += p.vx * 0.016; p.y += p.vy * 0.016;
      if (p.x < -0.04) p.x = 1.04; if (p.x > 1.04) p.x = -0.04;
      if (p.y < -0.06) p.y = 1.06; if (p.y > 1.06) p.y = -0.06;
      const px = p.x * W;
      const py = p.y * H;
      const tw = 0.66 + 0.34 * Math.sin(t * 0.9 + p.tw);
      const isAccent = p.p > 0.62;
      ctx.globalAlpha = p.a * tw * (isAccent ? 1.15 : 1);
      ctx.fillStyle = isAccent ? accent : fg;
      ctx.font = `${p.s}px "JetBrains Mono Variable","JetBrains Mono",monospace`;
      // the near layer glows softly, like a live agent indicator
      ctx.shadowColor = isAccent ? accent : "transparent";
      ctx.shadowBlur = isAccent ? 12 : 0;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.spin * t);
      ctx.fillText(p.g, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(draw);
  }

  window.addEventListener("resize", size, { passive: true });

  const io = new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      if (e.isIntersecting && !running) { running = true; size(); raf = requestAnimationFrame(draw); }
      else if (!e.isIntersecting && running) { running = false; cancelAnimationFrame(raf); }
    });
  }, { threshold: 0.02 });
  io.observe(cv);
}

/* ---- scramble decode ------------------------------------------------------
   Mono micro-labels ([data-scramble]) decode from terminal noise, settling
   left → right. Mono only — proportional text would jitter. */
export function initScramble() {
  const els = document.querySelectorAll("[data-scramble]");
  if (!els.length) return;
  const NOISE = "█▓▒░<>/\\|{}[]=+*#%$@";
  const decode = (el) => {
    const txt = el.getAttribute("data-scramble") || el.textContent;
    el.setAttribute("aria-label", txt);
    if (reduce) { el.textContent = txt; return; }
    const t0 = performance.now();
    const dur = 420 + txt.length * 14;
    (function tick() {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const settled = Math.floor(k * txt.length);
      let out = txt.slice(0, settled);
      for (let i = settled; i < txt.length; i++) {
        out += txt[i] === " " ? " " : NOISE[(Math.random() * NOISE.length) | 0];
      }
      el.textContent = out;
      if (k < 1) requestAnimationFrame(tick);
    })();
  };
  const io = new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      decode(e.target);
    });
  }, { threshold: 0.4 });
  els.forEach((el) => io.observe(el));
}

/* ---- masked word rise ------------------------------------------------------
   Headings ([data-words]) rise word-by-word out of an overflow mask — the
   page's signature entrance. Layout is reserved up front: no shift. */
export function initWordRise() {
  const els = document.querySelectorAll("[data-words]");
  els.forEach((el) => {
    const wrap = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((piece) => {
            if (!piece) return;
            if (/^\s+$/.test(piece)) { frag.appendChild(document.createTextNode(piece)); return; }
            const m = document.createElement("span"); m.className = "wm";
            const w = document.createElement("span"); w.className = "w";
            w.textContent = piece; m.appendChild(w); frag.appendChild(m);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== "BR") {
          wrap(n);
        }
      });
    };
    wrap(el);
    const words = el.querySelectorAll(".wm .w");
    words.forEach((w, i) => { w.style.transitionDelay = `${i * 55}ms`; });
    if (reduce) { el.classList.add("in"); return; }
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        el.classList.add("in");
      });
    }, { threshold: 0.5 });
    io.observe(el);
    setTimeout(() => el.classList.add("in"), 2400); // never stuck hidden
  });
}

/* ---- sparkline stats -------------------------------------------------------
   Stat bars ([data-spark="2,4,6…"]) flicker like a live meter, then settle
   onto the real benchmark shape. */
export function initSparks() {
  const els = document.querySelectorAll("[data-spark]");
  els.forEach((el) => {
    const target = el.getAttribute("data-spark").split(",").map(Number);
    target.forEach(() => {
      const b = document.createElement("i");
      b.style.height = "2px";
      el.appendChild(b);
    });
    const bars = [...el.children];
    const settle = () => bars.forEach((b, i) => { b.style.height = `${target[i] * 3}px`; });
    if (reduce) { settle(); return; }
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        let n = 0;
        const flick = setInterval(() => {
          bars.forEach((b) => { b.style.height = `${2 + Math.random() * 22}px`; });
          if (++n >= 7) { clearInterval(flick); settle(); }
        }, 90);
      });
    }, { threshold: 0.5 });
    io.observe(el);
  });
}

/* ---- site statusbar ---------------------------------------------------------
   The fixed bottom bar — the page wearing the app's chrome. Live fps, the
   section you're in, the theme you picked. */
export function initStatusbar() {
  const bar = document.getElementById("sitebar");
  if (!bar) return;
  const secEl = bar.querySelector("#sbSection");
  const themeEl = bar.querySelector("#sbTheme");
  const fpsEl = bar.querySelector("#sbFps");

  // current section
  const names = { top: "~/hero", smoothness: "~/smoothness", split: "~/tiling", markdown: "~/markdown", keyboard: "~/keyboard", themes: "~/themes" };
  const watched = [...document.querySelectorAll("#top, #smoothness, #split, #markdown, #keyboard, #themes")];
  if (secEl && watched.length) {
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (e.isIntersecting) secEl.textContent = names[e.target.id] || "~/";
      });
    }, { rootMargin: "-40% 0px -50% 0px" });
    watched.forEach((s) => io.observe(s));
  }

  // theme name
  const syncTheme = () => { if (themeEl) themeEl.textContent = root.getAttribute("data-theme") || "cobalt"; };
  syncTheme();
  window.addEventListener("lume:settheme", () => setTimeout(syncTheme, 30));

  // live fps (cheap EMA, updates 4×/s)
  if (fpsEl && !reduce) {
    let fps = 60, last = 0, lastPaint = 0;
    (function loop(t) {
      if (last) fps += (1000 / (t - last) - fps) * 0.06;
      last = t;
      if (t - lastPaint > 250) { fpsEl.textContent = String(Math.min(240, Math.round(fps))); lastPaint = t; }
      requestAnimationFrame(loop);
    })(0);
  } else if (fpsEl) fpsEl.textContent = "60";
}

/* ---- CTA prompt --------------------------------------------------------------
   `$ lume` types itself above the final call to action. */
export function initCtaPrompt() {
  const el = document.getElementById("ctaPrompt");
  if (!el) return;
  const cmd = "lume";
  const out = el.querySelector(".t");
  if (reduce) { out.textContent = cmd; return; }
  const io = new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      let i = 0;
      const t = setInterval(() => {
        out.textContent = cmd.slice(0, ++i);
        if (i >= cmd.length) { clearInterval(t); el.classList.add("done"); }
      }, 150);
    });
  }, { threshold: 0.6 });
  io.observe(el);
}
