/* Lume site — command palette (Ctrl/⌘+K).
   A keyboard-first site for a keyboard-first app: jump anywhere, switch
   themes, grab the clone command — without touching the mouse. */

export function initPalette() {
  const overlay = document.getElementById("palOverlay");
  if (!overlay) return;
  const input = overlay.querySelector("#palInput");
  const list = overlay.querySelector("#palList");

  const go = (sel) => { document.querySelector(sel)?.scrollIntoView({ behavior: "smooth" }); };
  const theme = (t) => {
    // dispatch only after the attribute lands — view transitions apply it async
    const apply = () => {
      document.documentElement.setAttribute("data-theme", t);
      window.dispatchEvent(new CustomEvent("lume:settheme", { detail: t }));
    };
    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(apply);
    } else apply();
  };

  const ITEMS = [
    { k: "go", label: "Go to — Hero", hint: "section", act: () => go("#top") },
    { k: "go", label: "Go to — Smoothness", hint: "section", act: () => go("#smoothness") },
    { k: "go", label: "Go to — Tiling", hint: "section", act: () => go("#split") },
    { k: "go", label: "Go to — Markdown", hint: "section", act: () => go("#markdown") },
    { k: "go", label: "Go to — Keyboard", hint: "section", act: () => go("#keyboard") },
    { k: "go", label: "Go to — Themes", hint: "section", act: () => go("#themes") },
    { k: "theme", label: "Theme — Cobalt", hint: "default", act: () => theme("cobalt") },
    { k: "theme", label: "Theme — Coral", hint: "theme", act: () => theme("coral") },
    { k: "theme", label: "Theme — Tokyo Night", hint: "theme", act: () => theme("tokyo") },
    { k: "theme", label: "Theme — Gruvbox", hint: "theme", act: () => theme("gruvbox") },
    { k: "dl", label: "Download Lume for Windows", hint: "↓ exe", act: () => { window.location.href = "/download"; } },
    { k: "gh", label: "Open GitHub repository", hint: "↗", act: () => window.open("https://github.com/rithwik1510/Workflow", "_blank") },
    {
      k: "cp", label: "Copy git clone command", hint: "clipboard",
      act: () => navigator.clipboard?.writeText("git clone https://github.com/rithwik1510/Workflow"),
    },
  ];

  let open = false;
  let filtered = ITEMS;
  let active = 0;

  function render() {
    list.innerHTML = "";
    filtered.forEach((it, i) => {
      const li = document.createElement("li");
      li.className = "pal-item" + (i === active ? " act" : "");
      li.innerHTML = `<span class="pl">${it.label}</span><span class="ph">${it.hint}</span>`;
      li.addEventListener("click", () => { exec(it); });
      li.addEventListener("pointerenter", () => { active = i; paint(); });
      list.appendChild(li);
    });
    if (!filtered.length) {
      const li = document.createElement("li");
      li.className = "pal-empty";
      li.textContent = "no match — try “theme”, “download”, “tiling”…";
      list.appendChild(li);
    }
  }
  function paint() {
    [...list.children].forEach((li, i) => li.classList.toggle("act", i === active));
  }
  function filter() {
    const q = input.value.trim().toLowerCase();
    filtered = !q ? ITEMS : ITEMS.filter((it) => (it.label + " " + it.k).toLowerCase().includes(q));
    active = 0;
    render();
  }
  function exec(it) { close(); setTimeout(() => it.act(), 60); }

  function show() {
    open = true;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("in"));
    input.value = ""; filter(); input.focus();
  }
  function close() {
    open = false;
    overlay.classList.remove("in");
    setTimeout(() => { overlay.hidden = true; }, 180);
  }

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      open ? close() : show();
      return;
    }
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(filtered.length - 1, active + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) exec(filtered[active]); }
  });
  input.addEventListener("input", filter);
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(); });

  // the nav hint chip opens it too
  document.getElementById("palHint")?.addEventListener("click", show);
}
