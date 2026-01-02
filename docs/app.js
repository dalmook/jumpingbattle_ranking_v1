let RAW = [];
let chart;

const el = (id) => document.getElementById(id);

function parseTS(ts){
  // "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS"
  const t = (ts || "").trim().replace(" ", "T");
  if (t.length === 16) return new Date(t + ":00");
  return new Date(t);
}

function textIncludes(hay, q){
  return (hay || "").toString().toLowerCase().includes((q || "").toLowerCase());
}

function sizeOk(mapName, size){
  if (size === "전체") return true;
  return (mapName || "").startsWith(size + "-");
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
          reverse: true, // 랭크는 낮을수록 좋으니까 위로
          title: { display: true, text: "랭크 (낮을수록 👍)" }
        }
      }
    }
  });
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
    textIncludes(r.team, q) || textIncludes(r.map, q)
  ).slice(0, 80);

  if(!hits.length){
    body.innerHTML = `<tr><td colspan="6" class="muted">"${q}" 결과 없음</td></tr>`;
    return;
  }

  for(const r of hits){
    const nat = (r.nat ?? "") === null ? "" : (r.nat ?? "");
    const loc = (r.loc ?? "") === null ? "" : (r.loc ?? "");
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${r.ts}</td>
        <td>${escapeHtml(r.team)}</td>
        <td>${escapeHtml(r.map)}</td>
        <td>${nat}</td>
        <td>${loc}</td>
        <td>${r.score ?? ""}</td>
      </tr>
    `);
  }
}

function buildBoard(records, wantSize, wantScope){
  // ① (team,map) 별 누적 베스트(score max, nat/loc min)
  const best = new Map(); // key -> {team,map,score,nat,loc}
  for(const r of records){
    if(!sizeOk(r.map, wantSize)) continue;
    const key = `${r.team}||${r.map}`;
    const cur = best.get(key) || { team:r.team, map:r.map, score:null, nat:null, loc:null };

    if (Number.isFinite(r.score)) cur.score = (cur.score === null) ? r.score : Math.max(cur.score, r.score);
    if (Number.isFinite(r.nat))   cur.nat   = (cur.nat === null) ? r.nat   : Math.min(cur.nat, r.nat);
    if (Number.isFinite(r.loc))   cur.loc   = (cur.loc === null) ? r.loc   : Math.min(cur.loc, r.loc);

    best.set(key, cur);
  }

  // ② 맵별 리스트
  const maps = [...new Set([...best.values()].map(v => v.map))].sort();
  const perMap = new Map(); // map -> [{team,score,nat,loc}]
  for(const m of maps) perMap.set(m, []);
  for(const v of best.values()) perMap.get(v.map).push(v);

  // ③ 정렬 후 rank 부여
  const useNat = (wantScope === "전국");
  const board = new Map(); // map -> [{rank, team}]
  let maxRows = 0;

  for(const m of maps){
    const rows = perMap.get(m);
    rows.sort((a,b)=>{
      const as = (a.score ?? -1e18), bs = (b.score ?? -1e18);
      if (bs !== as) return bs - as; // score desc
      const ar = useNat ? (a.nat ?? 1e18) : (a.loc ?? 1e18);
      const br = useNat ? (b.nat ?? 1e18) : (b.loc ?? 1e18);
      if (ar !== br) return ar - br; // rank asc
      return (a.team || "").localeCompare(b.team || "");
    });

    const ranked = rows.map((x, i)=>({ rank:i+1, team:x.team }));
    board.set(m, ranked);
    maxRows = Math.max(maxRows, ranked.length);
  }

  return { maps, board, maxRows: Math.min(maxRows, 200) };
}

function renderBoard(){
  const wantSize = el("size").value;
  const wantScope = el("scope").value;

  const { maps, board, maxRows } = buildBoard(RAW, wantSize, wantScope);
  const wrap = el("boardWrap");

  if(!maps.length){
    wrap.innerHTML = `<div class="muted">표시할 맵이 없어요. (데이터/필터 확인)</div>`;
    return;
  }

  let html = `<table class="board"><thead><tr><th style="width:70px;">순위</th>`;
  for(const m of maps) html += `<th>${escapeHtml(m)}</th>`;
  html += `</tr></thead><tbody>`;

  for(let r=1; r<=maxRows; r++){
    html += `<tr><td class="rankCell">${r}.</td>`;
    for(const m of maps){
      const arr = board.get(m);
      const item = arr?.[r-1];
      if(item?.team){
        const medalClass = r===1 ? "medal1" : r===2 ? "medal2" : r===3 ? "medal3" : "";
        html += `
          <td class="${medalClass}">
            <button class="teamBtn" data-map="${encodeAttr(m)}" data-team="${encodeAttr(item.team)}">
              ${r===1 ? "🥇 " : r===2 ? "🥈 " : r===3 ? "🥉 " : ""}${escapeHtml(item.team)}
            </button>
          </td>`;
      }else{
        html += `<td></td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll(".teamBtn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const map = btn.dataset.map;
      const team = btn.dataset.team;
      renderTeamChart(map, team);
    });
  });
}

function renderTeamChart(mapName, team){
  const pts = RAW
    .filter(r => r.map === mapName && r.team === team)
    .map(r => ({
      t: parseTS(r.ts),
      ts: r.ts,
      nat: Number.isFinite(r.nat) ? r.nat : null,
      loc: Number.isFinite(r.loc) ? r.loc : null,
      score: Number.isFinite(r.score) ? r.score : null
    }))
    .filter(p => !Number.isNaN(p.t.getTime()))
    .sort((a,b)=>a.t-b.t);

  el("chartTitle").textContent = `[${mapName}] ${team} · 날짜별 랭크 변화`;

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
    {
      label: "전국",
      data: pts.map(p => p.nat),
      spanGaps: true,
      tension: 0.25
    },
    {
      label: "지역",
      data: pts.map(p => p.loc),
      spanGaps: true,
      tension: 0.25
    }
  ];
  chart.update();
}

// XSS 방지용(간단)
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

async function boot(){
  loadChart();

  // 캐시 방지(갱신 즉시 반영)
  const res = await fetch("./data.json?v=" + Date.now(), { cache:"no-store" });
  const json = await res.json();
  RAW = (json.records || []).map(r => ({
    ts: r.ts,
    team: r.team || "",
    map: r.map || "",
    nat: (r.nat === "" || r.nat === undefined) ? null : Number(r.nat),
    loc: (r.loc === "" || r.loc === undefined) ? null : Number(r.loc),
    score: (r.score === "" || r.score === undefined) ? null : Number(r.score),
  }));

  el("lastUpdated").textContent = `업데이트: ${json.generated_at || "알 수 없음"} · 데이터 ${json.count || RAW.length}개`;

  // 이벤트
  el("btnSearch").addEventListener("click", renderSearch);
  el("btnClear").addEventListener("click", ()=>{
    el("q").value = "";
    renderSearch();
  });
  el("q").addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){ e.preventDefault(); renderSearch(); }
  });

  el("size").addEventListener("change", renderBoard);
  el("scope").addEventListener("change", renderBoard);

  // 최초 렌더
  renderBoard();
  renderSearch();
}

boot().catch(err=>{
  console.error(err);
  el("boardWrap").innerHTML = `<div class="muted">데이터 로드 실패 😿 (data.json 확인)</div>`;
});
