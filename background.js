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

const CACHE_PREFIX = "v2_seg_";

// Flush legacy false-positive cache entries on extension reload/install
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const all = await chrome.storage.local.get(null);
    const legacyKeys = Object.keys(all).filter(k => k.startsWith("seg_"));
    if (legacyKeys.length) {
      await chrome.storage.local.remove(legacyKeys);
      console.log("[SponsorSkipper] Flushed legacy unversioned cache entries:", legacyKeys.length);
    }
  } catch (e) {
    console.error("[SponsorSkipper] Cache flush error:", e);
  }
});

async function findSegments(id, transcript, force = false) {
  const key = CACHE_PREFIX + id;
  if (!force) {
    const data = await chrome.storage.local.get([key, key + "_source"]);
    const cached = data[key];
    if (cached && !cached.some(s => s.reason === "disguised-ad")) {
      return { segments: cached, source: data[key + "_source"] || "cache" };
    }
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


// ---- Intelligent Sponsor Detector ----
// Multi-pass semantic engine designed to eliminate false positives on tech, coding & gaming videos
// while capturing both explicit declarations and host-read/disguised sponsorship reads.

const SPONSOR_DECLARATION = new RegExp(
  "(" + [
    "today'?s sponsor",
    "this (video|episode|stream|show|conversation|interview|podcast) is (brought to you|sponsored|made possible|supported|presented)",
    "sponsored by",
    "brought to you by",
    "presenting sponsor",
    "sponsor of this (podcast|video|show|channel|episode)",
    "thanks? (to )?[\\w\\s]+ for sponsoring",
    "partnered with",
    "a (quick )?word from (our|today'?s) sponsor",
    "support for (today'?s episode|this show|our podcast) comes from",
    "our partners? at",
    "seamless segue to (our|today'?s) sponsor",
    "smooth segue to (our|today'?s) sponsor",
    "our sponsor,? [\\w\\s]+"
  ].join("|") + ")",
  "i"
);

// High-confidence commercial call-to-actions (must indicate genuine commercial conversion intent)
const COMMERCIAL_CTA = new RegExp(
  "(" + [
    "(promo|discount|coupon|offer) code",
    "\\b(use|enter|apply)\\s+(the\\s+)?(promo\\s+|discount\\s+)?code\\b",
    "link (is )?(in the|down) (description|below|show notes)",
    "link down below",
    "\\b\\d+ ?% (off|discount|cashback|cash back|savings)\\b",
    "\\b(save|get) (\\d+ ?%|\\$\\d+)\\b",
    "\\bfree trial\\b",
    "\\bfree shipping\\b",
    "\\bmoney[- ]back guarantee\\b",
    "\\b(head over|go|visit)\\s+(to|on)?\\s+[a-z0-9-]+\\.(com|io|co|ai|org|net|store|app)\\b",
    "\\b[a-z0-9-]+\\.(com|io|co|ai|org|net|store|app)\\/[a-z0-9_\\.-]+\\b",
    "\\bfirst \\d[\\d,]* (people|users|listeners|viewers)\\b",
    "\\bexclusive deal\\b",
    "\\bspecial offer\\b"
  ].join("|") + ")",
  "i"
);

// Established YouTube/podcast sponsor brands
const KNOWN_SPONSORS = new RegExp(
  "\\b(" + [
    "ridge wallet", "dbrand", "squarespace", "nordvpn", "expressvpn", "surfshark",
    "manscaped", "raycon", "betterhelp", "hellofresh", "factor meals", "casetify",
    "grammarly", "audible", "skillshare", "brilliant", "incogni", "aura",
    "displate", "anker", "secretlab", "ifixit", "ugreen", "lttstore",
    "axon", "ramp", "deel", "brex", "honey"
  ].join("|") + ")\\b",
  "i"
);

const RETURN = new RegExp(
  "(" + [
    "\\banyway",
    "back to (the|our) (video|topic|build|benchmarks|show|review|conversation|interview)",
    "let'?s get back (to|into)",
    "where were we",
    "with that out of the way",
    "so,? back to",
    "moving on",
    "without further ado",
    "thanks again to"
  ].join("|") + ")",
  "i"
);

const MAX_AD = 120, QUIET_GAP = 16, MIN_AD = 12;

function detectByKeywords(transcript) {
  const lines = transcript.split("\n").map(l => {
    const m = l.match(/^\[(\d+)\]\s*(.*)$/);
    return m && { t: +m[1], text: m[2] };
  }).filter(Boolean);

  const segs = [];

  // Pass 1: Explicit sponsor declarations ("sponsored by", "presenting sponsor", etc.)
  for (let i = 0; i < lines.length; i++) {
    if (segs.some(s => lines[i].t >= s.start && lines[i].t <= s.end)) continue;

    if (SPONSOR_DECLARATION.test(lines[i].text)) {
      // Find start: look back up to 14s for host cut or segue
      let start = lines[i].t;
      for (let b = i - 1; b >= 0 && (lines[i].t - lines[b].t) <= 14; b--) {
        if (/^[-—&gt;]+\s*|before we|take a (quick )?break|want to tell you|quick word/i.test(lines[b].text)) {
          start = lines[b].t;
          break;
        }
      }

      let lastAd = lines[i].t;
      let end = null;
      for (let j = i; j < lines.length && (lines[j].t - start) <= MAX_AD; j++) {
        const { t, text } = lines[j];
        if (RETURN.test(text) && t - start >= MIN_AD) {
          end = t;
          break;
        }
        if (COMMERCIAL_CTA.test(text) || KNOWN_SPONSORS.test(text)) {
          lastAd = t;
        } else if (t - lastAd > QUIET_GAP && t - start >= MIN_AD) {
          end = lines[j - 1]?.t || lastAd;
          break;
        }
      }
      end = end || Math.min(lastAd + 6, start + MAX_AD);
      if (end - start >= MIN_AD) {
        segs.push({ start, end, reason: "sponsor" });
      }
    }
  }

  // Pass 2: Host-read / Disguised ad pitch (e.g. Axon, Deel, Ramp without formal declaration)
  // MUST have a commercial CTA (e.g. "axon.ai/senra", "deel.com/centra", "go to ramp.com")
  // AND either a KNOWN_SPONSOR or repeated CTA hits
  for (let i = 0; i < lines.length; i++) {
    if (segs.some(s => lines[i].t >= s.start && lines[i].t <= s.end)) continue;

    const hasBrand = KNOWN_SPONSORS.test(lines[i].text);
    const hasCta = COMMERCIAL_CTA.test(lines[i].text);

    if (hasBrand || hasCta) {
      // Look forward up to 55s for confirmed CTA
      const window = lines.filter(l => l.t >= lines[i].t && l.t <= lines[i].t + 55);
      const ctas = window.filter(l => COMMERCIAL_CTA.test(l.text));
      const brands = window.filter(l => KNOWN_SPONSORS.test(l.text));

      // Must have at least 1 verified commercial CTA + (brand mention OR multiple CTAs)
      if (ctas.length >= 1 && (brands.length >= 1 || ctas.length >= 2)) {
        let start = lines[i].t;
        // Trace back to start of sentence / host cut (max 14s)
        for (let b = i - 1; b >= 0 && (lines[i].t - lines[b].t) <= 14; b--) {
          if (/^[-—&gt;]+|favorite quote|check out|studying how/i.test(lines[b].text)) {
            start = lines[b].t;
            break;
          }
        }

        let lastAd = ctas.at(-1).t;
        let end = null;
        for (let j = i; j < lines.length && (lines[j].t - start) <= MAX_AD; j++) {
          const { t, text } = lines[j];
          if (RETURN.test(text) && t - start >= MIN_AD) {
            end = t;
            break;
          }
          if (COMMERCIAL_CTA.test(text) || KNOWN_SPONSORS.test(text)) {
            lastAd = t;
          } else if (t - lastAd > QUIET_GAP && t - start >= MIN_AD) {
            end = lines[j - 1]?.t || lastAd;
            break;
          }
        }
        end = end || Math.min(lastAd + 6, start + MAX_AD);
        if (end - start >= MIN_AD && !segs.some(s => (start >= s.start && start <= s.end))) {
          segs.push({ start, end, reason: "sponsor" });
          segs.sort((a, b) => a.start - b.start);
        }
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
