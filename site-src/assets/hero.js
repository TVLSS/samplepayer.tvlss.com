// Home-page specimen: a scripted conversation that plays itself (no API calls),
// so the first thing a visitor sees is the product doing its job.
(function () {
  var root = document.querySelector(".specimen"); if (!root) return;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var chat = root.querySelector(".spec-flow"); var rows = root.querySelectorAll(".spec-ledger .row");
  var script = [
    { t: "user", text: "How close is my family to the deductible, and what would a $2,000 procedure cost me?" },
    { t: "call", row: 0 }, { t: "call", row: 1 }, { t: "done", row: 0, res: "family: $2,015 of $3,000" }, { t: "done", row: 1, res: "member: $704 estimated" },
    { t: "agent", text: "You're $985 short of the $3,000 family deductible, and you personally have $380 to go. A $2,000 procedure would cost you about $704: the $380 remaining deductible, then 20% of the rest. The plan pays the other $1,296." },
  ];
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduce ? 0 : ms); }); }
  async function type(node, text) {
    if (reduce) { node.textContent = text; return; }
    var caret = el("span", "caret"); node.appendChild(caret);
    for (var i = 0; i < text.length; i++) { caret.before(document.createTextNode(text[i])); await wait(text[i] === "." || text[i] === ":" ? 120 : 14); }
    caret.remove();
  }
  async function play() {
    chat.innerHTML = ""; rows.forEach(function (r) { r.classList.remove("on", "done"); r.querySelector(".res").textContent = ""; });
    await wait(600);
    for (var i = 0; i < script.length; i++) {
      var s = script[i];
      if (s.t === "user") { var b = el("div", "bubble user", s.text); chat.appendChild(b); await wait(30); b.classList.add("show"); await wait(900); }
      else if (s.t === "call") { rows[s.row].classList.add("on"); await wait(700); }
      else if (s.t === "done") { rows[s.row].classList.add("done"); rows[s.row].querySelector(".res").textContent = s.res; await wait(500); }
      else if (s.t === "agent") { var a = el("div", "bubble agent"); chat.appendChild(a); a.classList.add("show"); await type(a, s.text); }
    }
    await wait(7000); if (!reduce) play();
  }
  play();
})();
