(() => {
  const ROOT_MARK = "data-fis-ssfta-v11";
  if (document.documentElement.hasAttribute(ROOT_MARK)) return;
  document.documentElement.setAttribute(ROOT_MARK, "1");

  const CACHE_HOURS = 12;      // FIS-listorna ändras sällan – spara svar så vi inte belastar FIS
  const CONCURRENCY = 3;       // max antal samtidiga förfrågningar
  const DELAY_MS = 150;        // paus mellan förfrågningar per "arbetare"
  const CODES = ["DH", "SL", "GS", "SG", "AC"];

  const norm = s => (s || "").normalize("NFKC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- Disciplin & tabell ---------- */

  const DISC = {
    SL: { code: "SL", label: "Slalom" },
    GS: { code: "GS", label: "Storslalom" },
    SG: { code: "SG", label: "Super-G" },
    DH: { code: "DH", label: "Störtlopp" }
  };
  let manualDisc = null; // satt om användaren väljer disciplin själv

  function mapDiscipline(text) {
    const t = norm(text).toLowerCase();
    if (!t || /parallel/.test(t)) return null;
    if (/super[\s-]*g|\bsg\b/.test(t)) return DISC.SG;
    if (/stor\s*slalom|giant|\bgs\b/.test(t)) return DISC.GS;
    if (/störtlopp|stortlopp|downhill|\bdh\b/.test(t)) return DISC.DH;
    if (/slalom|\bsl\b/.test(t)) return DISC.SL;
    return null;
  }

  function disciplineFromPage() {
    const raw = (document.body?.innerText || "").normalize("NFKC").replace(/\u00a0/g, " ");

    // 1. "Disciplin: Slalom" / "Discipline: Slalom" / etikett och värde på olika rader
    const re = /discipl\w*\s*:?\s*([^\n:]{1,40})/gi;
    let m;
    while ((m = re.exec(raw))) {
      const d = mapDiscipline(m[1]);
      if (d) return d;
    }

    // 2. Reserv: rubriker och sidtitel (t.ex. "Tärnaby SL Men")
    const heads = [document.title, ...[...document.querySelectorAll("h1,h2,h3")].map(e => e.textContent)];
    for (const h of heads) {
      const d = mapDiscipline(h);
      if (d) return d;
    }
    return null;
  }

  function findEntryTable() {
    return [...document.querySelectorAll("table")].find(table => {
      const txt = norm(table.innerText).toLowerCase();
      return txt.includes("fis-kod") && txt.includes("namn") && txt.includes("född");
    });
  }

  function findHeaderRow(table) {
    return [...table.querySelectorAll("tr")].find(tr => {
      const t = norm(tr.innerText).toLowerCase();
      return t.includes("fis-kod") && t.includes("namn");
    });
  }

  // Returnerar rader med referens till <tr> så att vi kan skriva resultatet i rätt rad.
  function readRows(table, headerRow) {
    const headers = [...headerRow.children].map(x => norm(x.innerText).toLowerCase());
    const fisIndex = headers.findIndex(x => x.includes("fis-kod"));
    const nameIndex = headers.findIndex(x => x.includes("namn"));
    if (fisIndex < 0 || nameIndex < 0) return [];
    return [...table.querySelectorAll("tr")]
      .filter(tr => tr !== headerRow)
      .map(tr => {
        const cellEls = [...tr.children];
        const cells = cellEls.map(x => norm(x.innerText));
        return {
          tr, fisCode: cells[fisIndex] || "", name: cells[nameIndex] || "",
          nameCell: cellEls[nameIndex] || null, codeCell: cellEls[fisIndex] || null
        };
      })
      .filter(x => /^\d{5,7}$/.test(x.fisCode));
  }

  const HIDE_SUCCESS_MS = 4000; // grön ruta försvinner efter 4 s; varningar ligger kvar
  let hideTimer = null;

  // Uppdaterar bara om texten ändrats (annars skulle vår egen ändring trigga observern igen).
  function showStatus(message, kind = "info", choices = null) {
    let box = document.getElementById("fis-ssfta-status");
    if (!box) {
      box = document.createElement("div");
      box.id = "fis-ssfta-status";
      document.body.appendChild(box);
    }
    const sig = `${kind}|${message}|${choices ? choices.map(c => c.code).join() : ""}`;
    clearTimeout(hideTimer);
    if (kind === "success") hideTimer = setTimeout(() => box.remove(), HIDE_SUCCESS_MS);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.dataset.kind = kind;
    box.textContent = message;
    if (choices) {
      const row = document.createElement("div");
      row.className = "fis-ssfta-choices";
      choices.forEach(c => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = c.code;
        btn.title = c.label;
        btn.addEventListener("click", () => { manualDisc = c; schedule(0); });
        row.appendChild(btn);
      });
      box.appendChild(row);
    }
  }

  /* ---------- Parsning av FIS-sidan ---------- */

  const isVal = t => /^\d{1,4}(\.\d{1,2})?$/.test(t) || /^[-–—]+$/.test(t);
  const toNum = t => (/^\d/.test(t) ? parseFloat(t) : null);

  function textTokens(doc) {
    doc.querySelectorAll("script,style,noscript").forEach(e => e.remove());
    const tokens = [];
    const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = norm(walker.currentNode.nodeValue);
      if (t) tokens.push(t);
    }
    return tokens;
  }

  // Returnerar { found: true, value: number|null } eller { found: false }
  function parsePoints(html, disc) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Metod 0 (primär): FIS-sidan listar "19th FIS points list 2026/27, DH, ---, SL, 35.67, ..."
    // Första förekomsten är den senaste listan.
    const listTokens = textTokens(doc);
    const listRe = /^\d+\s*(?:st|nd|rd|th)?\s+FIS points list\b/i;
    const start = listTokens.findIndex(t => listRe.test(t));
    if (start >= 0) {
      for (let i = start + 1; i < listTokens.length && !listRe.test(listTokens[i]); i++) {
        if (listTokens[i].toUpperCase() === disc && i + 1 < listTokens.length && isVal(listTokens[i + 1])) {
          return { found: true, value: toNum(listTokens[i + 1]), list: listTokens[start] };
        }
      }
    }

    // Metod 1: tabell med rubriker DH/SL/GS/SG/AC och en datarad under.
    for (const table of doc.querySelectorAll("table")) {
      const rows = [...table.querySelectorAll("tr")];
      for (let i = 0; i < rows.length; i++) {
        const heads = [...rows[i].children].map(c => norm(c.textContent).toUpperCase());
        const idx = heads.indexOf(disc);
        if (idx < 0 || heads.filter(h => CODES.includes(h)).length < 2) continue;
        for (let j = i + 1; j < rows.length; j++) {
          const vals = [...rows[j].children].map(c => norm(c.textContent));
          if (vals.length > idx && isVal(vals[idx])) return { found: true, value: toNum(vals[idx]) };
        }
      }
    }

    // Metod 2: textflöde. Antingen "SL GS SG ... 35.67 40.12 ..." eller "SL 35.67 GS 40.12 ...".
    const tokens = textTokens(doc);
    const isCode = t => CODES.includes(t.toUpperCase());
    for (let i = 0; i < tokens.length; i++) {
      if (!isCode(tokens[i])) continue;

      // (a) rubrikrad följd av värderad
      let j = i;
      while (j < tokens.length && isCode(tokens[j])) j++;
      const labels = tokens.slice(i, j);
      if (labels.length >= 2) {
        const vals = tokens.slice(j, j + labels.length);
        if (vals.length === labels.length && vals.every(isVal)) {
          const k = labels.findIndex(l => l.toUpperCase() === disc);
          if (k >= 0) return { found: true, value: toNum(vals[k]) };
        }
        i = j - 1;
        continue;
      }

      // (b) omväxlande etikett/värde (minst två par)
      if (i + 3 < tokens.length && isVal(tokens[i + 1]) && isCode(tokens[i + 2]) && isVal(tokens[i + 3])) {
        let p = i;
        while (p + 1 < tokens.length && isCode(tokens[p]) && isVal(tokens[p + 1])) {
          if (tokens[p].toUpperCase() === disc) return { found: true, value: toNum(tokens[p + 1]) };
          p += 2;
        }
        i = p - 1;
      }
    }
    return { found: false };
  }

  function debugDump(code, html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tokens = textTokens(doc);
    let at = tokens.findIndex(t => /fis points|fis-points|fispoints/i.test(t));
    if (at < 0) at = 0;
    console.warn(`[FIS-poäng] Kunde inte tolka poäng för ${code}. Text kring "FIS Points":`, tokens.slice(Math.max(0, at - 5), at + 60));
  }

  /* ---------- Hämtning ---------- */

  function askBackground(payload) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: "FETCH_FIS", ...payload }, resp => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp || { ok: false, error: "Inget svar" });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  async function cacheGet(key) {
    try {
      const r = await chrome.storage.local.get(key);
      const e = r[key];
      if (e && Date.now() - e.t < CACHE_HOURS * 3600 * 1000) return e;
    } catch (_) {}
    return null;
  }
  async function cacheSet(key, value, list) {
    try { await chrome.storage.local.set({ [key]: { v: value, list: list || "", t: Date.now() } }); } catch (_) {}
  }

  // Returnerar { ok: true, value: number|null } eller { ok: false, error }
  async function fetchPoints(code, disc) {
    const key = `fis3:${disc}:${code}`;
    const cached = await cacheGet(key);
    if (cached) return { ok: true, value: cached.v, list: cached.list, cached: true };

    const bio = await askBackground({ mode: "bio", fisCode: code });
    if (!bio.ok) return { ok: false, error: bio.error };

    let res = parsePoints(bio.html, disc);

    // Reservplan: poänglistan via competitorid.
    if (!res.found) {
      const m = (bio.url + " " + bio.html).match(/competitorid=(\d+)/i);
      if (m) {
        const alt = await askBackground({ mode: "fispoints", competitorId: m[1] });
        if (alt.ok) res = parsePoints(alt.html, disc);
        if (!res.found) debugDump(code, alt.ok ? alt.html : bio.html);
      } else {
        debugDump(code, bio.html);
      }
    }
    if (!res.found) return { ok: false, error: "Kunde inte tolka sidan" };

    await cacheSet(key, res.value, res.list);
    return { ok: true, value: res.value, list: res.list };
  }

  /* ---------- Huvudflöde ---------- */

  function setCell(td, result, code) {
    td.classList.remove("fis-ssfta-error");
    if (!result.ok) {
      td.textContent = "?";
      td.classList.add("fis-ssfta-error");
      td.title = `Kunde inte hämta (${result.error}). Se konsolen (F12).`;
    } else if (result.value === null || result.value >= 999) {
      td.textContent = "—";
      td.title = "Inga FIS-poäng i denna disciplin" + (result.list ? " • " + result.list : "");
    } else {
      td.textContent = result.value.toFixed(2);
      td.title = `FIS-kod ${code}${result.list ? " • " + result.list : ""}${result.cached ? " (cachad)" : ""}`;
    }
  }

  // Gör namnet till en länk till åkarens FIS-profil (öppnas i ny flik).
  // Om cellen redan innehåller en länk från sidan själv länkar vi FIS-koden i stället.
  function linkProfiles(rows) {
    rows.forEach(r => {
      let cell = r.nameCell;
      if (!cell || cell.dataset.fisLinked) return;
      if (cell.querySelector("a") && r.codeCell && !r.codeCell.querySelector("a")) cell = r.codeCell;
      if (cell.querySelector("a") || cell.dataset.fisLinked) return;
      const a = document.createElement("a");
      a.className = "fis-ssfta-link";
      a.href = `https://www.fis-ski.com/DB/general/athlete-biography.html?sectorcode=AL&fiscode=${encodeURIComponent(r.fisCode)}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = `Öppna FIS-profil (${r.fisCode})`;
      a.textContent = cell.textContent.trim();
      cell.textContent = "";
      cell.appendChild(a);
      cell.dataset.fisLinked = "1";
    });
  }

  // Rank bland de anmälda: lägst poäng = 1. Lika poäng ger delad placering (1, 1, 3).
  // Åkare utan poäng får ingen rank (—).
  function applyRanks(rows) {
    const scored = rows.filter(r => r.points != null);
    rows.forEach(r => {
      const td = r.rankTd;
      if (!td) return;
      if (r.points == null) {
        td.textContent = "—";
        td.title = "Ingen FIS-poäng, ingen rank";
        return;
      }
      const better = scored.filter(o => o.points < r.points).length;
      const tied = scored.filter(o => o.points === r.points).length;
      td.textContent = String(better + 1);
      td.title = `Plats ${better + 1} av ${scored.length} åkare med poäng` + (tied > 1 ? ` (delad med ${tied - 1} till)` : "");
    });
  }

  // Klick på rubriken: 1 = lägst poäng först (bäst), 2 = högst först, 3 = ursprunglig ordning.
  // Åkare utan poäng (— eller ?) hamnar alltid sist.
  function enableSorting(th, rows) {
    if (th.dataset.sortable) return;
    th.dataset.sortable = "1";
    const base = th.textContent;
    const orig = rows.map((r, i) => ({ r, i }));
    let state = 0;
    th.style.cursor = "pointer";
    th.style.userSelect = "none";
    th.title = "Klicka för att sortera (lägst poäng = bäst)";
    th.addEventListener("click", () => {
      state = (state + 1) % 3;
      const list = orig.slice().sort((a, b) => {
        if (state === 0) return a.i - b.i;
        const na = a.r.points == null, nb = b.r.points == null;
        if (na || nb) return na && nb ? a.i - b.i : (na ? 1 : -1);
        const d = state === 1 ? a.r.points - b.r.points : b.r.points - a.r.points;
        return d || a.i - b.i;
      });
      list.forEach(({ r }) => r.tr.parentNode.appendChild(r.tr));
      th.textContent = base + (state === 1 ? " ▲" : state === 2 ? " ▼" : "");
    });
  }

  async function run() {
    const table = findEntryTable();
    if (!table) {
      showStatus("FIS v0.11: ingen anmälningstabell på sidan (välj en klass om det finns flera).", "info");
      return;
    }
    const headerRow = findHeaderRow(table);
    if (!headerRow) return showStatus("FIS v0.11: tabellens rubrikrad saknas.", "warning");

    const discipline = disciplineFromPage() || manualDisc;
    if (!discipline) {
      const lines = (document.body?.innerText || "").split("\n").map(norm).filter(l => /discipl/i.test(l));
      console.warn("[FIS-poäng] Hittade inte disciplinen. Sidtitel:", document.title, "| Rader med 'discipl':", lines);
      showStatus("FIS v0.11: hittade inte disciplinen automatiskt. Välj själv:", "warning", [DISC.SL, DISC.GS, DISC.SG, DISC.DH]);
      return;
    }

    const rows = readRows(table, headerRow);
    const key = discipline.code + ":" + rows.map(r => r.fisCode).sort().join(",");
    if (table.dataset.fisKey === key) return;   // redan klar för den här tabellen + disciplinen
    table.dataset.fisKey = key;

    table.classList.add("fis-ssfta-table");
    linkProfiles(rows);

    // Rensa ev. gammal kolumn (t.ex. om disciplinen ändrats)
    table.querySelectorAll(".fis-ssfta-heading,.fis-ssfta-cell").forEach(e => e.remove());

    const th = document.createElement(headerRow.children[0]?.tagName || "th");
    th.className = "fis-ssfta-heading";
    th.textContent = `FIS ${discipline.code}`;
    headerRow.appendChild(th);

    const rankTh = document.createElement(headerRow.children[0]?.tagName || "th");
    rankTh.className = "fis-ssfta-heading";
    rankTh.textContent = "Rank";
    rankTh.title = "Placering bland de anmälda efter FIS-poäng (lägst poäng = 1)";
    headerRow.appendChild(rankTh);

    rows.forEach(r => {
      const td = document.createElement("td");
      td.className = "fis-ssfta-cell";
      td.textContent = "…";
      r.tr.appendChild(td);
      r.td = td;

      const rankTd = document.createElement("td");
      rankTd.className = "fis-ssfta-cell fis-ssfta-rank";
      rankTd.textContent = "…";
      r.tr.appendChild(rankTd);
      r.rankTd = rankTd;
    });

    const unique = [...new Set(rows.map(r => r.fisCode))];
    const results = new Map();
    let done = 0, failed = 0, noPerm = false;
    const queue = [...unique];

    async function worker() {
      while (queue.length) {
        const code = queue.shift();
        const res = await fetchPoints(code, discipline.code);
        results.set(code, res);
        if (!res.ok && res.error === "NO_HOST_PERMISSION") { noPerm = true; queue.length = 0; }
        done++;
        if (!res.ok) failed++;
        rows.filter(r => r.fisCode === code).forEach(r => {
          setCell(r.td, res, code);
          r.points = res.ok && res.value !== null && res.value < 999 ? res.value : null;
        });
        showStatus(`FIS v0.11 ${discipline.code}: hämtar ${done}/${unique.length}…`, "info");
        if (!res.cached) await sleep(DELAY_MS);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));

    if (noPerm) {
      showStatus("FIS v0.11: tillägget saknar åtkomst till fis-ski.com. Klicka på tilläggets ikon i verktygsfältet (pusselbiten) och godkänn, ladda sedan om sidan.", "warning");
      table.dataset.fisKey = "";
      return;
    }

    applyRanks(rows);
    enableSorting(th, rows);

    const withPoints = [...results.values()].filter(r => r.ok && r.value !== null && r.value < 999).length;
    showStatus(
      `FIS v0.11 ${discipline.label} (${discipline.code}) klart: ${withPoints} av ${unique.length} har poäng` +
      (failed ? `, ${failed} misslyckades (markerade med ?)` : "") + ". Klicka på rubriken för att sortera.",
      failed ? "warning" : "success"
    );
  }

  /* ---------- Starta och följ sidan (sidan laddar/byter innehåll dynamiskt) ---------- */

  let pending = null;
  function schedule(delay = 500) {
    clearTimeout(pending);
    pending = setTimeout(() => { run().catch(e => console.error("[FIS-poäng]", e)); }, delay);
  }

  const observer = new MutationObserver(muts => {
    const own = "#fis-ssfta-status, .fis-ssfta-cell, .fis-ssfta-heading";
    const external = muts.some(m => {
      const moved = [...m.addedNodes, ...m.removedNodes];
      if (moved.length && moved.every(n => n.id === "fis-ssfta-status")) return false;
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      return !(el && el.closest && el.closest(own));
    });
    if (external) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  schedule(300);
})();
