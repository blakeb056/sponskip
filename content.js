// Runs on YouTube. The moment a video opens: get its captions, ask for sponsor
// timestamps (cached -> SponsorBlock -> Gemini), then auto-skip during playback.
let segments = [];
let currentId = null;

const log = (...a) => console.log("[SponsorSkipper]", ...a);
const videoId = () => new URL(location.href).searchParams.get("v");

async function getCaptions(id) {
  let tracks = [];

  // 1. Fetch via Android InnerTube client (consistently supplies signed timedtext XML with 0 bot-blocks)
  try {
    const pReq = await fetch("https://www.youtube.com/youtubei/v1/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId: id,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
            androidSdkVersion: 30,
            hl: "en",
            gl: "US"
          }
        }
      })
    });
    if (pReq.ok) {
      const pData = await pReq.json();
      tracks = pData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    }
  } catch (e) { log("Android player fetch error", e); }

  // 2. Fallback to DOM script tags
  if (!tracks.length) {
    try {
      for (const s of document.querySelectorAll("script")) {
        const text = s.textContent || "";
        if (text.includes("captionTracks")) {
          const m = text.match(/"captionTracks":\s*(\[.+?\])/);
          if (m) {
            tracks = JSON.parse(m[1]);
            if (tracks.length) break;
          }
        }
      }
    } catch (e) { log("DOM script parse error", e); }
  }

  if (!tracks.length) {
    log("no caption tracks found for video", id);
    return null;
  }

  const track = tracks.find(t => t.languageCode?.startsWith("en")) || tracks[0];
  log("fetching caption track:", track.languageCode, track.baseUrl?.slice(0, 80));

  try {
    const res = await fetch(track.baseUrl);
    const xmlText = await res.text();
    if (!xmlText || xmlText.length < 50) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");

    // Format 3: <p t="ms" d="ms">text</p> (Android srv3 / standard timedtext)
    const pTags = Array.from(doc.querySelectorAll("p"));
    if (pTags.length > 0) {
      return pTags.map(el => {
        const tMs = parseInt(el.getAttribute("t") || "0", 10);
        const sec = Math.round(tMs / 1000);
        const text = el.textContent.replace(/\n/g, " ").trim();
        return `[${sec}] ${text}`;
      }).filter(l => !l.endsWith("] ")).join("\n");
    }

    // Format 1: <text start="s" dur="s">text</text>
    const textTags = Array.from(doc.querySelectorAll("text"));
    if (textTags.length > 0) {
      return textTags.map(el => {
        const start = Math.round(parseFloat(el.getAttribute("start") || "0"));
        const text = el.textContent.replace(/\n/g, " ").trim();
        return `[${start}] ${text}`;
      }).filter(l => !l.endsWith("] ")).join("\n");
    }
  } catch (e) {
    log("caption download or parse error", e);
  }

  return null;
}

async function analyze(id, force = false) {
  currentId = id;
  segments = [];
  showBadge("🔍 scanning for sponsors…");
  try {
    let transcript = null;
    try { transcript = await getCaptions(id); } catch (e) { log("captions failed", e); }
    log(`Captions fetched for ${id}:`, transcript ? `${transcript.length} characters` : "None");

    const res = await chrome.runtime.sendMessage({ type: "analyze", videoId: id, transcript, force });
    if (id !== currentId) return; // user navigated away mid-scan
    segments = res?.segments || [];
    log(`Detection result (${res?.source}):`, segments);
    showBadge(segments.length ? `⏭️ ${segments.length} sponsor segment(s) will be skipped` : `✅ no sponsors found (${res?.source || 'none'})`, 4000);
  } catch (e) {
    log("analyze error", e);
    showBadge("⚠️ sponsor scan failed", 4000);
  }
}

function playSkipChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5 note
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5 note
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {}
}

async function tick() {
  const v = document.querySelector("video");
  if (!v || !segments.length) return;
  
  const { autoSkip = true, playSound = false } = await chrome.storage.sync.get({ autoSkip: true, playSound: false });
  if (!autoSkip) return;

  for (const s of segments) {
    if (v.currentTime >= s.start && v.currentTime < s.end - 0.5) {
      v.currentTime = s.end;
      if (playSound) playSkipChime();
      showBadge(`⏭️ skipped sponsor (${Math.round(s.end - s.start)}s)`, 2500);
      log("skipped", s);
    }
  }
}
setInterval(tick, 250);

let badge, badgeTimer;
function showBadge(text, ms) {
  if (!badge) {
    badge = document.createElement("div");
    badge.style.cssText = "position:fixed;bottom:24px;left:24px;z-index:99999;background:#111d;color:#fff;padding:8px 12px;border-radius:8px;font:13px system-ui";
    document.body.appendChild(badge);
  }
  badge.textContent = text;
  badge.style.display = "block";
  clearTimeout(badgeTimer);
  if (ms) badgeTimer = setTimeout(() => (badge.style.display = "none"), ms);
}

function onNav() {
  const id = videoId();
  if (location.pathname === "/watch" && id && id !== currentId) analyze(id);
}
// YouTube is a single-page app: catch in-app navigation as well as first load.
window.addEventListener("yt-navigate-finish", onNav);
onNav();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "rescan") {
    const id = videoId();
    if (id) analyze(id, true);
  }
});
