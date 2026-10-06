# ⏭️ Sponskip

> **Auto-skip in-video sponsor reads and disguised ads on YouTube.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-brightgreen.svg)](manifest.json)

Most YouTube ad blockers only stop pre-roll and mid-roll popups. But on podcasts, creator shows, and tech reviews, creators embed **sponsored pitch reads directly into the video**—often disguised as organic stories before revealing a promo code or sponsor link.

**Sponskip** detects these segments the moment a video opens and jumps past them automatically.

---

## ⚡ How It Works

Sponskip uses a high-speed, multi-tier detection pipeline designed to run with **zero latency and zero API cost**:

1. **Instant Crowdsource Check:** Queries the open SponsorBlock database. If someone has already tagged the video, it skips with zero compute.
2. **Instant Transcript Parsing:** If untagged, Sponskip reads YouTube's captions (JSON3 and XML timedtext) directly from your active browser session in under 200ms without transcribing raw audio.
3. **Smart Two-Way Segment Detector:**
   - **Forward Scan:** Catches explicit creator transitions (`"today's sponsor"`, `"seamless segue to..."`, `"thanks to X for sponsoring"`).
   - **Backward Reverse Trace:** Detects disguised ads (where a podcaster tells an organic story that ends in an offer code, B2B demo request, or sponsor URL) and traces backwards to clip the entire pitch.
4. **Seamless Player Seek:** Advances `video.currentTime` directly inside the YouTube player without fake keyboard controls.
5. **Optional AI Fallback:** Support for Google Gemini 1.5 Flash structured output for ambiguous videos (optional, brings your own key).

---

## 🛠️ Installation (Developer / Unpacked)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/blakeb056/sponskip.git
   ```
2. Open Google Chrome and navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** in the top left and select the `sponskip` folder.
5. Pin **Sponskip** to your toolbar!

---

## 🖥️ Extension UI

- **Active Badge Counter:** Shows the number of detected sponsor reads directly on the extension icon (just like uBlock Origin).
- **Popup Control Panel:**
  - View exact start and end timestamps.
  - See which detection source found the ad (SponsorBlock, Keywords, or Gemini).
  - One-click **Force Re-scan** button.

---

## 🔒 Privacy

- **100% Client-Side:** All keyword pattern matching executes locally in your browser.
- **Zero Personal Data:** Sponskip never collects, tracks, or transmits browsing history or user data.

---

## 📄 License

MIT © [Blake Burford](https://github.com/blakeb056)
