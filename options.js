// Tab navigation
document.querySelectorAll(".nav-item").forEach(item => {
  item.onclick = () => {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    item.classList.add("active");

    const tab = item.getAttribute("data-tab");
    document.getElementById("generalTab").style.display = tab === "general" ? "block" : "none";
    document.getElementById("analyticsTab").style.display = tab === "analytics" ? "block" : "none";
    document.getElementById("privacyTab").style.display = tab === "privacy" ? "block" : "none";
    if (tab === "analytics") loadAnalytics();
  };
});

function showToast() {
  const alert = document.getElementById("saveAlert");
  alert.style.display = "block";
  setTimeout(() => { alert.style.display = "none"; }, 1800);
}

// Load Settings
async function initSettings() {
  const settings = await chrome.storage.sync.get({
    autoSkip: true,
    playSound: false,
    showToast: true,
    showBadgeCount: true
  });

  document.getElementById("autoSkip").checked = settings.autoSkip;
  document.getElementById("playSound").checked = settings.playSound;
  document.getElementById("showToast").checked = settings.showToast;
  document.getElementById("showBadgeCount").checked = settings.showBadgeCount;

  ["autoSkip", "playSound", "showToast", "showBadgeCount"].forEach(id => {
    document.getElementById(id).onchange = async (e) => {
      await chrome.storage.sync.set({ [id]: e.target.checked });
      showToast();
    };
  });
}

// Load Lifetime Analytics & Leaderboard
async function loadAnalytics() {
  const data = await chrome.storage.local.get({
    totalAdsSkipped: 0,
    totalSecondsSaved: 0,
    channelStats: {}
  });

  document.getElementById("statTotalAds").textContent = data.totalAdsSkipped;
  const mins = Math.round(data.totalSecondsSaved / 60);
  document.getElementById("statTimeSaved").textContent = mins >= 60 ? `${(mins/60).toFixed(1)}h` : `${mins}m`;

  const channels = Object.entries(data.channelStats || {}).sort((a, b) => b[1] - a[1]);
  document.getElementById("statCreatorsCount").textContent = channels.length;

  const tbody = document.getElementById("leaderboardBody");
  if (channels.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#666;">No channel statistics recorded yet.</td></tr>`;
  } else {
    tbody.innerHTML = channels.map(([name, count], i) => `
      <tr>
        <td style="font-weight:700; color:${i === 0 ? '#ef4444' : '#888'};">${i === 0 ? '👑 #1' : '#' + (i + 1)}</td>
        <td style="font-weight:600;">${name}</td>
        <td style="font-weight:700; color:#ef4444;">${count} sponsor read${count > 1 ? 's' : ''}</td>
      </tr>
    `).join("");
  }
}

document.getElementById("clearDataBtn").onclick = async () => {
  if (confirm("Are you sure you want to reset your lifetime stats?")) {
    await chrome.storage.local.clear();
    loadAnalytics();
    showToast();
  }
};

initSettings();
