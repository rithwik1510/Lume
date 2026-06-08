/* Lume site — interactions.
   Bundled & minified by Astro; the Tweaks panel is a separate React island. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;
  function motionMult() {
    var v = getComputedStyle(root).getPropertyValue("--motion-mult").trim();
    var n = parseFloat(v);
    return isNaN(n) ? 1 : n;
  }

  /* ---- rise-in on enter (staggered per group) ------------------------- */
  function initRise() {
    var items = [].slice.call(document.querySelectorAll("[data-rise]"));
    if (reduce) { items.forEach(function (el) { el.classList.add("in"); }); return; }
    var heroItems = items.filter(function (el) { return el.closest(".hero-in") || el.classList.contains("stage"); });
    heroItems.forEach(function (el, i) { el.style.transitionDelay = (i * 70) + "ms"; });

    var reveal = function (el) { el.classList.add("in"); };
    var inView = function (el) {
      var r = el.getBoundingClientRect();
      return r.top < (window.innerHeight || 800) * 0.94 && r.bottom > 0;
    };
    items.forEach(function (el) { if (inView(el)) reveal(el); });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        reveal(e.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (el) { if (!el.classList.contains("in")) io.observe(el); });

    // Safety net: never leave content stuck invisible.
    setTimeout(function () { items.forEach(reveal); }, 2200);
  }

  /* ---- hero agent pane: append a few lines, then idle ----------------- */
  function initAgentStream() {
    var term = document.querySelector('[data-stream="agent"]');
    if (!term) return;
    var extra = [
      '<span class="ok">     + await tokenStore.read()</span>',
      '&nbsp;',
      '<span class="cl">⏺</span> <span class="c">Bash</span><span class="dim">(npm test)</span>',
      '<span class="ok">  ⎿ ✓ 24 passed</span> <span class="dim">(1.8s)</span>',
      '&nbsp;',
      '<span class="cl"><span class="spin" data-spin="cl">✻</span></span> Sessions persist via the token store.'
    ];
    var caret = document.createElement("div");
    caret.className = "ln";
    caret.innerHTML = '<span class="caret"></span>';
    term.appendChild(caret);
    if (reduce) {
      extra.forEach(function (h) {
        var d = document.createElement("div"); d.className = "ln"; d.innerHTML = h;
        term.insertBefore(d, caret);
      });
      return;
    }
    var i = 0;
    function step() {
      if (i >= extra.length) return;
      var d = document.createElement("div");
      d.className = "ln";
      d.innerHTML = extra[i];
      d.style.opacity = "0";
      d.style.transform = "translateY(3px)";
      d.style.transition = "opacity .26s var(--ease-out), transform .26s var(--ease-out)";
      term.insertBefore(d, caret);
      setTimeout(function () { d.style.opacity = ""; d.style.transform = ""; }, 20);
      i++;
      term.scrollTop = term.scrollHeight;
      setTimeout(step, (620 + Math.random() * 380) * motionMult());
    }
    var started = false;
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) {
        if (e.isIntersecting && !started) { started = true; setTimeout(step, 900); io.disconnect(); }
      });
    }, { threshold: 0.3 });
    io.observe(term);
  }

  /* ---- scroll-driven pane split --------------------------------------
     Pane geometry is a pure function of scroll progress, but every write is
     coalesced into ONE requestAnimationFrame tick per frame (rather than the
     old time-throttle that fired off-frame and stuttered). Combined with
     `contain` on .sp in the CSS, the dividers track the cursor 1:1 and the
     rest of the page never reflows. */
  function initSplit() {
    var track = document.getElementById("splitTrack");
    var panes = document.getElementById("splitPanes");
    if (!track || !panes) return;
    var sps = [].slice.call(panes.querySelectorAll(".sp"));
    var steps = [].slice.call(document.querySelectorAll(".split-step"));
    var GAP = 0.6; // % seam between panes
    function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
    function smooth(t) { return t * t * (3 - 2 * t); } // eased phase ends, monotonic w/ scroll
    function set(sp, l, t, w, h, op) {
      var f = function (n) { return (Math.round(n * 1000) / 1000) + "%"; };
      sp.style.left = f(l); sp.style.top = f(t);
      sp.style.width = f(w); sp.style.height = f(h);
      sp.style.opacity = Math.round(op * 1000) / 1000;
      sp.style.pointerEvents = op > 0.05 ? "auto" : "none";
    }
    function render(p) {
      // phase A (0→.5): split right — pane0 100→50%, pane1 grows from the right
      // phase B (.5→1): split down  — pane1 100→50% tall, pane2 grows from bottom
      var a = smooth(clamp01(p / 0.5));
      var b = smooth(clamp01((p - 0.5) / 0.5));
      var w0 = 100 - 50 * a;                  // left column width
      var rx = w0 + (a > 0.001 ? GAP : 0);    // right column starts after a seam
      var rw = 100 - rx;
      var h1 = 100 - 50 * b;                  // top-right height
      var ty = h1 + (b > 0.001 ? GAP : 0);
      set(sps[0], 0, 0, w0, 100, 1);
      set(sps[1], rx, 0, rw, h1, a);
      set(sps[2], rx, ty, rw, 100 - ty, b);
      sps[0].classList.toggle("focused", a < 0.5);
      sps[1].classList.toggle("focused", a >= 0.5 && b < 0.5);
      sps[2].classList.toggle("focused", b >= 0.5);
      if (steps[0]) steps[0].classList.toggle("on", a > 0.03);
      if (steps[1]) steps[1].classList.toggle("on", b > 0.03);
    }
    function onScroll() {
      var r = track.getBoundingClientRect();
      var total = track.offsetHeight - window.innerHeight;
      var p = total <= 0 ? 0 : clamp01(-r.top / total);
      render(p);
    }
    var ticking = false;
    function requestTick() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; onScroll(); });
    }
    window.addEventListener("scroll", requestTick, { passive: true });
    window.addEventListener("resize", requestTick, { passive: true });
    onScroll();
  }

  /* ---- theme card quick-pick (syncs with Tweaks via event) ------------ */
  function initThemeCards() {
    document.querySelectorAll("[data-theme-pick]").forEach(function (card) {
      card.addEventListener("click", function () {
        var t = card.getAttribute("data-theme-pick");
        root.setAttribute("data-theme", t);
        window.dispatchEvent(new CustomEvent("lume:settheme", { detail: t }));
      });
    });
  }

  /* ---- copy install command ------------------------------------------- */
  function initCopy() {
    var btn = document.getElementById("copyBtn");
    if (!btn) return;
    function doCopy() {
      var text = "git clone https://github.com/rithwik1510/Workflow";
      var done = function () {
        btn.classList.add("done");
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function () {
          btn.classList.remove("done");
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else { done(); }
    }
    btn.addEventListener("click", doCopy);
    btn.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doCopy(); } });
  }

  /* ---- animated agent spinners (authentic per-agent glyph cycles) ----- */
  function initSpinner() {
    if (reduce) return;
    var frames = {
      cl: ["✻", "✶", "✳", "∗"],
      cx: ["◐", "◓", "◑", "◒"],
      gm: ["✦", "✧", "✶", "✧"]
    };
    var idx = 0;
    setInterval(function () {
      idx++;
      [].slice.call(document.querySelectorAll("[data-spin]")).forEach(function (el) {
        var f = frames[el.getAttribute("data-spin")] || frames.cl;
        el.textContent = f[idx % f.length];
      });
    }, 150);
  }

  function init() {
    initRise();
    initAgentStream();
    initSpinner();
    initSplit();
    initThemeCards();
    initCopy();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
