"use strict";

const openRows = new Set();
let resultId = "ia-kalshi";
let data = null;

const app = document.getElementById("app");
const stamp = document.getElementById("stamp");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function pageName() {
  const hash = (location.hash || "#markets").slice(1);
  return ["markets", "results", "research"].includes(hash) ? hash : "markets";
}

function callOf(fair) {
  if (fair == null || Number.isNaN(fair)) return { label: "—", tone: "toss" };
  let word = "Likely NO";
  let tone = "no";
  if (fair >= 78) { word = "Likely YES"; tone = "yes"; }
  else if (fair >= 56) { word = "Lean YES"; tone = "yes"; }
  else if (fair >= 46) { word = "Toss-up"; tone = "toss"; }
  else if (fair >= 22) { word = "Lean NO"; tone = "no"; }
  return { label: word + " (" + fair + "%)", tone };
}

function quoteFor(event, strike) {
  const live = data.prices && data.prices.events && data.prices.events[event.id]
    && data.prices.events[event.id].strikes
    && data.prices.events[event.id].strikes[strike.name];
  if (live && live.settled) {
    return { settled: live.settled, yesAsk: null, yesBid: null, from: "live" };
  }
  if (live && (live.yesAsk != null || live.yesBid != null)) {
    return { settled: null, yesAsk: live.yesAsk ?? null, yesBid: live.yesBid ?? null, from: "live" };
  }
  const snap = strike.snapshot || {};
  if (snap.settled) return { settled: snap.settled, yesAsk: null, yesBid: null, from: "snap" };
  return {
    settled: null,
    yesAsk: snap.yesAsk ?? null,
    yesBid: snap.yesBid ?? null,
    tradable: snap.tradable !== false,
    hit: !!snap.hit,
    from: "snap",
  };
}

function spreadOf(q) {
  if (q.yesAsk == null || q.yesBid == null) return null;
  return q.yesAsk - q.yesBid;
}

function wide(q) {
  const spread = spreadOf(q);
  return spread != null && spread >= 40;
}

function gapInfo(fair, q) {
  if (q.settled) return { text: "Settled " + q.settled, spot: null };
  if (q.hit && (q.yesAsk == null || q.yesAsk >= 99)) return { text: "Hit", spot: null };
  if (q.yesAsk == null && q.yesBid == null) return { text: "No quote", spot: null };
  if (wide(q)) {
    return { text: q.yesAsk + "% ask, " + q.yesBid + "% bid · spread " + spreadOf(q), spot: null };
  }
  if (q.from === "snap" && q.tradable === false) {
    if (q.yesAsk != null && q.yesBid != null) {
      return { text: q.yesAsk + "% ask, " + q.yesBid + "% bid · spread " + spreadOf(q), spot: null };
    }
    return { text: "Wide book", spot: null };
  }
  if (fair >= 56 && q.yesAsk != null && q.yesBid != null) {
    const gap = fair - q.yesAsk;
    const text = "YES ask " + q.yesAsk + " · gap " + gap;
    const spot = gap >= 12 && !wide(q) ? { side: "YES", gap, text } : null;
    return { text, spot };
  }
  if (fair <= 45 && q.yesBid != null && q.yesAsk != null) {
    const gap = q.yesBid - fair;
    const text = "NO ask " + (100 - q.yesBid) + " · gap " + gap;
    const spot = gap >= 12 && !wide(q) ? { side: "NO", gap, text } : null;
    return { text, spot };
  }
  if (q.yesAsk != null && q.yesBid != null) {
    return { text: q.yesAsk + "% ask, " + q.yesBid + "% bid · toss-up", spot: null };
  }
  if (q.yesAsk != null) return { text: "YES ask " + q.yesAsk, spot: null };
  return { text: "NO ask " + (100 - q.yesBid), spot: null };
}

function asks(q) {
  if (q.settled === "YES") return ["100", "0"];
  if (q.settled === "NO") return ["0", "100"];
  return [
    q.yesAsk == null ? "—" : String(q.yesAsk),
    q.yesBid == null ? "—" : String(100 - q.yesBid),
  ];
}

function fullySettled(event) {
  if (!event.strikes.length) return false;
  return event.strikes.every((strike) => quoteFor(event, strike).settled);
}

function whenText(event) {
  if (event.kind === "rally") return event.timeWita || "";
  const close = event.closeWita || event.timeWita || "";
  return close ? "closes " + close : "";
}

function platformLink(event) {
  return '<a href="' + esc(event.url) + '">' + esc(event.platform) + "</a>";
}

function scoreOf(fair, result) {
  if (!result || result === "Pending") return "Pending";
  if (fair >= 46 && fair <= 55) return "No call";
  const calledYes = fair >= 56;
  const wasYes = result === "YES";
  if (fair <= 45) return wasYes ? "Wrong" : "Right";
  return calledYes === wasYes ? "Right" : "Wrong";
}

function toneClass(result) {
  if (result === "YES" || result === "Right") return "yes";
  if (result === "NO" || result === "Wrong") return "no";
  return "toss";
}

function bestSpots(events) {
  const spots = [];
  events.forEach((event) => {
    if (fullySettled(event)) return;
    event.strikes.forEach((strike) => {
      const q = quoteFor(event, strike);
      const info = gapInfo(strike.fairYes, q);
      if (!info.spot) return;
      spots.push({ event, strike, q, ...info.spot, fair: strike.fairYes });
    });
  });
  spots.sort((a, b) => b.gap - a.gap || a.event.state.localeCompare(b.event.state) || a.strike.name.localeCompare(b.strike.name));
  return spots;
}

function renderMarkets() {
  const open = data.markets.events.filter((event) => !fullySettled(event));
  const spots = bestSpots(open);
  const rows = spots.map((spot) => {
    const call = callOf(spot.fair);
    return "<tr><td>" + platformLink(spot.event) + " · " + esc(spot.event.state)
      + " <span class='when'>(" + esc(whenText(spot.event)) + ")</span></td>"
      + "<td class='" + (spot.strike.nonstandard ? "odd" : "") + "'>" + esc(spot.strike.name) + "</td>"
      + "<td class='" + (spot.side === "YES" ? "yes" : "no") + "'>" + esc(spot.side) + "</td>"
      + "<td class='nowrap'>" + esc(spot.text) + "</td>"
      + "<td class='num " + call.tone + "'>" + esc(call.label) + "</td>"
      + "<td class='num'>" + esc(spot.gap) + "</td></tr>";
  }).join("");

  let html = "<h2>Best spots</h2>"
    + "<p class='note'>Gap of 12 or more. YES when fair is 56% or higher. NO when fair is 45% or lower. Books with a spread of 40 or more are left out. Sorted with the largest gap first. A very large gap means the saved fair and the live book are far apart.</p>"
    + "<div class='scroll card'><table><thead><tr>"
    + "<th>Event</th><th>Strike</th><th>Side</th><th>Price</th><th>Fair</th><th>Gap</th>"
    + "</tr></thead><tbody>"
    + (rows || "<tr><td colspan='6'>No spot clears the gap right now.</td></tr>")
    + "</tbody></table></div>";

  open.forEach((event) => {
    const strikes = event.strikes.slice().sort((a, b) => a.name.localeCompare(b.name));
    html += "<h2>" + esc(event.state) + " <span class='when'>" + esc(whenText(event)) + "</span></h2>";
    html += "<p class='kicker'>" + platformLink(event) + "</p>";
    html += "<div class='scroll'><table><thead><tr>"
      + "<th>Strike</th><th>YES ask</th><th>NO ask</th><th>Fair</th><th>Gap</th><th>Call</th><th>Hit rate</th><th>Context</th>"
      + "</tr></thead><tbody>";
    strikes.forEach((strike) => {
      const q = quoteFor(event, strike);
      const info = gapInfo(strike.fairYes, q);
      const call = callOf(strike.fairYes);
      const [yes, no] = asks(q);
      const key = event.id + "|" + strike.name;
      const odd = strike.nonstandard ? " odd" : "";
      html += "<tr class='main" + (openRows.has(key) ? " open" : "") + "' data-key='" + esc(key) + "'>"
        + "<td class='strike" + odd + "'>" + esc(strike.name) + "</td>"
        + "<td class='num'>" + esc(yes) + "</td>"
        + "<td class='num'>" + esc(no) + "</td>"
        + "<td class='num'>" + esc(strike.fairYes) + "%</td>"
        + "<td class='nowrap'>" + esc(info.text) + "</td>"
        + "<td class='" + call.tone + " nowrap'>" + esc(call.label) + "</td>"
        + "<td class='nowrap'>" + esc(strike.hitRate || "—") + "</td>"
        + "<td class='clip'>" + esc(strike.context || "") + "</td></tr>";
      if (openRows.has(key)) {
        const extra = strike.hitDetail && strike.hitDetail !== strike.hitRate
          ? "<div>Hit detail: " + esc(strike.hitDetail) + "</div>" : "";
        html += "<tr class='detail'><td colspan='8'>" + esc(strike.context || "No note.") + extra + "</td></tr>";
      }
    });
    html += "</tbody></table></div>";
  });

  const settled = data.markets.events.filter(fullySettled);
  if (settled.length) {
    html += "<p class='note'>Fully settled books moved to Results: "
      + settled.map((event) => esc(event.state) + " (" + esc(event.platform) + ")").join(", ")
      + ".</p>";
  }
  html += "<p class='note'>Yellow strike text is outside the usual template. Tap a row for the full note.</p>";
  return html;
}

function renderResults() {
  const events = data.results.events;
  if (!events.some((event) => event.id === resultId)) resultId = events[0].id;
  const current = events.find((event) => event.id === resultId);
  const counts = { Right: 0, Wrong: 0, "No call": 0, Pending: 0 };
  current.strikes.forEach((row) => { counts[row.score] = (counts[row.score] || 0) + 1; });

  let html = "<h2>Scorecard</h2><div class='pills'>";
  events.forEach((event) => {
    html += "<button type='button' data-result='" + esc(event.id) + "'"
      + (event.id === resultId ? " class='on'" : "") + ">"
      + esc(event.state) + " · " + esc(event.platform) + "</button>";
  });
  html += "</div>";
  html += "<p class='kicker'>" + platformLink(current) + " · " + esc(current.state)
    + " <span class='when'>" + esc(current.timeWita || "") + "</span></p>";
  html += "<p><strong>" + esc(current.tally) + "</strong></p>";
  if (current.summary) html += "<p class='note'>" + esc(current.summary) + "</p>";
  html += "<div class='scroll'><table><thead><tr>"
    + "<th>Strike</th><th>What happened</th><th>My call</th><th>Score</th><th>Reason</th>"
    + "</tr></thead><tbody>";
  current.strikes.forEach((row) => {
    html += "<tr><td>" + esc(row.name) + "</td>"
      + "<td class='" + toneClass(row.result) + "'>" + esc(row.result) + "</td>"
      + "<td>" + esc(row.call) + "</td>"
      + "<td class='" + toneClass(row.score) + "'>" + esc(row.score) + "</td>"
      + "<td>" + esc(row.reason || "") + "</td></tr>";
  });
  html += "</tbody></table></div>";

  const liveSettled = data.markets.events.filter(fullySettled);
  if (liveSettled.length) {
    html += "<h2>Settled since these notes</h2>";
    html += "<p class='note'>The book is settled. The call is the fair value from the notes. Right or wrong follows the same 56 / 45 rule.</p>";
    liveSettled.forEach((event) => {
      let right = 0, wrong = 0, none = 0;
      const body = event.strikes.slice().sort((a, b) => a.name.localeCompare(b.name)).map((strike) => {
        const settled = quoteFor(event, strike).settled;
        const score = scoreOf(strike.fairYes, settled);
        if (score === "Right") right += 1;
        else if (score === "Wrong") wrong += 1;
        else none += 1;
        return "<tr><td class='" + (strike.nonstandard ? "odd" : "") + "'>" + esc(strike.name) + "</td>"
          + "<td class='" + toneClass(settled) + "'>" + esc(settled === "YES" ? "Said" : "Not said") + "</td>"
          + "<td>" + esc(callOf(strike.fairYes).label) + "</td>"
          + "<td class='" + toneClass(score) + "'>" + esc(score) + "</td>"
          + "<td>" + esc(strike.context || "") + "</td></tr>";
      }).join("");
      html += "<h3>" + esc(event.state) + " · " + platformLink(event)
        + " <span class='when'>" + esc(event.timeWita || "") + "</span></h3>";
      html += "<p><strong>" + right + " right, " + wrong + " wrong, " + none + " no call</strong></p>";
      html += "<div class='scroll'><table><thead><tr>"
        + "<th>Strike</th><th>What happened</th><th>My call</th><th>Score</th><th>Reason</th>"
        + "</tr></thead><tbody>" + body + "</tbody></table></div>";
    });
  }
  return html;
}

function findEvent(id) {
  return data.markets.events.find((event) => event.id === id);
}

function renderResearch() {
  const countries = findEvent("nc");
  const companies = findEvent("nco");
  const fair = {};
  (countries ? countries.strikes : []).forEach((strike) => { fair[strike.name] = strike; });

  let html = "<h2>November countries</h2>";
  html += "<p class='note'>" + esc(data.research.novemberRules || "") + "</p>";
  html += "<p class='note'>Hit rate is months said, then rallies said. Yellow is outside the usual country list. The trading book for these strikes is on Markets.</p>";
  if (countries) {
    html += "<div class='scroll'><table><thead><tr><th>Strike</th><th>Fair</th><th>Hit rate</th><th>Calendar</th><th>Note</th></tr></thead><tbody>";
    countries.strikes.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((strike) => {
      const hits = (data.research.diplomacy || []).filter((row) => (row.strikes || []).includes(strike.name));
      html += "<tr><td class='" + (strike.nonstandard ? "odd" : "") + "'>" + esc(strike.name) + "</td>"
        + "<td class='num'>" + esc(strike.fairYes) + "%</td>"
        + "<td class='nowrap'>" + esc(strike.hitRate) + "</td>"
        + "<td>" + esc(hits.map((row) => row.when).join(" · ") || "—") + "</td>"
        + "<td>" + esc(strike.context || "") + "</td></tr>";
    });
    html += "</tbody></table></div>";
  }

  html += "<h2>November companies</h2>";
  if (companies) {
    html += "<div class='scroll'><table><thead><tr><th>Strike</th><th>Fair</th><th>Hit rate</th><th>Note</th></tr></thead><tbody>";
    companies.strikes.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((strike) => {
      html += "<tr><td>" + esc(strike.name) + "</td>"
        + "<td class='num'>" + esc(strike.fairYes) + "%</td>"
        + "<td class='nowrap'>" + esc(strike.hitRate) + "</td>"
        + "<td>" + esc(strike.context || "") + "</td></tr>";
    });
    html += "</tbody></table></div>";
  }

  html += "<h2>Diplomacy list</h2>";
  html += "<p class='note'>" + esc(data.research.diplomacyNote || "") + "</p>";
  html += "<div class='scroll'><table><thead><tr><th>When (WITA)</th><th>Item</th><th>Status</th><th>Country strikes</th></tr></thead><tbody>";
  (data.research.diplomacy || []).forEach((row) => {
    const bits = (row.strikes || []).map((name) => {
      const strike = fair[name];
      return name + (strike ? " " + strike.fairYes : "");
    });
    html += "<tr><td class='nowrap'>" + esc(row.when) + "</td><td>" + esc(row.item) + "</td><td>" + esc(row.status) + "</td><td>"
      + esc(bits.join(" · ") || row.feeds || "") + "</td></tr>";
  });
  html += "</tbody></table></div>";

  html += "<h2>State keywords</h2>";
  html += "<p class='note'>" + esc(data.research.keywordNote || "") + "</p>";
  (data.research.keywords || []).forEach((box) => {
    html += "<div class='card box'><h3>" + esc(box.state)
      + (box.upcoming ? "<span class='tag'>Upcoming in the notes</span>" : "") + "</h3>";
    box.groups.forEach((group) => {
      html += "<p><strong>" + esc(group.group) + ".</strong> " + esc(group.line) + "</p>";
    });
    html += "</div>";
  });

  html += "<h2>Coming up</h2><div class='scroll'><table><thead><tr><th>When (WITA)</th><th>Event</th><th>Likely words</th></tr></thead><tbody>";
  (data.research.comingEvents || []).forEach((row) => {
    const name = row.url ? "<a href='" + esc(row.url) + "'>" + esc(row.event) + "</a>" : esc(row.event);
    html += "<tr><td class='nowrap'>" + esc(row.when) + "</td><td>" + name + "</td><td>" + esc(row.words) + "</td></tr>";
  });
  html += "</tbody></table></div>";

  html += "<h2>Fresh hooks</h2><ul>";
  (data.research.freshHooks || []).forEach((line) => { html += "<li>" + esc(line) + "</li>"; });
  html += "</ul>";

  html += "<h2>Other notes</h2>";
  if (data.research.weeklyBestSpotNote) html += "<p>" + esc(data.research.weeklyBestSpotNote) + "</p>";
  if (data.research.weeklyOlderNote) html += "<p class='note'>" + esc(data.research.weeklyOlderNote) + "</p>";
  if (data.research.weeklyWindowNote) html += "<p>" + esc(data.research.weeklyWindowNote) + "</p>";
  html += "<h3>Rock Hill</h3><ul>";
  (data.research.rockHillNotes || []).forEach((line) => { html += "<li>" + esc(line) + "</li>"; });
  html += "</ul>";
  html += "<h3>How the fair values were set</h3><ul>";
  ((data.research.method && data.research.method.rallies) || []).forEach((line) => { html += "<li>" + esc(line) + "</li>"; });
  ((data.research.method && data.research.method.weekly) || []).forEach((line) => { html += "<li>" + esc(line) + "</li>"; });
  html += "</ul>";

  html += "<h2>Closed books</h2><p class='note'>Kept so the numbers are not dropped. They are not on Markets.</p>";
  (data.research.closedMarkets || []).forEach((event) => {
    html += "<details><summary>" + esc(event.state) + " · " + esc(event.platform) + " · " + esc(event.closeWita || "") + "</summary>";
    html += "<p class='note'>" + esc(event.feeds || "") + "</p>";
    html += "<div class='scroll'><table><thead><tr><th>Strike</th><th>Fair</th><th>Hit rate</th><th>Note</th></tr></thead><tbody>";
    event.strikes.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((strike) => {
      html += "<tr><td>" + esc(strike.name) + "</td><td class='num'>" + esc(strike.fairYes) + "%</td><td>"
        + esc(strike.hitRate || "—") + "</td><td>" + esc(strike.context || "") + "</td></tr>";
    });
    html += "</tbody></table></div></details>";
  });
  return html;
}

function render() {
  document.querySelectorAll("nav button").forEach((button) => {
    button.classList.toggle("on", button.dataset.page === pageName());
  });
  if (!data) {
    app.innerHTML = "<p>Loading…</p>";
    return;
  }
  if (data.prices && data.prices.updatedLabel) {
    stamp.textContent = "Prices updated " + data.prices.updatedLabel;
  } else {
    stamp.textContent = "Prices not loaded yet. Showing the saved book.";
  }
  if (pageName() === "results") app.innerHTML = renderResults();
  else if (pageName() === "research") app.innerHTML = renderResearch();
  else app.innerHTML = renderMarkets();
}

document.querySelector("nav").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  location.hash = button.dataset.page;
});

app.addEventListener("click", (event) => {
  const resultButton = event.target.closest("button[data-result]");
  if (resultButton) {
    resultId = resultButton.dataset.result;
    render();
    return;
  }
  if (event.target.closest("a")) return;
  const row = event.target.closest("tr[data-key]");
  if (!row) return;
  const key = row.dataset.key;
  if (openRows.has(key)) openRows.delete(key);
  else openRows.add(key);
  render();
});

window.addEventListener("hashchange", render);

Promise.all([
  fetch("data/markets.json").then((res) => res.json()),
  fetch("data/results.json").then((res) => res.json()),
  fetch("data/research.json").then((res) => res.json()),
  fetch("data/prices.json", { cache: "no-cache" }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
]).then(([markets, results, research, prices]) => {
  data = { markets, results, research, prices };
  if (!location.hash) location.hash = "markets";
  render();
}).catch((err) => {
  stamp.textContent = "Could not load the notes.";
  app.innerHTML = "<p>" + esc(err.message) + "</p>";
});
