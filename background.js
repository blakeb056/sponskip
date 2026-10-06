// Finds sponsor segments: 1) local cache, 2) SponsorBlock crowd data, 3) 100% local keyword/linguistic detector.

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "analyze") {
    findSegments(msg.videoId, msg.transcript, !!msg.force).then(res => {
      const segs = res?.segments || [];
      updateBadge(sender.tab?.id, segs.length);
      if (segs.length > 0) recordStats(msg.channelName, segs);
      reply(res);
    }, e => {
      updateBadge(sender.tab?.id, 0);
      reply({ segments: [], source: "error: " + e.message });
    });
  }
  return true; // async reply
});

async function recordStats(channelName, segments) {
  if (!segments || !segments.length) return;
  const channel = channelName && channelName !== "Unknown Creator" ? channelName : "Other Channels";
  const data = await chrome.storage.local.get({
    totalAdsSkipped: 0,
    totalSecondsSaved: 0,
    channelStats: {}
  });

  let totalAds = data.totalAdsSkipped + segments.length;
  let addedSeconds = segments.reduce((acc, s) => acc + Math.round((s.end - s.start) || 0), 0);
  let totalSec = data.totalSecondsSaved + addedSeconds;

  let channelStats = data.channelStats || {};
  channelStats[channel] = (channelStats[channel] || 0) + segments.length;

  await chrome.storage.local.set({
    totalAdsSkipped: totalAds,
    totalSecondsSaved: totalSec,
    channelStats
  });
}

function updateBadge(tabId, count) {
  if (!tabId) return;
  if (count > 0) {
    chrome.action.setBadgeText({ tabId, text: String(count) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#e53e3e" }); // red badge like uBlock
  } else {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
}

async function findSegments(id, transcript, force = false) {
  const key = "seg_" + id;
  if (!force) {
    const cached = (await chrome.storage.local.get(key))[key];
    // Only return cache if it actually found segments, or was checked recently
    if (cached && cached.length > 0) return { segments: cached, source: "cache" };
  }

  const save = async (segments, source) => {
    await chrome.storage.local.set({ [key]: segments, [key + "_source"]: source });
    return { segments, source };
  };

  const sb = await sponsorBlock(id);
  if (sb.length) return save(sb, "sponsorblock");

  if (!transcript) return { segments: [], source: "no captions available" };
  const kw = detectByKeywords(transcript);
  return save(kw, "keywords");
}

// ---- Linguistic Segment Detector ----
// Synthesized from corpus studies on host-read podcast ads and YouTube creator segues:
// 1. Direct sponsor acknowledgments
// 2. Structural break signals ("quick break", "pause the conversation")
// 3. Parasocial recommendation transitions ("something that's helped me", "excited to share")
// 4. "Ties in / speaking of" bridge segues
const START = new RegExp(
  "(" + [
    // Direct sponsor cues
    "today'?s sponsor",
    "this (video|episode|stream|show|conversation|interview) is (brought to you|sponsored|made possible|supported|presented)",
    "sponsored by",
    "brought to you by",
    "thanks? (to )?[\\w\\s]+ for sponsoring",
    "partnered with",
    "a (quick )?word from (our|today'?s) sponsor",
    "huge thanks to",
    "support for (today'?s episode|this show|our podcast) comes from",
    "our partners? at",
    // Structural breaks & breathers (Podcasts & Interviews)
    "take a quick break to (hear|talk|thank)",
    "let'?s take a (quick )?break",
    "before we (get into|continue|move on|jump into that|hear from|wrap up),? (a quick word|let'?s thank|i want to|we have to)",
    "pause the conversation (for a moment|really quick)",
    "we'?ll be right back after this",
    // Linus & conversational bridge segues
    "speaking of [\\w\\s]+,? (our|today'?s) sponsor",
    "that actually ties in (perfectly )?with",
    "you know what else (is|has|can)",
    "seamless segue to (our|today'?s) sponsor",
    "smooth segue to (our|today'?s) sponsor",
    "segue to (our|today'?s) sponsor",
    "our sponsor,? [\\w\\s]+",
    "let'?s talk about (our sponsor|today'?s sponsor)",
    // Parasocial story / personal recommendation intros
    "if you'?ve been struggling with",
    "something that has been helping me",
    "i'?m always looking for ways to",
    "excited to be partnering with",
    "i want to take a (quick )?moment to (tell you|share|talk)",
    "shoutout to [\\w\\s]+ for making this",
    "check out [\\w\\s]+ at the link below"
  ].join("|") + ")",
  "i"
);

// Common sponsor names, URLs & call-to-actions (Consumer + B2B/Enterprise/Tech)
const AD = new RegExp(
  "(" + [
    "promo code", "use code", "\\bcode\\b", "link (is )?(in the|down) description", "link below",
    "first \\d[\\d,]* (people|users)", "\\d+ ?%", "percent off", "free trial", "sign up at",
    "discount", "subscription", "money back guarantee", "offer code", "head over to",
    "visit [\\w\\.-]+\\.(com|io|co|ai|org)", "go to [\\w\\.-]+\\.(com|io|co|ai|org)",
    "learn more at", "check out [\\w\\s]+ at", "to learn more", "partnering with",
    "special offer", "exclusive deal", "start your free", "schedule a demo",
    // Frequent YouTube sponsors (Consumer + Tech/B2B)
    "ridge (wallet|ring)", "dbrand", "squarespace", "nordvpn", "expressvpn", "surfshark",
    "manscaped", "raycon", "betterhelp", "hellofresh", "factor meals", "casetify",
    "grammarly", "honey", "audible", "skillshare", "brilliant", "incogni", "aura",
    "displate", "anker", "secretlab", "ifixit", "ugreen", "lttstore",
    // Enterprise, security, B2B & podcast sponsors
    "\\baxon\\b", "taser", "crowdstrike", "datadog", "mongodb", "aws", "cloudflare",
    "hubspot", "salesforce", "monday\\.com", "notion", "clickup", "shopify", "brex", "ramp"
  ].join("|") + ")",
  "i"
);

const RETURN = new RegExp(
  "(" + [
    "\\banyway",
    "back to (the|our) (video|topic|build|benchmarks|show|review)",
    "now (let'?s|back)",
    "let'?s get (back|into)",
    "where were we",
    "with that out of the way",
    "so,? back to",
    "moving on",
    "all right,? so",
    "without further ado",
    "thanks again to"
  ].join("|") + ")",
  "i"
);

const MAX_AD = 120, QUIET_GAP = 20, MIN_AD = 10;

function detectByKeywords(transcript) {
  const lines = transcript.split("\n").map(l => {
    const m = l.match(/^\[(\d+)\]\s*(.*)$/);
    return m && { t: +m[1], text: m[2] };
  }).filter(Boolean);

  const segs = [];

  // 1. Classic start-phrase forward scan
  for (let i = 0; i < lines.length; i++) {
    if (!START.test(lines[i].text) || (segs.length && lines[i].t < segs.at(-1).end)) continue;
    const start = lines[i].t;
    let lastAd = start, end = null, hits = 1;
    for (let j = i + 1; j < lines.length; j++) {
      const { t, text } = lines[j];
      if (t - start > MAX_AD) { end = start + MAX_AD; break; }
      if (RETURN.test(text) && t - start > MIN_AD) { end = t; break; }
      if (AD.test(text)) { lastAd = t; hits++; }
      else if (t - lastAd > QUIET_GAP) { end = lines[j - 1]?.t ?? t; break; }
    }
    end ??= Math.min(lastAd + 5, start + MAX_AD);
    if (hits >= 2 && end - start >= MIN_AD) segs.push({ start, end, reason: "keywords" });
  }

  // 2. Sneaky/Disguised Ad detection (dense ad cluster without formal "today's sponsor" start)
  // When a creator weaves an ad smoothly into conversation and only pitches promo/discount/brand at the end:
  for (let i = 0; i < lines.length; i++) {
    if (segs.some(s => lines[i].t >= s.start && lines[i].t <= s.end)) continue;
    
    // Look ahead 30s for clustered AD hits (e.g., promo codes, discount, sponsor links)
    const windowHits = lines.filter(l => l.t >= lines[i].t && l.t <= lines[i].t + 35 && AD.test(l.text));
    if (windowHits.length >= 2) {
      // Found an ad pitch! Now trace BACKWARD up to 45s to catch the disguised transition / story lead
      let startIdx = i;
      for (let b = i - 1; b >= 0 && (lines[i].t - lines[b].t) <= 45; b--) {
        if (segs.some(s => lines[b].t >= s.start && lines[b].t <= s.end)) break;
        if (RETURN.test(lines[b].text)) break; // hit previous content boundary
        startIdx = b;
      }

      const start = lines[startIdx].t;
      let lastAd = windowHits.at(-1).t;
      let end = null;
      for (let j = i; j < lines.length && lines[j].t - start <= MAX_AD; j++) {
        const { t, text } = lines[j];
        if (RETURN.test(text) && t - start > MIN_AD) { end = t; break; }
        if (AD.test(text)) lastAd = t;
        else if (t - lastAd > QUIET_GAP) { end = lines[j - 1]?.t ?? t; break; }
      }
      end ??= Math.min(lastAd + 8, start + MAX_AD);

      if (end - start >= MIN_AD && !segs.some(s => (start >= s.start && start <= s.end) || (end >= s.start && end <= s.end))) {
        segs.push({ start, end, reason: "disguised-ad" });
        segs.sort((a, b) => a.start - b.start);
      }
    }
  }

  return segs;
}

async function sponsorBlock(id) {
  try {
    const r = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${id}&categories=["sponsor","selfpromo"]`);
    if (!r.ok) return [];
    return (await r.json()).map(s => ({ start: s.segment[0], end: s.segment[1], reason: s.category }));
  } catch { return []; }
}
