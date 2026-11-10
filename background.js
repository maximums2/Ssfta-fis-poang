// Service worker: hämtar FIS-sidor åt content-scriptet.
// (Content scripts kan inte hämta från fis-ski.com pga CORS, men service workern
//  kan det så länge tillägget har åtkomst till fis-ski.com.)

const BIO_URL = "https://www.fis-ski.com/DB/general/athlete-biography.html";
const FIS_ORIGINS = ["https://www.fis-ski.com/*"];

function buildUrl(msg) {
  if (msg.mode === "fispoints") {
    return `${BIO_URL}?sectorcode=AL&competitorid=${encodeURIComponent(msg.competitorId)}&type=fispoints`;
  }
  return `${BIO_URL}?sectorcode=AL&fiscode=${encodeURIComponent(msg.fisCode)}`;
}

async function hasFisAccess() {
  try { return await chrome.permissions.contains({ origins: FIS_ORIGINS }); }
  catch (_) { return true; } // kan inte avgöra -> försök ändå
}

async function fetchFis(msg) {
  if (msg.mode === "fispoints" ? !/^\d+$/.test(msg.competitorId || "") : !/^\d{5,7}$/.test(msg.fisCode || "")) {
    return { ok: false, error: "Ogiltigt id" };
  }
  if (!(await hasFisAccess())) return { ok: false, error: "NO_HOST_PERMISSION" };
  try {
    const resp = await fetch(buildUrl(msg), { credentials: "omit" });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return { ok: true, html: await resp.text(), url: resp.url };
  } catch (err) {
    // "Failed to fetch"/CORS trots att åtkomst finns: nästan alltid blockerad av policy eller webbläsarinställning.
    return { ok: false, error: "NO_HOST_PERMISSION", detail: String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "FETCH_FIS") {
    fetchFis(msg)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true; // asynkront svar
  }
});

// Klick på tilläggets ikon = användargest -> be om (ev. indragen) åtkomst till fis-ski.com.
chrome.action.onClicked.addListener(async () => {
  try {
    const granted = await chrome.permissions.request({ origins: FIS_ORIGINS });
    chrome.action.setBadgeText({ text: granted ? "OK" : "!" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
  } catch (e) {
    chrome.action.setBadgeText({ text: "!" });
    console.warn("[FIS-poäng] Kunde inte begära åtkomst:", e);
  }
});
