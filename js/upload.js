/* ====================================================
   PharmIQ — Upload Page Wiring (UI mostly unchanged)
   ----------------------------------------------------
   Adds a SUFFICIENCY GATE in front of the multi-agent
   pipeline. If the uploaded dossier doesn't carry the
   minimum information needed for Logic 0–5, the user
   sees a notice modal listing exactly what to add.
==================================================== */

const fileInput   = document.getElementById('fileInput');
const uploadBtn   = document.getElementById('uploadBtn');
const pasteText   = document.getElementById('pasteText');
const fileList    = document.getElementById('fileList');
const analyseBtn  = document.getElementById('analyseBtn');
const overlay     = document.getElementById('overlay');
const overlayBar  = document.getElementById('overlayBar');
const overlayStep = document.getElementById('overlayStep');
const overlayTitle= document.getElementById('overlayTitle');

/* Notice modal handles */
const noticeOverlay  = document.getElementById('noticeOverlay');
const noticeMissing  = document.getElementById('noticeMissing');
const noticeWarnings = document.getElementById('noticeWarnings');
const noticeSummary  = document.getElementById('noticeSummary');
const noticeClose    = document.getElementById('noticeClose');
const noticeDismiss  = document.getElementById('noticeDismiss');
const noticeForce    = document.getElementById('noticeForce');

let uploadedFiles = [];
let lastDossierText = ''; // remembered so "Run anyway" can re-use it

uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  for (const f of e.target.files) uploadedFiles.push(f);
  renderFiles();
  toggleAnalyse();
});

pasteText.addEventListener('input', toggleAnalyse);

function toggleAnalyse() {
  const ok = uploadedFiles.length > 0 || pasteText.value.trim().length > 30;
  analyseBtn.disabled = !ok;
}

function renderFiles() {
  fileList.innerHTML = uploadedFiles.map((f, i) => `
    <div class="file-pill">
      <i class="fas fa-file-lines"></i>
      <span>${escapeHtml(f.name)}</span>
      <span style="color:var(--ink-300);font-size:12px">${(f.size/1024).toFixed(1)} KB</span>
      <i class="fas fa-xmark rm" data-i="${i}"></i>
    </div>
  `).join('');
  fileList.querySelectorAll('.rm').forEach(el => {
    el.addEventListener('click', () => {
      uploadedFiles.splice(parseInt(el.dataset.i, 10), 1);
      renderFiles();
      toggleAnalyse();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function readFileAsText(file) {
  return new Promise((resolve) => {
    if (!/\.(txt|md)$/i.test(file.name)) {
      // PDF/DOCX/PPTX text would normally be parsed server-side. For binary
      // dossiers we forward the filename so the SufficiencyAgent and the
      // DossierAgent can still pick up known compound names like
      // "amlitelimab" or "atopic_dermatitis" from the filename itself.
      resolve(`[BINARY DOSSIER: ${file.name}]\n${file.name.replace(/[_\-.]/g, ' ')}`);
      return;
    }
    const r = new FileReader();
    r.onload  = () => resolve(String(r.result || ''));
    r.onerror = () => resolve('');
    r.readAsText(file);
  });
}

/* ====================================================
   SUFFICIENCY NOTICE MODAL
==================================================== */
function showNotice(check) {
  // Summary chips at top
  noticeSummary.innerHTML = `
    <div class="ns-item"><span class="ns-label">Indication</span>
      <span class="ns-val ${check.summary.indication==='—'?'muted':''}">${escapeHtml(check.summary.indication)}</span></div>
    <div class="ns-item"><span class="ns-label">Mechanism</span>
      <span class="ns-val ${check.summary.mechanism==='—'?'muted':''}">${escapeHtml(check.summary.mechanism)}</span></div>
    <div class="ns-item"><span class="ns-label">Endpoints</span>
      <span class="ns-val ${check.summary.endpoints_count?'':'muted'}">${check.summary.endpoints_count} listed</span></div>
    <div class="ns-item"><span class="ns-label">Comparators</span>
      <span class="ns-val ${check.summary.comparators_count?'':'muted'}">${check.summary.comparators_count} listed</span></div>
  `;

  // Missing (hard-required)
  if (check.missing.length === 0) {
    noticeMissing.innerHTML = `<li><div class="nl-field"><i class="fas fa-circle-check" style="color:var(--green);margin-right:6px"></i>All required fields detected.</div></li>`;
  } else {
    noticeMissing.innerHTML = check.missing.map(m => `
      <li>
        <div class="nl-field">${escapeHtml(m.field)}</div>
        <div class="nl-why">${escapeHtml(m.why)}</div>
        ${m.example ? `<div class="nl-example"><i class="fas fa-lightbulb"></i><span>${escapeHtml(m.example)}</span></div>` : ''}
      </li>
    `).join('');
  }

  // Warnings (soft)
  if (check.warnings.length === 0) {
    noticeWarnings.innerHTML = `<li><div class="nl-field"><i class="fas fa-circle-check" style="color:var(--green);margin-right:6px"></i>No additional recommendations.</div></li>`;
  } else {
    noticeWarnings.innerHTML = check.warnings.map(w => `
      <li>
        <div class="nl-field">${escapeHtml(w.field)}</div>
        <div class="nl-why">${escapeHtml(w.message)}</div>
      </li>
    `).join('');
  }

  noticeOverlay.classList.add('show');
  noticeOverlay.setAttribute('aria-hidden', 'false');
}

function hideNotice() {
  noticeOverlay.classList.remove('show');
  noticeOverlay.setAttribute('aria-hidden', 'true');
}

noticeClose.addEventListener('click', hideNotice);
noticeDismiss.addEventListener('click', hideNotice);

/* "Run anyway with assumptions" — bypasses the gate but keeps user informed. */
noticeForce.addEventListener('click', async () => {
  hideNotice();
  await runAgentPipeline(lastDossierText, /* skipSufficiency */ true);
});

/* ====================================================
   MAIN: read inputs → sufficiency check → run pipeline
==================================================== */
analyseBtn.addEventListener('click', async () => {
  const fileTexts = await Promise.all(uploadedFiles.map(readFileAsText));
  const combined  = [pasteText.value, ...fileTexts].filter(Boolean).join('\n\n');
  lastDossierText = combined;

  // 1. Sufficiency gate — if user input is insufficient, show notice and
  //    return them to the upload page (no agents are dispatched).
  const check = window.PharmIQ.checkSufficiency(combined);
  if (!check.ok) {
    showNotice(check);
    return;
  }

  // 2. Sufficient — run the full agent pipeline.
  await runAgentPipeline(combined, /* skipSufficiency */ false);
});

async function runAgentPipeline(dossierText, skipSufficiency) {
  overlay.classList.add('show');
  const steps = [
    ['Orchestrator is reading the dossier…',                'Logic 0 · Extracting indication, MoA, population, endpoints'],
    ['Analogue Agent is shortlisting comparators…',         'Logic 0 · Scoring product / patient / treatment / market comparability'],
    ['NICE-History Agent is pulling the document set…',     'Locating committee papers, ERG critiques, FAD, PAS notes'],
    ['Single-Analogue Agents are profiling each TA…',       'Logic 1 · Decision drivers across 10 NICE domains'],
    ['Cross-Analogue Agent is bucketing precedents…',       'Logic 2 · Recommended / Optimised / Managed-access / Not Recommended'],
    ['Pricing Agent is building the base-case corridor…',   'Logic 3 · ICER vs threshold + analogue ICER distribution'],
    ['Recommendation Agent is mapping evidence gaps…',      'Logic 4 · Min decision-relevant evidence package'],
    ['Delta Predictor is rerunning with new evidence…',     'Logic 5 · Resolved vs remaining weaknesses'],
    ['Compiling your dashboard…',                           'Finalising NICE-style brief']
  ];
  let i = 0;
  const tick = setInterval(() => {
    if (i >= steps.length) return;
    overlayTitle.textContent = steps[i][0];
    overlayStep.textContent  = steps[i][1];
    overlayBar.style.width   = `${((i+1)/steps.length)*100}%`;
    i++;
  }, 600);

  // Run the deterministic pipeline (Logics 0–5).
  let payload;
  try {
    payload = window.PharmIQ.runPipeline(dossierText, { skipSufficiency: !!skipSufficiency });
  } catch (err) {
    console.error('Pipeline failure', err);
    clearInterval(tick);
    overlay.classList.remove('show');
    alert('Analysis failed — please retry. See console for details.');
    return;
  }

  // Defensive: pipeline can still return insufficient if no analogue library
  // is available for the detected indication.
  if (payload && payload.insufficient) {
    clearInterval(tick);
    overlay.classList.remove('show');
    showNotice(payload.sufficiency);
    return;
  }

  // Persist product (best-effort)
  const productPayload = {
    product_name:          payload.productName,
    indication:            payload.indication,
    mechanism:             payload.mechanism,
    efficacy_score:        payload.efficacy,
    safety_score:          payload.safety,
    innovation_score:      payload.innovation,
    price_low:             payload.priceLow,
    price_high:            payload.priceHigh,
    prediction:            mapPredictionToTable(payload.prediction),
    prediction_confidence: payload.confidence,
    rationale:             buildRationaleSummary(payload),
    raw_doc:               dossierText.slice(0, 4000),
    criteria:              payload.criteria,
    recommendations:       payload.recommendations.map(r => r.gap_label)
  };

  let productId = null;
  try {
    const res = await fetch('tables/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(productPayload)
    });
    const created = await res.json();
    productId = created.id;
  } catch (e) {
    console.warn('Product persistence skipped', e);
  }

  if (productId) {
    try {
      await Promise.all(payload.analogues.map(a =>
        fetch('tables/analogs', {
          method:  'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({
            product_id:     productId,
            name:           a.name,
            manufacturer:   a.mfr,
            indication:     a.ind,
            similarity:     a.comparability_score,
            decision:       precedentToDecision(a.precedent),
            price:          a.price,
            icer:           a.icer,
            approval_year:  a.year,
            key_evidence:   a.decision_drivers && a.decision_drivers.clinical_effectiveness,
            source_link:    a.src,
            match_criteria: (a.match || []).map(String)
          })
        })
      ));
    } catch (e) { console.warn('Analogue persistence skipped', e); }
  }

  // Cache full payload locally for the dashboard.
  try {
    sessionStorage.setItem('pharmiq_payload', JSON.stringify({ ...payload, productId }));
  } catch {}

  // Wait for the overlay timeline to finish.
  await new Promise(r => setTimeout(r, steps.length * 600 + 100));
  clearInterval(tick);

  overlayTitle.textContent = 'Analysis complete — opening dashboard';
  overlayStep.textContent  = `Methodology: ${payload.methodology_version}`;
  overlayBar.style.width   = '100%';
  setTimeout(() => { window.location.href = 'dashboard.html'; }, 500);
}

function mapPredictionToTable(label) {
  const t = (label || '').toLowerCase();
  if (t.includes('not recommend')) return 'Reject';
  if (t.includes('managed') || t.includes('conditional') || t.includes('restricted')) return 'Conditional';
  if (t.includes('recommend')) return 'Accept';
  return 'Conditional';
}

function precedentToDecision(p) {
  return ({
    recommended:     'Recommended',
    optimised:       'Optimised',
    managed_access:  'Optimised',
    not_recommended: 'Not Recommended',
    terminated:      'Terminated'
  })[p] || 'Optimised';
}

function buildRationaleSummary(p) {
  const r = p.rationale_obj || {};
  const strengths = (r.strengths || []).join(' ');
  const concerns  = (r.concerns  || []).join(' ');
  return `Strengths: ${strengths} Concerns: ${concerns} ICER projection: £${(r.icer_projection&&r.icer_projection.value||0).toLocaleString()}/QALY (${r.icer_projection&&r.icer_projection.verdict||''}).`;
}
