// Chat + ledger for one demo agent. Plain JS, no build step.
// Talks to POST /api/chat (same origin, NDJSON stream). The x-amz-content-sha256
// header is required because CloudFront signs the request to the Lambda URL.
(function () {
  var root = document.querySelector("[data-agent]");
  if (!root) return;
  var agentId = root.getAttribute("data-agent");
  var transcript = root.querySelector(".transcript");
  var form = root.querySelector(".composer");
  var input = form.querySelector("textarea");
  var send = form.querySelector("button[type=submit]");
  var entries = document.querySelector(".entries");
  var counter = document.querySelector(".ledger-head span");
  var chips = document.querySelectorAll(".systems-list .chip");
  var budgetEl = root.querySelector(".chat-tools .budget");
  function showBudget(b) { if (budgetEl && b && typeof b.spent === "number") budgetEl.textContent = "Today $" + b.spent.toFixed(2) + " of $" + b.cap; }
  fetch("/api/budget").then(function (r) { return r.ok ? r.json() : null; }).then(showBudget).catch(function () {});
  var history = [];
  var busy = false;
  var turn = 0;
  var callCount = 0;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function scrollBottom() { transcript.scrollTop = transcript.scrollHeight; }

  // Minimal renderer: paragraphs, "- " bullets, **bold**.
  function render(container, text) {
    container.innerHTML = "";
    var blocks = text.replace(/\r/g, "").split(/\n{2,}/);
    blocks.forEach(function (block) {
      var lines = block.split("\n");
      var isList = lines.length > 0 && lines.every(function (l) { return /^\s*[-•]\s+/.test(l) || !l.trim(); });
      if (isList) {
        var ul = el("ul");
        lines.forEach(function (l) { if (l.trim()) { var li = el("li"); li.innerHTML = inline(l.replace(/^\s*[-•]\s+/, "")); ul.appendChild(li); } });
        container.appendChild(ul);
      } else {
        var p = el("p"); p.innerHTML = inline(lines.join("<br>")); container.appendChild(p);
      }
    });
  }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function inline(s) { return esc(s).replace(/&lt;br&gt;/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"); }

  async function sha256Hex(str) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  function addLedger(ev) {
    var empty = entries.querySelector(".empty"); if (empty) empty.remove();
    if (ev.type === "turn") { entries.appendChild(el("div", "entry turn", "Turn " + ev.n + " · " + ev.text)); entries.scrollTop = entries.scrollHeight; return; }
    var e = el("div", "entry pending" + (ev.kind === "write" ? " write" : ""));
    e.dataset.id = ev.id;
    e.appendChild(el("div", "name", ev.name));
    e.appendChild(el("div", "sys", ev.system.replace(/_/g, " ").toLowerCase()));
    e.appendChild(el("div", "res", "…"));
    var d = el("details"); d.appendChild(el("summary", null, "input")); var pre = el("pre", null, JSON.stringify(ev.input, null, 1)); d.appendChild(pre); e.appendChild(d);
    entries.appendChild(e);
    entries.scrollTop = entries.scrollHeight;
    callCount++; counter.textContent = callCount + (callCount === 1 ? " call" : " calls");
    chips.forEach(function (c) { if (c.dataset.system === ev.system) c.classList.add("lit"); });
  }
  function resolveLedger(ev) {
    var e = entries.querySelector('[data-id="' + ev.id + '"]'); if (!e) return;
    e.classList.remove("pending");
    var res = e.querySelector(".res"); res.textContent = ev.summary + " · " + ev.ms + " ms"; if (!ev.ok) res.classList.add("err");
    var d = el("details"); d.appendChild(el("summary", null, "result")); d.appendChild(el("pre", null, JSON.stringify(ev.output, null, 1))); e.appendChild(d);
  }

  async function ask(text) {
    if (busy || !text.trim()) return;
    busy = true; send.disabled = true; input.value = ""; autosize();
    turn++;
    var u = el("div", "msg user", text); transcript.appendChild(u);
    history.push({ role: "user", content: text });
    var a = el("div", "msg agent"); var working = el("span", "working", "Looking that up"); a.appendChild(working); transcript.appendChild(a); scrollBottom();
    addLedger({ type: "turn", n: turn, text: text.length > 60 ? text.slice(0, 57) + "…" : text });
    var full = ""; var cursor = el("span", "cursor");
    try {
      var body = JSON.stringify({ agent: agentId, messages: history });
      var res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-amz-content-sha256": await sha256Hex(body) }, body: body });
      if (!res.ok || !res.body) { var err; try { err = (await res.json()).error; } catch (_) {} throw new Error(err || ("Request failed (" + res.status + ")")); }
      var reader = res.body.getReader(); var dec = new TextDecoder(); var buf = "";
      while (true) {
        var chunk = await reader.read(); if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var lines = buf.split("\n"); buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          var ev = JSON.parse(lines[i]);
          if (ev.type === "text") { if (working.parentNode) working.remove(); full += ev.delta; render(a, full); a.appendChild(cursor); scrollBottom(); }
          else if (ev.type === "tool_call") { working.textContent = "Checking " + ev.system.replace(/_/g, " ").toLowerCase(); addLedger(ev); }
          else if (ev.type === "tool_result") resolveLedger(ev);
          else if (ev.type === "error") { throw new Error(ev.message); }
          else if (ev.type === "done") { addLedger({ type: "turn", n: turn, text: ev.usage.inputTokens + " in / " + ev.usage.outputTokens + " out tokens" }); showBudget(ev.budget); }
        }
      }
      if (cursor.parentNode) cursor.remove();
      if (!full.trim()) { full = "I didn't get a reply back. Try again."; render(a, full); }
      history.push({ role: "assistant", content: full });
    } catch (e) {
      if (working.parentNode) working.remove(); if (cursor.parentNode) cursor.remove();
      a.classList.add("err"); render(a, (e && e.message) || "Something went wrong. Try again.");
      history.pop();
    } finally { busy = false; send.disabled = false; input.focus(); scrollBottom(); }
  }

  function autosize() { input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("submit", function (e) { e.preventDefault(); ask(input.value); });
  document.querySelectorAll(".samples button").forEach(function (b) { b.addEventListener("click", function () { ask(b.textContent); }); });
  var reset = document.querySelector(".chat-tools button");
  if (reset) reset.addEventListener("click", function () {
    history = []; turn = 0; callCount = 0; counter.textContent = "";
    transcript.innerHTML = ""; transcript.appendChild(el("div", "msg agent", root.getAttribute("data-greeting")));
    entries.innerHTML = ""; entries.appendChild(el("div", "empty", "System calls the agent makes will appear here as they happen."));
    chips.forEach(function (c) { c.classList.remove("lit"); });
  });
})();
