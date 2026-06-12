/* Lume site — orchestrator.
   Static HTML paints first; everything below hydrates progressively and
   collapses gracefully under prefers-reduced-motion. */
import { initHeroTerms } from "./terms.js";
import { initConstellation, initScramble, initWordRise, initSparks, initStatusbar, initCtaPrompt } from "./effects.js";
import { initPalette } from "./palette.js";
import { initKeysDemo } from "./keys.js";
import { initMdLive } from "./mdlive.js";

(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;

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

  /* ---- scroll-driven pane split ----------------------------------------
     Geometry is a pure function of scroll progress; writes are coalesced
     into one rAF tick per frame. `contain` on .sp keeps the rest of the
     page from ever reflowing. */
  function initSplit() {
    var track = document.getElementById("splitTrack");
    var panes = document.getElementById("splitPanes");
    if (!track || !panes) return;
    var sps = [].slice.call(panes.querySelectorAll(".sp"));
    var steps = [].slice.call(document.querySelectorAll(".split-step"));
    var GAP = 0.6; // % seam between panes
    function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function set(sp, l, t, w, h, op) {
      var f = function (n) { return (Math.round(n * 1000) / 1000) + "%"; };
      sp.style.left = f(l); sp.style.top = f(t);
      sp.style.width = f(w); sp.style.height = f(h);
      sp.style.opacity = Math.round(op * 1000) / 1000;
      sp.style.pointerEvents = op > 0.05 ? "auto" : "none";
    }
    var wasOn = [false, false];
    function press(i) {
      // keycap physically depresses the moment its split fires
      var k = steps[i] && steps[i].querySelector(".k");
      if (!k) return;
      k.classList.add("press");
      setTimeout(function () { k.classList.remove("press"); }, 420);
    }
    function render(p) {
      var a = smooth(clamp01(p / 0.5));
      var b = smooth(clamp01((p - 0.5) / 0.5));
      var w0 = 100 - 50 * a;
      var rx = w0 + (a > 0.001 ? GAP : 0);
      var rw = 100 - rx;
      var h1 = 100 - 50 * b;
      var ty = h1 + (b > 0.001 ? GAP : 0);
      set(sps[0], 0, 0, w0, 100, 1);
      set(sps[1], rx, 0, rw, h1, a);
      set(sps[2], rx, ty, rw, 100 - ty, b);
      sps[0].classList.toggle("focused", a < 0.5);
      sps[1].classList.toggle("focused", a >= 0.5 && b < 0.5);
      sps[2].classList.toggle("focused", b >= 0.5);
      var on0 = a > 0.03, on1 = b > 0.03;
      if (steps[0]) steps[0].classList.toggle("on", on0);
      if (steps[1]) steps[1].classList.toggle("on", on1);
      if (on0 && !wasOn[0]) press(0);
      if (on1 && !wasOn[1]) press(1);
      wasOn = [on0, on1];
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

  /* ---- theme cards: re-theme the whole page (terminals included) ------- */
  function setTheme(t) {
    // dispatch only after the attribute lands — view transitions apply it async
    var apply = function () {
      root.setAttribute("data-theme", t);
      window.dispatchEvent(new CustomEvent("lume:settheme", { detail: t }));
    };
    if (document.startViewTransition && !reduce) document.startViewTransition(apply);
    else apply();
  }
  function initThemeCards() {
    document.querySelectorAll("[data-theme-pick]").forEach(function (card) {
      card.addEventListener("click", function () {
        setTheme(card.getAttribute("data-theme-pick"));
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

  function init() {
    initRise();
    initWordRise();
    initScramble();
    initConstellation();
    initHeroTerms();
    initSplit();
    initMdLive();
    initKeysDemo();
    initThemeCards();
    initSparks();
    initPalette();
    initStatusbar();
    initCtaPrompt();
    initCopy();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
