# PharmIQ — Multi-Agent AI Co-Pilot for Pre-Launch Pharma

> A Simon-Kucher branded, professional med-tech web app that helps life-science strategists research, benchmark, predict and price **un-launched pharmaceutical products** against historical NICE appraisals.

---

## 1. Project Goals

PharmIQ is a multi-agent AI + Dashboard product. A user uploads a product introduction document (or pastes text) and PharmIQ runs the **7-step methodology** supplied by the user:

| # | Logic | Output |
|---|---|---|
| 0 | **Analogue / Competitor Identification** | Ranked shortlist scored on product / patient / treatment / market comparability — no reimbursement bias at this step |
| NH | **NICE-history page logic** | For each shortlisted analogue, locate NICE record + history page, list every appraisal document |
| 1 | **Single-analogue NICE profile builder** | Decision drivers across 10 NICE domains for one product |
| 2 | **Cross-analogue comparison** | Bucket analogues by precedent (Recommended / Optimised / Managed-access / Not Recommended / Terminated). Reports min / median / max ICER per bucket — never averaged |
| 3 | **Base-case predictor** | Predicted reimbursement pathway + price corridor under Product A's *current* evidence |
| 4 | **Evidence recommendation** | Minimum but decision-relevant evidence package, each item mapped to a specific NICE weakness AND an analogue precedent, with verdict-shift / corridor-widen impact |
| 5 | **Delta predictor** | Re-runs Logic 3 *after* applying the Logic 4 package; reports resolved vs remaining weaknesses (delta assessment, not a de novo forecast) |

---

## 2. Page Architecture

### Part 1 — `index.html` (Upload Page) — UI unchanged
- Central **upload card** (button + paste-text + multi-file).
- Surrounding **product explanation**: hero, "How it works" (4 agent steps), agent roster, security strip.
- Brand: **Simon-Kucher** logo top-left.
- On submit → multi-agent orchestrator overlay (9 stages mirroring the 7 logics) → routes to dashboard.

### Part 2 — `dashboard.html` (Dashboard Page) — UI unchanged
Layout: **Sidebar (Simon-Kucher) | Chat-box (left) | Dashboard (right)** with three components:

| Position | Component | Content (driven by which Logic) |
|---|---|---|
| Top-Left | **Product Information & Analysis** | Indication, MoA, KPIs, NICE search criteria, Product A vs closest analogue radar (Logic 0 + Logic 3 domain scores) |
| Top-Right | **Recommendation** | Logic 3 verdict + confidence, Logic 3 price corridor (range + analogue-median anchor), Logic 3 rationale, Logic 5 delta line, **Logic 4 "Evidence to add"** prioritised list with verdict-shift / corridor-widen impact |
| Bottom (full-width) | **Analogues Analysis** | Ranked NICE analogues from Logic 0 with criteria-match pills, Competitor flag, Logic 1 evidence summary, Logic 2 ICER distribution metadata, Logic 1 NICE source link per row |

#### Chat Box (Logic-aware routing)
| User intent | Routed agent |
|---|---|
| Pricing / ICER / corridor | Pricing Agent |
| "After evidence" / "if we add" / "Logic 5" | Delta Predictor |
| Evidence / gap / ITC / NMA / RWE / PAS | Recommendation Agent |
| Analog / competitor / comparability | Analogue Agent |
| NICE / TA / FAD / ACD / ERG | NICE-History Agent |
| Predict / pathway / verdict / why | Cross-Analogue Agent |
| Anything else | Orchestrator |

---

## 3. Backend Skill Architecture (`js/agents.js`)

A single deterministic engine implements the full methodology. Public entry point: `PharmIQ.runPipeline(rawDossierText)`.

```
DossierAgent.parse              ───▶ structured dossier (indication, MoA, population,
                                       endpoints, comparators, evidence_present)
   │
   ▼
AnalogueIdAgent.select          ───▶ ranked analogues (Logic 0)
                                       comparability_score = product 0.35 + patient 0.25
                                       + treatment 0.25 + market 0.15
                                       competitor_flag = same MoA + score≥0.80 + ≤5y old
   │
   ▼
NiceHistoryAgent.pull           ───▶ per-analogue document set (NICE-history logic)
   │
   ▼
SingleAnalogueAgent.profile     ───▶ Logic 1 — decision profile across 10 NICE domains
   │
   ▼
CrossAnalogueAgent.compare      ───▶ Logic 2 — buckets + per-bucket ICER min/median/max,
                                       per-domain decision-driver clusters,
                                       most-predictive set + boundary cases
   │
   ▼
BaseCasePredictor.predict       ───▶ Logic 3 — domain-weighted composite,
                                       precedent class, confidence, corridor anchored on
                                       bucket prices, ICER projection vs WTP threshold
   │
   ▼
EvidenceRecAgent.recommend      ───▶ Logic 4 — min decision-relevant package, each item
                                       mapped: weak domain → evidence gap → analogue
                                       precedent, with verdict-shift_pp + corridor-widen_pct
   │
   ▼
DeltaPredictor.rerun            ───▶ Logic 5 — re-runs Logic 3 with upgraded evidence;
                                       reports resolved vs remaining weaknesses,
                                       precedent-class shift, new corridor
```

### NICE Decision Domains (used end-to-end)
`clinical_effectiveness · comparator_appropriateness · population_alignment · evidence_quality · cost_effectiveness · budget_impact · uncertainty · innovation_unmet_need · managed_access_fit · commercial_arrangement`

### Precedent Classes
`recommended · optimised · managed_access · not_recommended · terminated`

### Evidence-Gap Taxonomy (Logic 4)
`COMPARATOR · LONG_TERM · SUBGROUP · UTILITY · EXTRAPOLATION · BUDGET_IMPACT · PAS_COMMERCIAL · MANAGED_ACCESS · PATIENT_REPORTED · SEVERITY_QALY` — each maps 1-to-1 to a specific NICE weakness.

### NICE Document Types pulled per analogue (Logic 1 + NICE-history)
`committee_papers · company_submission · erg_critique · appraisal_consultation_document · final_appraisal_determination · final_guidance · appeal_material · commercial_access_agreement · patient_expert_statement · clinical_expert_statement`

### WTP Thresholds
- Standard: lower £20k / upper £30k / severity uplift up to £50k per QALY
- End-of-life / severity-modifier indications: lower £30k / upper £50k

### Analogue Library
Per-indication, every entry carries a fully built single-analogue NICE profile (the structured output Logic 1 would produce after ingesting the document set). Indications covered: insomnia, oncology (breast cancer subtypes), diabetes, MDD, migraine, MS.

---

## 4. Functional Entry URIs

| Path | Purpose | Parameters |
|---|---|---|
| `index.html` | Upload page (Part 1) | none |
| `dashboard.html` | Dashboard (Part 2) | reads `sessionStorage["pharmiq_payload"]` produced by upload step; falls back to a synthetic demo built by the same engine |

### REST API
| Method | Path | Description |
|---|---|---|
| GET / POST | `tables/products` | Product analyses |
| GET / POST | `tables/analogs` | Analogue records (Logic 0/1) |
| GET / POST | `tables/chat_messages` | Multi-agent chat history |

---

## 5. Data Models

### `products`
`id, product_name, indication, mechanism, efficacy_score, safety_score, innovation_score, price_low, price_high, prediction (Accept|Reject|Conditional), prediction_confidence, rationale, raw_doc, criteria[], recommendations[]`

### `analogs`
`id, product_id, name, manufacturer, indication, similarity (= comparability_score), decision (Recommended|Not Recommended|Optimised|Terminated), price, icer, approval_year, key_evidence, source_link, match_criteria[]`

### `chat_messages`
`id, product_id, role (user|assistant|system), content, agent (Orchestrator|AnalogueAgent|NICE-History|SingleAnalogue|CrossAnalogue|Pricing|Recommendation|DeltaPredictor), timestamp`

---

## 6. ✅ Currently Completed

- [x] Front-end UI for both pages (upload + dashboard) — unchanged from prior iteration
- [x] **Sufficiency Gate** — `SufficiencyAgent` checks every upload before any agent is dispatched. If the dossier lacks indication / mechanism / population / endpoints / comparators, the user is shown a modal listing exactly what's missing, why it's needed, and an example of what to add. Soft warnings (trial phase, trial names, PRO instruments, severity / QALY-shortfall) do not block analysis.
- [x] **"Run anyway with assumptions"** override on the notice modal — uses indication-specific defaults so users can still get a baseline brief.
- [x] **Atopic-dermatitis indication path** with a full NICE analogue library: Dupilumab (TA534), Tralokinumab (TA814), Lebrikizumab (TA986), Upadacitinib (TA814), Abrocitinib (TA814), Baricitinib (TA681), Cyclosporine (CG57), Nemolizumab (TA1009). TPP-aware keyword detection (OX40L, dupilumab, JAK, EASI-75, IGA 0/1, DLQI) so an amlitelimab-style TPP routes correctly.
- [x] Direct-link guard — landing on `dashboard.html` without a valid payload now redirects to `index.html` (use `dashboard.html?demo=1` for the demo seed).
- [x] Full deterministic implementation of Logics 0 → 5 in `js/agents.js`
- [x] NICE decision-domain framework (10 domains) wired into Logic 3 scoring + Logic 4 mapping + Logic 5 delta
- [x] Logic 0 analogue ranking strictly on comparability dimensions (no reimbursement bias)
- [x] Logic 2 bucketed ICER distribution (never averaged) surfaced in dashboard meta + chat
- [x] Logic 4 each evidence item linked to a specific NICE weakness AND analogue precedent + uplift estimate
- [x] Logic 5 delta-only assessment (resolved vs remaining weaknesses; pathway shift)
- [x] Multi-agent chat router with logic-specific answers per agent
- [x] **7 indications covered**: atopic dermatitis, insomnia, oncology, diabetes, MDD, migraine, MS
- [x] Persistence to `products`, `analogs`, `chat_messages`

## 7. ❌ Not Yet Implemented

- Real PDF / DOCX text extraction (the Dossier Agent currently uses pasted text + filename hints; binary content is parsed in heuristics only)
- Live HTTP scrape of NICE history pages (the doc set is pre-modelled per analogue)
- True LLM behind the chat — answers are generated from structured engine output
- Per-domain editable inputs in the dashboard so a strategist can override scores and watch the corridor recalculate live
- Export of the analysis as a Simon-Kucher branded PDF brief

## 8. 🚀 Recommended Next Steps

1. Wire `pdf.js` for in-browser dossier text extraction so binary uploads feed the Dossier Agent.
2. Replace the analogue library with a live NICE crawler index, keyed on TA/HST IDs.
3. Add an editable side-panel to override each NICE-domain score in real time, and recompute Logics 3–5 instantly.
4. Plug in a CORS-friendly LLM gateway for free-form chat answers — the Logic-aware structured payload already gives the LLM a faithful grounding context.
5. Build an export pipeline (HTML → PDF) for the dashboard brief.

---

## 9. File Structure

```
index.html              ← Part 1 — upload page
dashboard.html          ← Part 2 — dashboard
css/
  ├── style.css         ← shared tokens + upload page styling
  └── dashboard.css     ← dashboard layout
js/
  ├── agents.js         ← multi-agent engine (Logics 0–5) — single source of truth
  ├── upload.js         ← thin wiring: file intake → PharmIQ.runPipeline → persist → route
  └── dashboard.js      ← thin wiring: read payload → render structured output → chat
README.md
```

---

© 2026 Simon-Kucher · PharmIQ Multi-Agent Suite · Methodology PharmIQ-2.0 (Logic 0–5)
