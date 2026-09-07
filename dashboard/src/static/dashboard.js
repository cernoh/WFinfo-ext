/**
 * Warframe Info dashboard — client behaviour (progressive enhancement).
 * - Logs page: re-fetch /api/logs every 3s and re-render the list, with a
 *   client-side text filter that survives refreshes.
 * - Recently seen page: re-fetch /api/reward-events and /api/ocr-runs every
 *   10s and re-render the two card lists.
 *
 * Polling pauses while the tab is hidden. All dynamic text is escaped.
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function fmtMs(ms) {
    return new Date(ms).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function tag(text, colour) {
    return '<strong class="govuk-tag govuk-tag--' + colour + '">' + esc(text) +
      "</strong>";
  }

  function tokenChip(t, extraNote) {
    var label = t.slug
      ? '<a class="wf-chip govuk-link" href="/wfmarket/' + esc(t.slug) + '">' +
        esc(t.name) + "</a>"
      : '<span class="wf-chip wf-chip--plain">' + esc(t.name) + "</span>";
    var values = [];
    if (t.plat !== null && t.plat !== undefined) {
      values.push(esc(String(t.plat)) + " plat");
    }
    if (t.ducats !== null && t.ducats !== undefined) {
      values.push(esc(String(t.ducats)) + " ducats");
    }
    var note = values.length > 0
      ? ' <span class="wf-chip__values">(' + values.join(" &middot; ") +
        ")</span>"
      : "";
    return '<li class="wf-rewards__item">' + label + note +
      (extraNote || "") + "</li>";
  }

  function timeHtml(ms, fallback) {
    var inner = ms ? esc(fmtMs(ms)) : esc(fallback || "unknown time");
    return '<time class="govuk-body-s wf-muted" datetime="' +
      (ms ? new Date(ms).toISOString() : "") + '">' + inner + "</time>";
  }

  function fetchJson(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(
      function (resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.json();
      },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Logs                                                                */
  /* ------------------------------------------------------------------ */

  var logList = null;
  var logMeta = null;
  var logFilterInput = null;
  var logTimer = null;
  var logFilterValue = "";

  function applyLogFilter() {
    if (!logList) return;
    var needle = logFilterValue.trim().toLowerCase();
    var items = logList.querySelectorAll(".wf-logline");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle(
        "wf-hidden",
        needle.length > 0 &&
          items[i].textContent.toLowerCase().indexOf(needle) === -1,
      );
    }
  }

  function renderLogLines(lines, updatedAtMs, total) {
    var html = "";
    for (var i = 0; i < lines.length; i++) {
      html += '<li class="wf-logline">' + esc(lines[i]) + "</li>";
    }
    logList.innerHTML = html;
    if (logMeta) {
      logMeta.textContent = "Showing " + lines.length + " of " + total +
        " lines · updated " + fmtMs(updatedAtMs);
    }
    applyLogFilter();
  }

  function scheduleLogPoll(delayMs) {
    if (logTimer) clearTimeout(logTimer);
    logTimer = setTimeout(pollLogs, delayMs);
  }

  function pollLogs() {
    fetchJson("/api/logs").then(function (data) {
      renderLogLines(data.lines, data.updatedAt, data.total);
      scheduleLogPoll(3000);
    }).catch(function () {
      if (logMeta) {
        logMeta.textContent += " · update failed, retrying…";
      }
      scheduleLogPoll(5000);
    });
  }

  function initLogs() {
    logList = $("wf-log-list");
    if (!logList) return;
    logMeta = $("wf-log-meta");
    logFilterInput = $("wf-log-filter");
    if (logFilterInput) {
      logFilterInput.addEventListener("input", function () {
        logFilterValue = logFilterInput.value;
        applyLogFilter();
      });
    }
    document.addEventListener("visibilitychange", function () {
      if (logTimer) {
        clearTimeout(logTimer);
        logTimer = null;
      }
      if (!document.hidden) scheduleLogPoll(500);
    });
    scheduleLogPoll(3000);
  }

  /* ------------------------------------------------------------------ */
  /* Recently seen                                                       */
  /* ------------------------------------------------------------------ */

  var recentTimer = null;

  function rewardCard(r, index) {
    var items = "";
    for (var i = 0; i < r.rewards.length; i++) {
      var chosenNote = i === r.chosen ? " " + tag("Chosen", "blue") : "";
      items += tokenChip(r.rewards[i], chosenNote);
    }
    return '<article class="wf-card"><div class="wf-card__head">' +
      '<h2 class="govuk-heading-s govuk-!-margin-bottom-0">Reward screen ' +
      (index + 1) + "</h2>" + timeHtml(r.ts, r.tsText) + "</div>" +
      '<ul class="govuk-list wf-rewards">' + items + "</ul></article>";
  }

  function runScenarioRow(s) {
    var parts = "";
    if (s.parts.length > 0) {
      var chips = "";
      for (var i = 0; i < s.parts.length; i++) {
        chips += tokenChip(s.parts[i]);
      }
      parts =
        '<p class="govuk-body-s wf-muted wf-!-no-margin-bottom">Recognized parts</p>' +
        '<ul class="govuk-list wf-rewards">' + chips + "</ul>";
    }
    var problems = [];
    if (s.missing.length > 0) problems.push("missing: " + s.missing.join(", "));
    if (s.extra.length > 0) problems.push("unexpected: " + s.extra.join(", "));
    var problemLine = problems.length > 0
      ? '<p class="govuk-body-s wf-err">' + esc(problems.join(" · ")) + "</p>"
      : "";
    var errorLine = s.errorMessage
      ? '<p class="govuk-body-s wf-muted">' + esc(s.errorMessage) + "</p>"
      : "";
    return '<li class="wf-run-scenario"><div class="wf-card__head">' +
      '<h3 class="govuk-heading-s govuk-!-margin-bottom-0">' + esc(s.name) +
      "</h3>" + (s.success ? tag("Pass", "green") : tag("Fail", "red")) +
      '<span class="govuk-body-s wf-muted">' +
      Number(s.accuracy).toFixed(1) + "% accuracy</span></div>" + parts +
      problemLine + errorLine + "</li>";
  }

  function runCard(r) {
    var scenarios = "";
    for (var i = 0; i < r.scenarios.length; i++) {
      scenarios += runScenarioRow(r.scenarios[i]);
    }
    return '<article class="wf-card"><div class="wf-card__head">' +
      '<h2 class="govuk-heading-s govuk-!-margin-bottom-0">' + esc(r.suite) +
      "</h2>" + timeHtml(r.startedMs, null) + "</div>" +
      '<p class="govuk-body-s wf-muted wf-!-no-margin-bottom">' + r.passed +
      "/" +
      r.total + " scenarios passed (" + Number(r.accuracy).toFixed(1) +
      "% accuracy)" + (r.errors > 0 ? " · " + r.errors + " errored" : "") +
      " · " + esc(r.fileName) + "</p>" +
      '<ul class="govuk-list wf-run-list">' + scenarios + "</ul></article>";
  }

  function scheduleRecentPoll(delayMs) {
    if (recentTimer) clearTimeout(recentTimer);
    recentTimer = setTimeout(pollRecent, delayMs);
  }

  function pollRecent() {
    var rewardsEl = $("wf-rewards");
    var runsEl = $("wf-runs");
    if (!rewardsEl && !runsEl) return;
    var rewardCount = $("wf-reward-count");
    var runCount = $("wf-run-count");
    var rewardsEmpty = $("wf-rewards-empty");
    var runsEmpty = $("wf-runs-empty");
    Promise.all([
      rewardsEl
        ? fetchJson("/api/reward-events").then(function (data) {
          var html = "";
          for (var i = 0; i < data.rewards.length; i++) {
            html += rewardCard(data.rewards[i], i);
          }
          rewardsEl.innerHTML = html;
          if (rewardCount) {
            rewardCount.textContent = "(" + data.rewards.length + ")";
          }
          if (rewardsEmpty) rewardsEmpty.hidden = data.rewards.length > 0;
        }).catch(function () {})
        : Promise.resolve(),
      runsEl
        ? fetchJson("/api/ocr-runs").then(function (data) {
          var html = "";
          for (var i = 0; i < data.runs.length; i++) {
            html += runCard(data.runs[i]);
          }
          runsEl.innerHTML = html;
          if (runCount) runCount.textContent = "(" + data.runs.length + ")";
          if (runsEmpty) runsEmpty.hidden = data.runs.length > 0;
        }).catch(function () {})
        : Promise.resolve(),
    ]).then(function () {
      scheduleRecentPoll(10000);
    });
  }

  function initRecent() {
    if (!$("wf-rewards") && !$("wf-runs")) return;
    document.addEventListener("visibilitychange", function () {
      if (recentTimer) {
        clearTimeout(recentTimer);
        recentTimer = null;
      }
      if (!document.hidden) scheduleRecentPoll(1000);
    });
    scheduleRecentPoll(10000);
  }

  /* ------------------------------------------------------------------ */

  function init() {
    if (window.GOVUKFrontend && GOVUKFrontend.initAll) {
      GOVUKFrontend.initAll();
    }
    initLogs();
    initRecent();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
