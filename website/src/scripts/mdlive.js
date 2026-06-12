/* Lume site — live markdown demo.
   The product loop, shown not told: an agent streams raw markdown into
   PLAN.md on the left; the right side renders it as it lands. Then the
   agent "works the plan" and the checkboxes tick themselves. */

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));

/* each block: src = colored source segments to type; html = what it renders to */
const BLOCKS = [
  {
    src: [["mk", "# "], ["tx", "Auth refactor — plan"]],
    html: `<h4>Auth refactor — plan</h4>`,
  },
  {
    src: [["dim", "_written by Claude Code · 14:02_"]],
    html: `<div class="meta">written by Claude Code · 14:02</div>`,
  },
  {
    src: [["tx", "Move session handling onto the token store so logins survive restarts."]],
    html: `<p>Move session handling onto the token store so logins survive restarts.</p>`,
  },
  {
    src: [["mk", "- [x] "], ["tx", "read the current session flow"]],
    html: `<div class="task done" data-task><span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span>read the current session flow</span></div>`,
  },
  {
    src: [["mk", "- [x] "], ["tx", "swap localStorage for tokenStore"]],
    html: `<div class="task done" data-task><span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span>swap localStorage for tokenStore</span></div>`,
  },
  {
    src: [["mk", "- [ ] "], ["tx", "add refresh() with a retry budget"]],
    html: `<div class="task" data-task="open"><span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="opacity:0"><polyline points="20 6 9 17 4 12"/></svg></span><span>add refresh() with a retry budget</span></div>`,
  },
  {
    src: [["mk", "- [ ] "], ["tx", "run the suite — all green before merge"]],
    html: `<div class="task" data-task="open"><span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="opacity:0"><polyline points="20 6 9 17 4 12"/></svg></span><span>run the suite — all green before merge</span></div>`,
  },
];

export function initMdLive() {
  const wrap = document.getElementById("mdLive");
  if (!wrap) return;
  const src = wrap.querySelector("#mdSrc");
  const view = wrap.querySelector("#mdView");
  const replay = wrap.querySelector("#mdReplay");
  const status = wrap.querySelector("#mdStatus");
  let running = false;

  async function typeBlock(block, lineNo) {
    const row = document.createElement("div");
    row.className = "cr";
    row.innerHTML = `<span class="no">${lineNo}</span><span class="bd"></span>`;
    src.appendChild(row);
    const bd = row.querySelector(".bd");
    for (const [cls, text] of block.src) {
      const span = document.createElement("span");
      span.className = cls;
      bd.appendChild(span);
      for (const ch of text) {
        span.textContent += ch;
        await sleep(14 + Math.random() * 22);
      }
    }
    src.scrollTop = src.scrollHeight;
  }

  function renderBlock(block) {
    const tpl = document.createElement("template");
    tpl.innerHTML = block.html.trim();
    const node = tpl.content.firstChild;
    node.classList.add("mdl-in");
    view.appendChild(node);
    requestAnimationFrame(() => node.classList.add("on"));
    view.scrollTop = view.scrollHeight;
  }

  async function run() {
    if (running) return;
    running = true;
    src.innerHTML = ""; view.innerHTML = "";
    if (status) status.textContent = "agent writing…";
    let line = 1;
    for (const block of BLOCKS) {
      await typeBlock(block, line++);
      renderBlock(block);
      await sleep(300);
      // blank source line between blocks (like real markdown)
      const gap = document.createElement("div");
      gap.className = "cr";
      gap.innerHTML = `<span class="no">${line++}</span><span class="bd"></span>`;
      src.appendChild(gap);
    }
    /* …the agent works the plan: open tasks tick themselves */
    if (status) status.textContent = "agent working…";
    await sleep(1300);
    const open = view.querySelectorAll('[data-task="open"]');
    let srcRows = src.querySelectorAll(".cr .bd .mk");
    for (let i = 0; i < open.length; i++) {
      const t = open[i];
      t.classList.add("done");
      t.querySelector("svg").style.opacity = "1";
      // flip the source too: - [ ] → - [x]
      const mk = [...srcRows].filter((s) => s.textContent.includes("- [ ]"))[0];
      if (mk) mk.textContent = mk.textContent.replace("- [ ]", "- [x]");
      await sleep(1100);
    }
    if (status) status.textContent = "plan complete ✓";
    running = false;
  }

  replay?.addEventListener("click", run);
  const io = new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      run();
    });
  }, { threshold: 0.35 });
  io.observe(wrap);
}
