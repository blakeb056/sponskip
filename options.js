const $ = id => document.getElementById(id);
chrome.storage.sync.get("apiKey").then(({ apiKey }) => { if (apiKey) $("key").value = apiKey; });
$("save").onclick = async () => { await chrome.storage.sync.set({ apiKey: $("key").value.trim() }); $("msg").textContent = "Saved"; };
$("clear").onclick = async () => { await chrome.storage.local.clear(); $("msg").textContent = "Cache cleared"; };
