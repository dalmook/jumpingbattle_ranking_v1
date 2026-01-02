let RAW = [];
let chart;

// 현재 선택 상태
const STATE = {
  size: "전체",
  diff: "전체",
  month: null, // 최신 월로 자동 세팅
};

const SIZES = ["전체", "소형", "중형", "대형"];
const el = (id) => document.getElementById(id);

function parseTS(ts){
  const t = (ts || "").trim().replace(" ", "T");
  if (t.length === 16) return new Date(t + ":00");
  return new Date(t);
}

function monthKey(ts){
  // "YYYY-MM-DD ..." -> "YYYY-MM"
  if (!ts || ts.length < 7) return "";
  return ts.slice(0, 7);
}

function splitMap(mapName){
  const m = (mapName || "").trim();
  const known = ["소형", "중형", "대형"];
  for (const s of known) {
    if (m.startsWith(s + "-")) {
      const rest = m.slice((s + "-").length);
      return { size: s, diff: rest || "" };
    }
  }
  // 예외: "산타맵" 처럼 사이즈가 없는 경우
  const idx = m.indexOf("-");
  if (idx > 0) return { size: m.slice(0, idx), diff: m.slice(idx + 1) };
  return { size: "기타", diff: m };
}

function escapeHtml(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
function encodeAttr(s){
  return escapeHtml(s).replaceAll("\n"," ");
}

function setButtons(containerId, items, activeValue, onClick){
  const box = el(containerId);
  box.innerHTML = "";
  for (const v of items) {
    const btn = document.createElement("button");
    btn.className = "segBtn" + (v === activeValue ? " on" : "");
    btn.type = "button";
    btn.textContent = v;
    btn.addEventListener("click", () => onClick(v));
    box.appendChild(btn);
  }
}

function refreshFilterButtons(){
  // 월 버튼: 데이터에 있는 월들
  const months = [...new Set(RAW.map(r => r.month))].filter(Boolean).sort().reverse();
  if (!STATE.month) STATE.month = months[0] || null;
  if (STATE.month && !months.includes(STATE.month)) STATE.month = months[0] || null;

  // 사이즈 버튼은 고정
  setButtons("sizeSeg", SIZES, STATE.size, (v) => {
    STATE.size = v;
    // 사이즈 바뀌면 난이도 선택이 유효한지 재검증
    if (!getDiffList().includes(STATE.diff)) STATE.diff = "전체";
    renderRanking();
  });

  // 난이도 버튼: 현재 (월 + 사이즈)에서 존재하는 난이도만
  const diffs = getDiffList();
  setButtons("diffSeg", diffs, STATE.diff, (v) => {
    STATE.diff = v;
    renderRanking();
  });

  // 월 버튼
  setButtons("monthSeg", months, STATE.month, (v) => {
    STATE.month = v;
    // 월 바뀌면 난이도 목록도 바뀔 수 있음
    if (!getDiffList().includes(STATE.diff)) STATE.diff = "전체";
    renderRanking();
  });
}

function getDiffList(){
  const set = new Set();
  for (const r of RAW) {
    if (STATE.month && r.month !== STATE.month) continue;
    if (STATE.size !== "전체" && r.size !== STATE.size) continue;
    if (r.diff) set.add(r.diff);
  }
  return ["전체", ...Array.from(set).sort((a,b)=>a.localeCompare(b,"ko"))];
}

function filterForRanking(){
  return RAW.filter(r => {
    if (STATE.month && r.month !== STATE.month) return false;
    if (STATE.size !== "전체" && r.size !== STATE.size) return false;
    if (STATE.diff !== "전체" && r.diff !== STATE.diff) return false;
    // 점수/팀은 최소 조건
    if (!r.team) return false;
    return true;
  });
}

/**
 * ✅ 한 행 = 한 팀
 * 선택된 (월/사이즈/난이도) 조건에서 팀별 최고 점수 1개 레코드만 선택
 * tie-break: score desc → nat asc → loc asc → ts 최신 → team
 */
function buildTeamRows(rows){
  const best = new Map(); // team -> record
  for (const r of rows) {
    const cur = best.get(r.team);
    if (!cur) { best.set(r.team, r); continue; }

    const s1 = (r.score ?? -1e18), s0 = (cur.score ?? -1e18);
    if (s1 > s0) { best.set(r.team, r); continue; }
    if (s1 < s0) continue;

    const n1 = (r.nat ?? 1e18), n0 = (cur.nat ?? 1e18);
    if (n1 < n0) { best.set(r.team, r); continue; }
    if (n1 > n0) continue;

    const l1 = (r.loc ?? 1e18), l0 = (cur.loc ?? 1e18);
    if (l1 < l0) { best.set(r.team, r); continue; }
    if (l1 > l0) continue;

    if ((r.t?.getTime?.() || 0) > (cur.t?.getTime?.() || 0)) { best.set(r.team, r); continue; }

    // 마지막: 팀명 알파
    if ((r.team || "").localeCompare(cur.team || "", "ko") < 0) best.set(r.team, r);
  }

  const out = Array.from(best.values());
  out.sort((a,b)=>{
    const as = (a.score ?? -1e18), bs = (b.score ?? -1e18);
    if (bs !== as) return bs - as;
    const an = (a.nat ?? 1e18), bn = (b.nat ?? 1e18);
    if (an !== bn) return an - bn;
    const al = (a.loc ?? 1e18), bl = (b.loc ?? 1e18);
    if (al !== bl) return al - bl;
    return (a.team || "").localeCompare(b.team || "", "ko");
  });

  return out;
}

function renderRanking(){
  refreshFilterButtons(); // 버튼 상태/목록 동기화

  const rows = filterForRanking();
  const teamRows = buildTeamRows(rows);

  const hint = el("rankHint");
  hint.textContent = `선택: [${STATE.size}] / [${STATE.diff}] / [${STATE.month || "-"}] · 팀 ${teamRows.length}개`;

  const body = el("rankBody");
  body.innerHTML = "";

  if (!STATE.month) {
    body.innerHTML = `<tr><td colspan="6" class="muted">월 데이터가 없어요. data.json 확인!</td></tr>`;
    return;
  }

  if (!teamRows.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted">해당 조건에 데이터가 없어요 😿</td></tr>`;
    return;
  }

  teamRows.slice(0, 200).forEach((r, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
    const nat = Number.isFinite(r.nat) ? r.nat : "-";
    const loc = Number.isFinite(r.loc) ? r.loc : "-";
    const score = Number.isFinite(r.score) ? r.score : "-";

    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td class="rankNum">${rank <= 3 ? `<span class="badgeTop">${medal}</span>` : `${rank}`}</td>
        <td>
          <button class="teamBtn"
                  data-team="${encodeAttr(r.team)}"
                  data-map="${encodeAttr(r.map)}">
            ${escapeHtml(r.team)}
          </button>
        </td>
        <td><b>${score}</b></td>
        <td>${nat}</td>
        <td>${loc}</td>
        <td>${escapeHtml(r.ts)}</td>
      </tr>
    `);
  });

  // 팀 클릭 → 그래프
  body.querySelectorAll(".teamBtn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const team = btn.dataset.team;
      const map = btn.dataset.map;
      renderTeamChart(map, team);
    });
  });
}

function textIncludes(hay, q){
  return (hay || "").toString().toLowerCase().includes((q || "").toLowerCase());
}

function renderSearch(){
  const q = el("q").value.trim();
  const body = el("searchBody");
  body.innerHTML = "";

  if(!q){
    body.innerHTML = `<tr><td colspan="6" class="muted">검색어를 입력하면 결과가 보여요 :)</td></tr>`;
    return;
  }

  const hits = RAW.filter(r =>
    textIncludes(r.team, q) || textIncludes(r.map, q) || textIncludes(r.diff, q) || textIncludes(r.size, q)
  ).slice(0, 120);

  if(!hits.length){
    body.innerHTML = `<tr><td colspan="6" class="muted">"${escapeHtml(q)}" 결과 없음</td></tr>`;
    return;
  }

  for(const r of hits){
    const nat = Number.isFinite(r.nat) ? r.nat : "";
    const loc = Number.isFinite(r.loc) ? r.loc : "";
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(r.ts)}</td>
        <td>${escapeHtml(r.team)}</td>
        <td>${escapeHtml(r.map)}</td>
        <td>${nat}</td>
        <td>${loc}</td>
        <td>${Number.isFinite(r.score) ? r.score : ""}</td>
      </tr>
    `);
  }
}

function loadChart(){
  const ctx = el("chart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top" },
        tooltip: { mode: "index", intersect: false }
      },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        y: {
          reverse: true,
          title: { display: true, text: "랭크 (낮을수록 👍)" }
        }
      }
    }
  });
}

/**
 * 선택된 map/team의 날짜별 랭크 변화
 * (월 필터는 적용하지 않고 전체 기간을 보여줌: 원하면 월만 보이게도 가능)
 */
function renderTeamChart(mapName, team){
  const pts = RAW
    .filter(r => r.map === mapName && r.team === team)
    .map(r => ({
      t: r.t,
      ts: r.ts,
      nat: Number.isFinite(r.nat) ? r.nat : null,
      loc: Number.isFinite(r.loc) ? r.loc : null,
      score: Number.isFinite(r.score) ? r.score : null
    }))
    .filter(p => p.t && !Number.isNaN(p.t.getTime()))
    .sort((a,b)=>a.t-b.t);

  el("chartTitle").textContent = `[${mapName}] ${team} · 랭크 변화`;

  if(!pts.length){
    chart.data.labels = [];
    chart.data.datasets = [];
    chart.update();
    return;
  }

  const labels = pts.map(p => {
    const mm = String(p.t.getMonth()+1).padStart(2,"0");
    const dd = String(p.t.getDate()).padStart(2,"0");
    return `${mm}-${dd}`;
  });

  chart.data.labels = labels;
  chart.data.datasets = [
    { label: "전국", data: pts.map(p => p.nat), spanGaps: true, tension: 0.25 },
    { label: "지점", data: pts.map(p => p.loc), spanGaps: true, tension: 0.25 }
  ];
  chart.update();
}

async function boot(){
  loadChart();

  // cache bust
  const res = await fetch("./data.json?v=" + Date.now(), { cache:"no-store" });
  const json = await res.json();

  RAW = (json.records || []).map(r => {
    const t = parseTS(r.ts);
    const sp = splitMap(r.map || "");
    return {
      ts: r.ts,
      t,
      month: monthKey(r.ts),
      team: r.team || "",
      map: r.map || "",
      size: sp.size,
      diff: sp.diff,
      nat: (r.nat === "" || r.nat === undefined || r.nat === null) ? null : Number(r.nat),
      loc: (r.loc === "" || r.loc === undefined || r.loc === null) ? null : Number(r.loc),
      score: (r.score === "" || r.score === undefined || r.score === null) ? null : Number(r.score),
    };
  });

  el("lastUpdated").textContent = `업데이트: ${json.generated_at || "알 수 없음"} · ${json.count || RAW.length}개`;

  // 검색 이벤트
  el("btnSearch").addEventListener("click", renderSearch);
  el("btnClear").addEventListener("click", ()=>{
    el("q").value = "";
    renderSearch();
  });
  el("q").addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){ e.preventDefault(); renderSearch(); }
  });

  // 초기 렌더
  renderRanking();
  renderSearch();
}

boot().catch(err=>{
  console.error(err);
  el("rankBody").innerHTML = `<tr><td colspan="6" class="muted">data.json 로드 실패 😿</td></tr>`;
});
