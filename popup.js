function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

async function loadData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("youtube.com/watch")) {
    document.getElementById("source").textContent = "Not a YouTube watch page";
    document.getElementById("statusDot").classList.add("inactive");
    return;
  }

  const url = new URL(tab.url);
  const vId = url.searchParams.get("v");
  if (!vId) return;

  const key = "v2_seg_" + vId;
  const data = await chrome.storage.local.get([key, key + "_source"]);
  const segments = data[key] || [];
  const source = data[key + "_source"] || "scanned";

  const countEl = document.getElementById("count");
  const sourceEl = document.getElementById("source");
  const listEl = document.getElementById("segmentsList");

  countEl.textContent = segments.length;
  sourceEl.textContent = segments.length ? `Detected via ${source}` : "No ads found on this video";

  if (segments.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No sponsor segments detected</div>`;
  } else {
    listEl.innerHTML = segments.map((s, idx) => `
      <div class="segment-item">
        <span class="segment-time">⏱ ${fmt(s.start)} ➔ ${fmt(s.end)}</span>
        <span class="segment-badge">${Math.round(s.end - s.start)}s (${s.reason || 'sponsor'})</span>
      </div>
    `).join("");
  }

  // Render Lifetime Analytics & Creator Leaderboard
  const lifetime = await chrome.storage.local.get({
    totalAdsSkipped: 0,
    totalSecondsSaved: 0,
    channelStats: {}
  });

  document.getElementById("totalAdsStat").textContent = lifetime.totalAdsSkipped;
  const minsSaved = Math.round(lifetime.totalSecondsSaved / 60);
  document.getElementById("totalTimeStat").textContent = minsSaved >= 60 ? `${(minsSaved/60).toFixed(1)}h` : `${minsSaved}m`;

  const lbEl = document.getElementById("leaderboardList");
  const channels = Object.entries(lifetime.channelStats || {}).sort((a, b) => b[1] - a[1]);

  if (channels.length === 0) {
    lbEl.innerHTML = `<div class="empty-state" style="padding: 4px 0;">No creator history yet</div>`;
  } else {
    lbEl.innerHTML = channels.slice(0, 3).map(([name, count], i) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #242424;">
        <span style="color: #ddd; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 190px;">
          ${i === 0 ? '👑 ' : ''}${name}
        </span>
        <span style="font-weight: 700; color: #ff4d4d;">${count} ad${count > 1 ? 's' : ''}</span>
      </div>
    `).join("");
  }

  // Load user settings
  const settings = await chrome.storage.sync.get({ autoSkip: true, playSound: false });
  document.getElementById("autoSkipToggle").checked = settings.autoSkip;
  document.getElementById("soundToggle").checked = settings.playSound;
}

document.getElementById("autoSkipToggle").onchange = (e) => {
  chrome.storage.sync.set({ autoSkip: e.target.checked });
};

document.getElementById("soundToggle").onchange = (e) => {
  chrome.storage.sync.set({ playSound: e.target.checked });
};

document.getElementById("settingsBtn").onclick = () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL("options.html"));
};

document.getElementById("ghBtn").onclick = () => {
  window.open("https://github.com/sponskip/sponskip");
};

document.getElementById("rescanBtn").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "rescan" });
    window.close();
  }
};

loadData();
