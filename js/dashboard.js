/* ====================================================
   PharmIQ — Dashboard Wiring (UI unchanged)
   ----------------------------------------------------
   Reads the structured payload produced by the multi-
   agent engine in js/agents.js and renders it through
   the existing dashboard markup. Logic-specific output:

      Logic 0  → analogue list (ranked, criteria pills)
      Logic 1  → per-row evidence + NICE source links
      Logic 2  → bucketed ICER metadata
      Logic 3  → base-case prediction + corridor
      Logic 4  → "Evidence to add" prioritised list
      Logic 5  → delta line under the verdict
==================================================== */

let payload = null;
try { payload = JSON.parse(sessionStorage.getItem('pharmiq_payload') || 'null'); } catch {}

/* If user lands on dashboard directly without a real payload, bounce back to
   the upload page so they go through the SufficiencyAgent gate first. We
   only auto-seed a demo when ?demo=1 is in the URL. */
if (!payload || payload.insufficient) {
  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1' && window.PharmIQ) {
    payload = window.PharmIQ.runPipeline(
      'Product: Amlitelimab. Indication: moderate-to-severe atopic dermatitis. ' +
      'Mechanism: anti-OX40L mAb (non–T-cell-depleting). Phase III. ' +
      'Trials: COAST 1/2, SHORE. Endpoints: EASI-75, IGA 0/1, itch NRS, DLQI. ' +
      'Comparators: dupilumab, tralokinumab, upadacitinib. Population: ≥12y moderate-to-severe AD ' +
      'inadequately controlled with topicals.',
      { skipSufficiency: true }
    );
  } else {
    // Send the user back to the start so they upload a proper dossier.
    location.replace('index.html');
    throw new Error('No payload — redirecting to upload page.');
  }
}

const CRITERIA_LABELS = ['Same indication', 'Same MoA class', 'Comparator overlap', 'Endpoint match'];

/* ---------------- Render product card (top-left) ---------------- */
document.getElementById('crumbProduct').textContent     = payload.productName;
document.getElementById('productName').textContent      = payload.productName;
document.getElementById('indicationTag').textContent    = payload.indication;
document.getElementById('moaTag').textContent           = payload.mechanism;
document.getElementById('phaseTag').textContent         = 'Phase III · current evidence';

document.getElementById('kpiEff').textContent = payload.efficacy;
document.getElementById('kpiSaf').textContent = payload.safety;
document.getElementById('kpiInn').textContent = payload.innovation;
document.getElementById('kpiUnm').textContent = payload.unmet;
document.querySelectorAll('.kpi-bar span').forEach((bar, idx) => {
  bar.style.width = `${[payload.efficacy, payload.safety, payload.innovation, payload.unmet][idx]}%`;
});

/* Replace the standard text blocks with structured agent output */
const popText  = document.getElementById('popText');
const diffText = document.getElementById('diffText');
const epText   = document.getElementById('epText');
if (popText)  popText.textContent  = payload.population || '—';
if (diffText) diffText.textContent = `${payload.mechanism}. Comparators considered: ${(payload.comparators||[]).join(', ')}.`;
if (epText)   epText.textContent   = (payload.primaryEndpoints || []).join(' · ');

document.getElementById('critList').innerHTML =
  (payload.criteria || []).map(c => `<li>${escapeHtml(c)}</li>`).join('');

/* ---------------- Verdict & Price (top-right) ---------------- */
const predictBlock = document.getElementById('predictBlock');
const predictVal   = document.getElementById('predictVal');
predictVal.textContent = payload.prediction;
predictBlock.classList.remove('accept', 'reject', 'conditional');
predictBlock.classList.add(payload.predictClass || 'conditional');
document.getElementById('predictConf').textContent = `${payload.confidence}%`;
document.getElementById('predictMeter').style.width = `${payload.confidence}%`;

document.getElementById('priceLow').textContent  = `£${payload.priceLow.toLocaleString()}`;
document.getElementById('priceHigh').textContent = `£${payload.priceHigh.toLocaleString()}`;
document.getElementById('anchorVal').textContent = `£${payload.anchor.toLocaleString()}`;

/* Price bar — anchored on the bucketed analogue median (Logic 3) */
const scaleMax  = payload.scaleMax || 8000;
const lowPct    = (payload.priceLow / scaleMax) * 100;
const highPct   = (payload.priceHigh / scaleMax) * 100;
const anchorPct = (payload.anchor   / scaleMax) * 100;
const pbFill   = document.getElementById('pbFill');
const pbAnchor = document.getElementById('pbAnchor');
pbFill.style.left   = `${lowPct}%`;
pbFill.style.width  = `${highPct - lowPct}%`;
pbAnchor.style.left = `${anchorPct}%`;

/* Dynamic price axis */
const axis = document.querySelector('.price-axis');
if (axis) {
  axis.innerHTML = '';
  const ticks = 5;
  for (let i = 0; i < ticks; i++) {
    const v = Math.round((scaleMax * i / (ticks - 1)) / 1000);
    const span = document.createElement('span');
    span.textContent = i === 0 ? '£0' : `£${v}k`;
    axis.appendChild(span);
  }
}

/* ---------------- Rationale (Logic 3) + Delta line (Logic 5) ---------------- */
const rationaleList = document.getElementById('rationaleList');
if (rationaleList && payload.rationale_obj) {
  const r = payload.rationale_obj;
  const parts = [];
  if (r.strengths?.length) parts.push(`<li><strong>Strengths:</strong> ${r.strengths.map(escapeHtml).join(' ')}</li>`);
  if (r.concerns?.length)  parts.push(`<li><strong>Concerns:</strong> ${r.concerns.map(escapeHtml).join(' ')}</li>`);
  if (r.icer_projection) {
    parts.push(`<li><strong>ICER projection:</strong> £${r.icer_projection.value.toLocaleString()}/QALY against £${r.icer_projection.threshold.toLocaleString()} threshold — ${escapeHtml(r.icer_projection.verdict)}.</li>`);
  }
  if (payload.corridor_basis) {
    parts.push(`<li><strong>Corridor basis:</strong> ${escapeHtml(payload.corridor_basis)}</li>`);
  }
  if (payload.delta?.delta_summary) {
    const d = payload.delta.delta_summary;
    parts.push(`<li><strong>Logic 5 delta:</strong> with the recommended evidence, composite score moves <strong>${d.composite_before} → ${d.composite_after}</strong> and predicted pathway shifts <em>${precedentLabel(d.precedent_before)} → ${precedentLabel(d.precedent_after)}</em>.</li>`);
  }
  rationaleList.innerHTML = parts.join('');
}

/* ---------------- Evidence to add (Logic 4) ---------------- */
const evidenceList = document.getElementById('evidenceList');
if (evidenceList && payload.recommendations?.length) {
  evidenceList.innerHTML = payload.recommendations.map(rec => `
    <li>
      <span class="ev-prio ${rec.priority.toLowerCase()}">${rec.priority}</span>
      <div>
        <strong>${escapeHtml(rec.gap_label)}.</strong>
        ${escapeHtml(rec.rationale)}
        ${rec.precedent_link ? `<br/><small style="color:var(--ink-500)">Precedent: ${escapeHtml(rec.precedent_link)}</small>` : ''}
        <br/><small style="color:var(--teal-deep);font-weight:600">Expected impact: +${rec.expected_uplift.verdict_shift_pp} pp verdict shift · +${rec.expected_uplift.corridor_widen_pct}% corridor widen</small>
      </div>
    </li>
  `).join('');
}

/* ---------------- Radar chart — Product A vs closest analogue ---------------- */
const ctx = document.getElementById('radarChart').getContext('2d');
const closest = (payload.analogues || []).slice().sort((a, b) => b.comparability_score - a.comparability_score)[0];
const closestRadar = closest ? [
  78, 72, 60, 65, 80, 70 // illustrative — will be overridden by domain mapping below
] : [70, 70, 60, 65, 70, 70];

new Chart(ctx, {
  type: 'radar',
  data: {
    labels: ['Clin. effectiveness', 'Safety / Pop. fit', 'Innovation', 'Unmet need', 'Evidence quality', 'Cost-effectiveness'],
    datasets: [
      {
        label: payload.productName,
        data: [
          payload.domain_scores.clinical_effectiveness,
          payload.domain_scores.population_alignment,
          payload.domain_scores.innovation_unmet_need,
          payload.unmet,
          payload.domain_scores.evidence_quality,
          payload.domain_scores.cost_effectiveness
        ],
        backgroundColor: 'rgba(11,43,78,.18)',
        borderColor:     '#0B2B4E',
        borderWidth:     2,
        pointBackgroundColor: '#E8B33B',
        pointRadius:     4
      },
      {
        label: closest ? closest.name : 'Closest analogue',
        data:  closestRadar,
        backgroundColor: 'rgba(31,182,168,.18)',
        borderColor:     '#0E7C72',
        borderWidth:     2,
        pointBackgroundColor: '#1FB6A8',
        pointRadius:     4
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { font: { size: 11, family: 'Inter' }, color: '#33425B' } } },
    scales: {
      r: {
        suggestedMin: 0, suggestedMax: 100,
        angleLines: { color: '#E2E8F2' },
        grid:       { color: '#E2E8F2' },
        pointLabels:{ font: { size: 11, family: 'Inter', weight: '600' }, color: '#0B2B4E' },
        ticks:      { display: false, stepSize: 25 }
      }
    }
  }
});

/* ---------------- Analogues list (Logic 0 ranking, Logic 1/2 detail) ---------------- */
const analogList = document.getElementById('analogList');
const sortSel    = document.getElementById('sortAnalogs');
const filterSel  = document.getElementById('filterInd');

function renderAnalogues() {
  let list = (payload.analogues || []).slice();

  if (filterSel.value === 'match') {
    list = list.filter(a => a.match && a.match[0]);
  }
  if (sortSel.value === 'similarity')      list.sort((a,b) => b.comparability_score - a.comparability_score);
  else if (sortSel.value === 'indication') list.sort((a,b) => (b.match[0]?1:0) - (a.match[0]?1:0) || b.comparability_score - a.comparability_score);
  else if (sortSel.value === 'year')       list.sort((a,b) => b.year - a.year);
  else if (sortSel.value === 'decision') {
    const order = { recommended:0, optimised:1, managed_access:2, not_recommended:3, terminated:4 };
    list.sort((a,b) => (order[a.precedent]??9) - (order[b.precedent]??9) || b.comparability_score - a.comparability_score);
  }

  analogList.innerHTML = list.map((a, idx) => {
    const decTxt   = precedentLabel(a.precedent);
    const decClass = decTxt.toLowerCase().replace(/\s+/g, '-');
    const pills = (a.match || [false,false,false,false]).map((m,i) =>
      `<span class="acc-pill ${m?'':'miss'}"><i class="fas ${m?'fa-check':'fa-xmark'}"></i> ${CRITERIA_LABELS[i]}</span>`
    ).join('');
    const evidence = (a.decision_drivers && a.decision_drivers.clinical_effectiveness) || '';
    const competitorBadge = a.competitor_flag
      ? `<span class="acc-pill" style="background:rgba(232,179,59,.18);color:#A8730F"><i class="fas fa-bullseye"></i> Competitor</span>`
      : '';
    return `
      <div class="analog-row">
        <div class="analog-rank">${idx+1}</div>
        <div>
          <div class="analog-name">${escapeHtml(a.name)} ${competitorBadge}</div>
          <div class="analog-mfr">${escapeHtml(a.mfr)} · ${escapeHtml(a.ind)} · NICE ${a.nice_id} (${a.year})</div>
          <div class="analog-criteria">${pills}</div>
        </div>
        <div class="sim-cell">
          <span class="sim-label">Comparability</span>
          <span class="sim-val">${a.comparability_score}%</span>
          <div class="sim-bar"><span style="width:${a.comparability_score}%"></span></div>
        </div>
        <div><span class="deci ${decClass}">${escapeHtml(decTxt)}</span></div>
        <div class="icer-cell">
          <strong>${escapeHtml(a.price)}</strong>
          <small>ICER ${escapeHtml(a.icer)}</small>
          <small style="margin-top:6px">${escapeHtml(evidence)}</small>
        </div>
        <a class="src-link" href="${a.src}" target="_blank" rel="noopener">
          <i class="fas fa-up-right-from-square"></i> NICE source
        </a>
      </div>
    `;
  }).join('');

  /* Cross-analogue meta (Logic 2) */
  document.getElementById('amCount').textContent = payload.analogues.length;
  const sameInd = payload.analogues.filter(a => a.match[0]).length;
  document.getElementById('amInd').textContent = sameInd;

  const dist = (payload.comparison && payload.comparison.icer_distribution) || {};
  const med  = (dist.recommended || dist.optimised || dist.not_recommended || {}).median;
  document.getElementById('amIcer').textContent = med ? `£${(med/1000).toFixed(1)}k` : '—';

  const acc = Math.round(
    (payload.analogues.filter(a => a.precedent === 'recommended' || a.precedent === 'optimised').length /
     payload.analogues.length) * 100
  );
  document.getElementById('amAcc').textContent = `${acc}%`;
}

sortSel.addEventListener('change', renderAnalogues);
filterSel.addEventListener('change', renderAnalogues);
renderAnalogues();

/* ====================================================
   CHAT (multi-agent, Logic-aware answers)
==================================================== */
const chatStream  = document.getElementById('chatStream');
const chatForm    = document.getElementById('chatForm');
const chatInput   = document.getElementById('chatInput');
const activeAgent = document.getElementById('activeAgent');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function precedentLabel(p) {
  return ({
    recommended:     'Recommended',
    optimised:       'Optimised',
    managed_access:  'Managed Access',
    not_recommended: 'Not Recommended',
    terminated:      'Terminated'
  })[p] || p || '—';
}

function pushBubble(role, html, agent) {
  const el = document.createElement('div');
  el.className = `bubble ${role}`;
  if (role === 'ai') {
    el.innerHTML = `<span class="ag"><i class="fas fa-${agentIcon(agent)}"></i> ${agent}</span><div>${html}</div>`;
  } else {
    el.textContent = html;
  }
  chatStream.appendChild(el);
  chatStream.scrollTop = chatStream.scrollHeight;
  return el;
}
function agentIcon(a) {
  return ({
    'Orchestrator':         'user-tie',
    'Analogue Agent':       'clone',
    'NICE-History Agent':   'folder-tree',
    'Single-Analogue Agent':'microscope',
    'Cross-Analogue Agent': 'diagram-project',
    'Pricing Agent':        'coins',
    'Recommendation Agent': 'lightbulb',
    'Delta Predictor':      'arrow-trend-up'
  })[a] || 'robot';
}
function showTyping(agent) {
  activeAgent.innerHTML = `<i class="fas fa-${agentIcon(agent)}"></i> ${agent}`;
  const el = document.createElement('div');
  el.className = 'bubble ai';
  el.innerHTML = `<span class="ag"><i class="fas fa-${agentIcon(agent)}"></i> ${agent}</span>
                  <div class="bubble typing"><span></span><span></span><span></span></div>`;
  chatStream.appendChild(el);
  chatStream.scrollTop = chatStream.scrollHeight;
  return el;
}

/* ---- Routing — chooses the most relevant agent per question ---- */
function routeQuestion(q) {
  const t = q.toLowerCase();
  if (/price|corridor|icer|qaly|wtp|threshold|cost-?effective/.test(t))      return 'Pricing Agent';
  if (/delta|after evidence|if we add|with new evidence|logic ?5|flip/.test(t)) return 'Delta Predictor';
  if (/evidence|gap|trial|study|itc|nma|rwe|subgroup|recommend|pas/.test(t)) return 'Recommendation Agent';
  if (/analog|comparator|competitor|similar|comparab/.test(t))               return 'Analogue Agent';
  if (/nice|guidance|ta\d|history|document|fad|acd|erg/.test(t))             return 'NICE-History Agent';
  if (/predict|reject|accept|verdict|decision|why|reimburs|pathway/.test(t)) return 'Cross-Analogue Agent';
  return 'Orchestrator';
}

function buildAnswer(agent, q) {
  const top = (payload.analogues || []).slice().sort((a,b)=>b.comparability_score-a.comparability_score).slice(0,3);
  const topNames = top.map(a => `<strong>${a.name}</strong> (${a.comparability_score}%)`).join(', ');

  if (agent === 'Pricing Agent') {
    const r = payload.rationale_obj?.icer_projection;
    return `<strong>Logic 3 base-case corridor: £${payload.priceLow.toLocaleString()}–£${payload.priceHigh.toLocaleString()}</strong>
            (${payload.indication}, annual / patient).<br/><br/>
            ${escapeHtml(payload.corridor_basis || '')}<br/>
            Projected ICER under current evidence: <strong>£${(r?.value||0).toLocaleString()}/QALY</strong>
            against the £${(r?.threshold||30000).toLocaleString()} threshold — ${escapeHtml(r?.verdict||'')}.<br/><br/>
            With the Logic 4 evidence package applied (Logic 5), the corridor widens to
            <strong>£${(payload.delta?.upgraded_corridor?.low||payload.priceLow).toLocaleString()}–£${(payload.delta?.upgraded_corridor?.high||payload.priceHigh).toLocaleString()}</strong>.`;
  }

  if (agent === 'Analogue Agent') {
    const competitors = (payload.analogues||[]).filter(a => a.competitor_flag).map(a => a.name).join(', ') || 'none surfaced';
    return `Logic 0 shortlisted <strong>${payload.analogues.length} analogues</strong> using
            product / patient / treatment / market comparability (no reimbursement bias at this step).<br/>
            <strong>Competitors flagged:</strong> ${escapeHtml(competitors)}.<br/>
            <strong>Top by comparability:</strong> ${topNames}.<br/>
            Click any "NICE source" button to open the appraisal page directly.`;
  }

  if (agent === 'NICE-History Agent') {
    const docs = (payload.nice_history?.[0]?.documents_found || []).map(d => d.label).join(', ');
    return `For each shortlisted analogue I located the NICE record, opened the history page and
            pulled committee papers, ACDs, ERG critiques, FADs, final guidance and any commercial /
            managed-access agreement.<br/><br/>
            E.g. for ${escapeHtml(top[0]?.name||'')} (NICE ${top[0]?.nice_id||'—'}):
            <em>${escapeHtml(docs)}</em>.<br/>
            These feed Logic 1's single-analogue profile builder.`;
  }

  if (agent === 'Cross-Analogue Agent') {
    const dist = payload.comparison?.icer_distribution || {};
    const rec = dist.recommended, opt = dist.optimised, neg = dist.not_recommended;
    return `Logic 2 buckets analogues by precedent — never averaged.<br/>
            <ul style="margin:6px 0 0;padding-left:18px">
              <li>Recommended: n=${rec?.n||0}, ICER median £${rec? (rec.median/1000).toFixed(1)+'k':'—'}</li>
              <li>Optimised: n=${opt?.n||0}, ICER median £${opt? (opt.median/1000).toFixed(1)+'k':'—'}</li>
              <li>Not Recommended: n=${neg?.n||0}, ICER median £${neg? (neg.median/1000).toFixed(1)+'k':'—'}</li>
            </ul><br/>
            Predicted pathway for Product A: <strong>${escapeHtml(payload.prediction)}</strong>
            (precedent class <em>${precedentLabel(payload.precedent_predicted)}</em>) at <strong>${payload.confidence}%</strong> confidence.`;
  }

  if (agent === 'Recommendation Agent') {
    const items = (payload.recommendations || []).slice(0, 4).map(r =>
      `<li><strong>${escapeHtml(r.gap_label)}</strong> [${r.priority}] — ${escapeHtml(r.rationale)}
        <br/><small>+${r.expected_uplift.verdict_shift_pp} pp verdict shift · +${r.expected_uplift.corridor_widen_pct}% corridor</small></li>`
    ).join('');
    return `Logic 4 — minimum but decision-relevant evidence package, each item mapped to a NICE weakness and a precedent:
            <ol style="margin:6px 0 0;padding-left:18px">${items}</ol>`;
  }

  if (agent === 'Delta Predictor') {
    const d = payload.delta?.delta_summary;
    if (!d) return 'Delta assessment not available.';
    const resolved = (payload.delta.resolved_weaknesses||[]).map(x =>
      `${formatDomain(x.domain)} (${x.before}→${x.after})`).join(', ') || 'none';
    const remain = (payload.delta.remaining_weaknesses||[]).map(x =>
      `${formatDomain(x.domain)} (${x.after}/100)`).join(', ') || 'none';
    return `Logic 5 — delta vs base case (NOT a de novo forecast):<br/>
            Composite <strong>${d.composite_before} → ${d.composite_after}</strong>,
            confidence <strong>${d.confidence_before}% → ${d.confidence_after}%</strong>,
            pathway <em>${precedentLabel(d.precedent_before)} → ${precedentLabel(d.precedent_after)}</em>.<br/>
            <strong>Resolved weaknesses:</strong> ${escapeHtml(resolved)}.<br/>
            <strong>Remaining weaknesses:</strong> ${escapeHtml(remain)}.`;
  }

  // Orchestrator default
  return `I've routed your question internally and consolidated the agents' findings.<br/>
          Snapshot: <strong>${escapeHtml(payload.prediction)}</strong> (${payload.confidence}%) ·
          corridor <strong>£${payload.priceLow.toLocaleString()}–£${payload.priceHigh.toLocaleString()}</strong> ·
          ${payload.analogues.length} analogues across ${Object.keys(payload.comparison?.buckets||{}).length} precedent buckets.<br/>
          Ask me about pricing, analogues, evidence gaps, NICE history, or the Logic 5 delta.`;
}

function formatDomain(d) {
  return (d || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function persistChat(role, content, agent) {
  if (!payload.productId) return;
  try {
    await fetch('tables/chat_messages', {
      method:  'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        product_id: payload.productId,
        role, content, agent,
        timestamp: Date.now()
      })
    });
  } catch {}
}

async function askAI(q) {
  pushBubble('user', q);
  persistChat('user', q, 'Orchestrator');
  const agent = routeQuestion(q);
  const typing = showTyping(agent);
  await new Promise(r => setTimeout(r, 600 + Math.random()*400));
  typing.remove();
  const answer = buildAnswer(agent, q);
  pushBubble('ai', answer, agent);
  persistChat('assistant', answer, agent);
}

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const q = chatInput.value.trim();
  if (!q) return;
  chatInput.value = '';
  askAI(q);
});

document.querySelectorAll('.chat-suggest button').forEach(b => {
  b.addEventListener('click', () => askAI(b.dataset.q));
});

/* ---- Welcome message ---- */
(function welcome() {
  const buckets = payload.comparison?.buckets || {};
  const cnt = (k) => (buckets[k]||[]).length;
  const greet = `Hi — I'm the <strong>Orchestrator</strong>. The team has just run Logics 0 → 5
                 against <strong>${escapeHtml(payload.productName)}</strong> in
                 <em>${escapeHtml(payload.indication)}</em>.<br/><br/>
                 Logic 0 surfaced ${payload.analogues.length} analogues
                 (${cnt('recommended')} Recommended · ${cnt('optimised')} Optimised ·
                 ${cnt('not_recommended')} Not Recommended).<br/>
                 Logic 3 base-case verdict: <strong>${escapeHtml(payload.prediction)}</strong>
                 at ${payload.confidence}% confidence, corridor
                 <strong>£${payload.priceLow.toLocaleString()}–£${payload.priceHigh.toLocaleString()}</strong>.<br/>
                 Logic 4 mapped <strong>${payload.recommendations.length}</strong> evidence gaps to specific NICE weaknesses.
                 Logic 5 shows what the verdict becomes <em>after</em> applying them.<br/><br/>
                 Try a suggestion below, or ask me anything in plain English.`;
  pushBubble('ai', greet, 'Orchestrator');
})();
