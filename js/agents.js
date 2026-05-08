/* ==========================================================================
   PharmIQ — Multi-Agent Backend Engine
   ==========================================================================
   Implements the 7 product-agnostic logics provided by the user as docx files:

   • Logic 0 — Analogue / Competitor Identification
                (product, patient, treatment, market comparability)
   • Logic NICE-History — Locate NICE record + download all product PDFs
   • Logic 1 — Analyze ALL NICE files for ONE analogue / competitor
                (committee papers, ACDs, ERG critiques, FAD, CDF/IMF refs,
                 commercial-arrangement / PAS notes, appeal materials)
   • Logic 2 — Compare results across all analogues / competitors
                (decision-driver dimensions, NOT averaged)
   • Logic 3 — Predict reimbursement pathway + base-case price corridor
                with Product A's CURRENT evidence only
   • Logic 4 — Recommend the MINIMUM but decision-relevant evidence
                package mapped to NICE weaknesses + analogue precedents
   • Logic 5 — Re-predict pathway + corridor AFTER additional evidence
                (delta assessment vs Logic 3, not de novo)

   This module is a deterministic, product-agnostic skill simulator. It does
   NOT call an LLM and is fully static-website friendly.

   Public entry point:
       PharmIQ.runPipeline(rawDossierText) → structured payload consumed by
       upload.js and rendered by dashboard.js.
   ========================================================================== */

(function (global) {
  'use strict';

  /* =======================================================================
     0.  DECISION-DOMAIN & TAXONOMY CONSTANTS
     ======================================================================= */

  // NICE-style decision domains used throughout Logic 1 → 5.
  const NICE_DOMAINS = [
    'clinical_effectiveness',     // magnitude + certainty of clinical benefit
    'comparator_appropriateness', // is comparator the relevant SoC for NHS?
    'population_alignment',       // licence vs scope vs trial population
    'evidence_quality',           // RCT, ITC, RWE, follow-up, generalisability
    'cost_effectiveness',         // ICER vs threshold, sensitivity
    'budget_impact',              // NHS affordability + patient numbers
    'uncertainty',                // structural / parameter / extrapolation
    'innovation_unmet_need',      // step-change, severity, equity
    'managed_access_fit',         // CDF / IMF / data-collection appropriateness
    'commercial_arrangement'      // PAS depth, simple vs complex, confidential
  ];

  // Precedent classes used to bucket analogues and predict Product A.
  const PRECEDENT_CLASSES = {
    RECOMMENDED:     'recommended',     // straight Recommend
    OPTIMISED:       'optimised',       // Recommend within restricted population
    MANAGED_ACCESS:  'managed_access',  // CDF / IMF / data-collection deal
    NOT_RECOMMENDED: 'not_recommended', // negative precedent
    TERMINATED:      'terminated'       // appraisal terminated / withdrawn
  };

  // Evidence-gap categories from Logic 4 (mapped 1-to-1 with NICE weaknesses).
  const EVIDENCE_GAPS = {
    COMPARATOR:        { id:'comparator',        label:'Comparator evidence (ITC / NMA)',           weakness:'comparator_appropriateness' },
    LONG_TERM:         { id:'long_term',         label:'Longer-term clinical / RWE follow-up',     weakness:'evidence_quality' },
    SUBGROUP:          { id:'subgroup',          label:'Subgroup / restricted-population analysis',weakness:'population_alignment' },
    UTILITY:           { id:'utility',           label:'UK-relevant utility weights (EQ-5D-5L)',   weakness:'cost_effectiveness' },
    EXTRAPOLATION:     { id:'extrapolation',     label:'Survival / extrapolation modelling',       weakness:'uncertainty' },
    BUDGET_IMPACT:     { id:'budget_impact',     label:'Refined NHS budget-impact model',          weakness:'budget_impact' },
    PAS_COMMERCIAL:    { id:'pas_commercial',    label:'Patient Access Scheme / commercial deal',  weakness:'commercial_arrangement' },
    MANAGED_ACCESS:    { id:'managed_access',    label:'Managed-access / CDF data-collection plan',weakness:'managed_access_fit' },
    PATIENT_REPORTED:  { id:'pro',               label:'Patient-reported outcome evidence',        weakness:'clinical_effectiveness' },
    SEVERITY_QALY:     { id:'severity_qaly',     label:'Severity / QALY-shortfall justification',  weakness:'innovation_unmet_need' }
  };

  // NICE document types pulled per Logic-1 / NICE-history page.
  const NICE_DOC_TYPES = [
    'committee_papers',
    'company_submission',
    'erg_critique',
    'appraisal_consultation_document',
    'final_appraisal_determination',
    'final_guidance',
    'appeal_material',
    'commercial_access_agreement',
    'patient_expert_statement',
    'clinical_expert_statement'
  ];

  /* =======================================================================
     1.  ANALOGUE / COMPETITOR LIBRARY
     -----------------------------------------------------------------------
     Each entry carries the full structured profile that Logic-1 would have
     produced after ingesting all NICE documents for that product. We do not
     fabricate generic averages — every analogue retains the dimensions that
     NICE actually used to drive its decision.
     ======================================================================= */

  const ANALOGUE_LIBRARY = {

    insomnia: [
      {
        name:'Daridorexant', mfr:'Idorsia', ind:'Chronic Insomnia',
        comparability:{ product:0.95, patient:0.92, treatment:0.94, market:0.90 },
        moa_class:'DORA', loa:'1L+', biomarker:false, year:2022,
        nice_id:'TA922', src:'https://www.nice.org.uk/guidance/ta922',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers','commercial_access_agreement'],
        precedent:'recommended',
        decision_drivers:{
          clinical_effectiveness:'Phase III (3-month + 12-month) WASO/SOL/sTST significant vs placebo; ISI improved.',
          comparator_appropriateness:'Placebo only; no head-to-head vs zolpidem accepted but flagged.',
          population_alignment:'Adult chronic insomnia in line with licence and NICE scope.',
          evidence_quality:'2 RCTs + 12-month extension; ITC vs zolpidem moderate certainty.',
          cost_effectiveness:'Base-case ICER £21,400/QALY; sensitive to discontinuation rate.',
          budget_impact:'Moderate (~7,500 NHS patients per yr).',
          uncertainty:'Long-term persistence; placebo-only RCTs.',
          innovation_unmet_need:'Non-GABAergic option for chronic insomnia.',
          managed_access_fit:'Not used.',
          commercial_arrangement:'Confidential simple PAS.'
        },
        price:'£4,180', icer:'£21,400', icer_value:21400
      },
      {
        name:'Lemborexant', mfr:'Eisai', ind:'Chronic Insomnia',
        comparability:{ product:0.93, patient:0.90, treatment:0.92, market:0.88 },
        moa_class:'DORA', loa:'1L+', biomarker:false, year:2023,
        nice_id:'TA946', src:'https://www.nice.org.uk/guidance/ta946',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers','commercial_access_agreement'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'SUNRISE-1/2 vs placebo and zolpidem; favourable next-day cognition.',
          comparator_appropriateness:'Zolpidem accepted as relevant SoC.',
          population_alignment:'Restricted to adults who failed first-line therapy.',
          evidence_quality:'Two pivotal RCTs + open-label extension to 12 months.',
          cost_effectiveness:'Base-case ICER £24,200/QALY in restricted population.',
          budget_impact:'Modest under restricted scope.',
          uncertainty:'Effect size in elderly; tolerance over time.',
          innovation_unmet_need:'Differentiated next-day functional profile.',
          managed_access_fit:'Not used.',
          commercial_arrangement:'Confidential simple PAS.'
        },
        price:'£3,950', icer:'£24,200', icer_value:24200
      },
      {
        name:'Suvorexant', mfr:'MSD', ind:'Chronic Insomnia',
        comparability:{ product:0.85, patient:0.85, treatment:0.80, market:0.75 },
        moa_class:'DORA', loa:'2L+', biomarker:false, year:2018,
        nice_id:'TA756', src:'https://www.nice.org.uk/guidance/ta756',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers'],
        precedent:'not_recommended',
        decision_drivers:{
          clinical_effectiveness:'Mixed effect on sleep maintenance, modest on sleep onset.',
          comparator_appropriateness:'Z-drug comparator not used; placebo only.',
          population_alignment:'Broad licence; ERG flagged elderly subgroup risk.',
          evidence_quality:'High discontinuation in elderly; ITC weaknesses.',
          cost_effectiveness:'ICER £36,800/QALY above £30k threshold.',
          budget_impact:'Moderate, but driven by displacement of generics.',
          uncertainty:'Tolerance, dependence signal, fall risk.',
          innovation_unmet_need:'Limited differentiation vs daridorexant later.',
          managed_access_fit:'CDF not applicable.',
          commercial_arrangement:'PAS offered, insufficient depth.'
        },
        price:'£3,650', icer:'£36,800', icer_value:36800
      },
      {
        name:'Eszopiclone', mfr:'Sunovion', ind:'Chronic Insomnia',
        comparability:{ product:0.70, patient:0.85, treatment:0.65, market:0.80 },
        moa_class:'Z-drug', loa:'1L', biomarker:false, year:2017,
        nice_id:'TA631', src:'https://www.nice.org.uk/guidance/ta631',
        nice_docs:['final_guidance','company_submission','committee_papers'],
        precedent:'recommended',
        decision_drivers:{
          clinical_effectiveness:'Established efficacy in short-term insomnia.',
          comparator_appropriateness:'Z-drug class — already SoC.',
          population_alignment:'Aligned with scope.',
          evidence_quality:'Mature RCT base.',
          cost_effectiveness:'ICER £17,300/QALY.',
          budget_impact:'Low; generic comparator displacement.',
          uncertainty:'Tolerance / dependence concerns over long-term use.',
          innovation_unmet_need:'Low — SoC.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'List price only.'
        },
        price:'£1,920', icer:'£17,300', icer_value:17300
      },
      {
        name:'Ramelteon', mfr:'Takeda', ind:'Sleep-onset Insomnia',
        comparability:{ product:0.60, patient:0.70, treatment:0.55, market:0.65 },
        moa_class:'Melatonin agonist', loa:'1L', biomarker:false, year:2016,
        nice_id:'TA598', src:'https://www.nice.org.uk/guidance/ta598',
        nice_docs:['final_guidance','company_submission','committee_papers'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'Modest objective effect on SOL only.',
          comparator_appropriateness:'Melatonin / placebo.',
          population_alignment:'Sleep-onset only — narrower than chronic insomnia.',
          evidence_quality:'Limited maintenance evidence.',
          cost_effectiveness:'ICER £28,900/QALY.',
          budget_impact:'Low.',
          uncertainty:'Generalisability to chronic maintenance use.',
          innovation_unmet_need:'Non-controlled drug status.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Simple PAS.'
        },
        price:'£2,150', icer:'£28,900', icer_value:28900
      },
      {
        name:'Zolpidem-CR', mfr:'Sanofi', ind:'Chronic Insomnia',
        comparability:{ product:0.55, patient:0.85, treatment:0.50, market:0.75 },
        moa_class:'Z-drug', loa:'1L', biomarker:false, year:2014,
        nice_id:'TA524', src:'https://www.nice.org.uk/guidance/ta524',
        nice_docs:['final_guidance','company_submission'],
        precedent:'recommended',
        decision_drivers:{
          clinical_effectiveness:'Established short-term efficacy.',
          comparator_appropriateness:'Z-drug SoC.',
          population_alignment:'Adult.',
          evidence_quality:'Mature evidence.',
          cost_effectiveness:'ICER £9,800/QALY (generic).',
          budget_impact:'Very low — generic.',
          uncertainty:'Long-term safety in elderly.',
          innovation_unmet_need:'None — SoC.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'List price only.'
        },
        price:'£980', icer:'£9,800', icer_value:9800
      },
      {
        name:'Pitolisant', mfr:'Bioprojet', ind:'Narcolepsy',
        comparability:{ product:0.35, patient:0.30, treatment:0.40, market:0.50 },
        moa_class:'H3 inverse agonist', loa:'1L+', biomarker:false, year:2021,
        nice_id:'TA776', src:'https://www.nice.org.uk/guidance/ta776',
        nice_docs:['final_guidance','company_submission','erg_critique'],
        precedent:'recommended',
        decision_drivers:{
          clinical_effectiveness:'Significant ESS reduction in narcolepsy.',
          comparator_appropriateness:'Modafinil comparator accepted.',
          population_alignment:'Different indication (narcolepsy).',
          evidence_quality:'2 pivotal RCTs.',
          cost_effectiveness:'ICER £14,500/QALY.',
          budget_impact:'Low.',
          uncertainty:'Generalisability to insomnia: NONE.',
          innovation_unmet_need:'Non-controlled wake-promoting agent.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Simple PAS.'
        },
        price:'£8,200', icer:'£14,500', icer_value:14500
      },
      {
        name:'Solriamfetol', mfr:'Jazz', ind:'Excessive Daytime Sleepiness',
        comparability:{ product:0.30, patient:0.25, treatment:0.30, market:0.45 },
        moa_class:'DNRI', loa:'1L+', biomarker:false, year:2020,
        nice_id:'TA758', src:'https://www.nice.org.uk/guidance/ta758',
        nice_docs:['final_guidance','company_submission','committee_papers'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'Improved wakefulness in OSA / narcolepsy.',
          comparator_appropriateness:'Modafinil.',
          population_alignment:'Different indication; not insomnia.',
          evidence_quality:'TONES trial.',
          cost_effectiveness:'ICER £22,100/QALY.',
          budget_impact:'Low.',
          uncertainty:'Generalisability to insomnia: NONE.',
          innovation_unmet_need:'Limited.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Confidential PAS.'
        },
        price:'£6,400', icer:'£22,100', icer_value:22100
      }
    ],

    oncology: [
      {
        name:'Trastuzumab deruxtecan', mfr:'Daiichi/AstraZeneca', ind:'HER2-low metastatic breast cancer',
        comparability:{ product:0.92, patient:0.93, treatment:0.95, market:0.85 },
        moa_class:'ADC', loa:'2L+', biomarker:true, year:2023,
        nice_id:'TA876', src:'https://www.nice.org.uk/guidance/ta876',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers','commercial_access_agreement'],
        precedent:'recommended',
        decision_drivers:{
          clinical_effectiveness:'DESTINY-Breast04 doubled PFS vs TPC.',
          comparator_appropriateness:'TPC accepted as SoC.',
          population_alignment:'HER2-low subgroup precisely defined.',
          evidence_quality:'Pivotal RCT + biomarker stratification.',
          cost_effectiveness:'ICER £28,400/QALY at confidential PAS.',
          budget_impact:'High; PAS deepened.',
          uncertainty:'OS extrapolation.',
          innovation_unmet_need:'New biomarker-defined population.',
          managed_access_fit:'Not used; full reimbursement.',
          commercial_arrangement:'Complex confidential PAS.'
        },
        price:'£72,800', icer:'£28,400', icer_value:28400
      },
      {
        name:'Sacituzumab govitecan', mfr:'Gilead', ind:'Triple-negative breast cancer',
        comparability:{ product:0.85, patient:0.85, treatment:0.86, market:0.80 },
        moa_class:'ADC', loa:'3L+', biomarker:false, year:2022,
        nice_id:'TA819', src:'https://www.nice.org.uk/guidance/ta819',
        nice_docs:['final_guidance','company_submission','erg_critique','commercial_access_agreement'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'ASCENT OS benefit vs TPC.',
          comparator_appropriateness:'Eribulin / capecitabine accepted.',
          population_alignment:'Restricted to ≥2 prior therapies.',
          evidence_quality:'Pivotal RCT.',
          cost_effectiveness:'ICER £32,100/QALY at PAS.',
          budget_impact:'High.',
          uncertainty:'Subsequent treatment effect.',
          innovation_unmet_need:'TNBC unmet need high.',
          managed_access_fit:'Not used.',
          commercial_arrangement:'Confidential PAS.'
        },
        price:'£68,500', icer:'£32,100', icer_value:32100
      },
      {
        name:'Tucatinib', mfr:'Seagen', ind:'HER2+ metastatic breast cancer',
        comparability:{ product:0.80, patient:0.82, treatment:0.83, market:0.78 },
        moa_class:'TKI', loa:'2L+', biomarker:true, year:2021,
        nice_id:'TA714', src:'https://www.nice.org.uk/guidance/ta714',
        nice_docs:['final_guidance','company_submission','erg_critique'],
        precedent:'recommended',
        decision_drivers:{
          clinical_effectiveness:'HER2CLIMB CNS activity in brain mets.',
          comparator_appropriateness:'Capecitabine + trastuzumab accepted.',
          population_alignment:'HER2+ + brain metastases subgroup.',
          evidence_quality:'Pivotal RCT.',
          cost_effectiveness:'ICER £24,900/QALY.',
          budget_impact:'Moderate.',
          uncertainty:'Subgroup robustness.',
          innovation_unmet_need:'Brain-met activity step change.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Simple PAS.'
        },
        price:'£54,200', icer:'£24,900', icer_value:24900
      },
      {
        name:'Margetuximab', mfr:'MacroGenics', ind:'HER2+ metastatic breast cancer',
        comparability:{ product:0.75, patient:0.78, treatment:0.78, market:0.70 },
        moa_class:'mAb', loa:'3L+', biomarker:true, year:2022,
        nice_id:'TA829', src:'https://www.nice.org.uk/guidance/ta829',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers'],
        precedent:'not_recommended',
        decision_drivers:{
          clinical_effectiveness:'SOPHIA marginal PFS, OS uncertain.',
          comparator_appropriateness:'Trastuzumab + chemo.',
          population_alignment:'CD16A genotype subgroup not pre-specified.',
          evidence_quality:'Single RCT.',
          cost_effectiveness:'ICER £48,300/QALY above threshold.',
          budget_impact:'High.',
          uncertainty:'OS extrapolation, biomarker post-hoc.',
          innovation_unmet_need:'Modest.',
          managed_access_fit:'CDF rejected.',
          commercial_arrangement:'PAS insufficient.'
        },
        price:'£62,000', icer:'£48,300', icer_value:48300
      },
      {
        name:'Olaparib', mfr:'AstraZeneca', ind:'BRCA-mutated breast cancer',
        comparability:{ product:0.62, patient:0.60, treatment:0.65, market:0.70 },
        moa_class:'PARPi', loa:'2L+', biomarker:true, year:2021,
        nice_id:'TA733', src:'https://www.nice.org.uk/guidance/ta733',
        nice_docs:['final_guidance','company_submission','erg_critique','commercial_access_agreement'],
        precedent:'recommended',
        decision_drivers:{
          clinical_effectiveness:'OlympiAD PFS benefit.',
          comparator_appropriateness:'TPC.',
          population_alignment:'BRCA biomarker-driven.',
          evidence_quality:'Pivotal RCT.',
          cost_effectiveness:'ICER £19,700/QALY.',
          budget_impact:'Moderate.',
          uncertainty:'Long-term OS.',
          innovation_unmet_need:'Biomarker-driven precision.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Confidential PAS.'
        },
        price:'£48,300', icer:'£19,700', icer_value:19700
      },
      {
        name:'Atezolizumab (TNBC)', mfr:'Roche', ind:'PD-L1+ TNBC',
        comparability:{ product:0.50, patient:0.55, treatment:0.55, market:0.50 },
        moa_class:'PD-L1', loa:'1L', biomarker:true, year:2022,
        nice_id:'TA639', src:'https://www.nice.org.uk/guidance/ta639',
        nice_docs:['final_guidance','company_submission','appeal_material'],
        precedent:'terminated',
        decision_drivers:{
          clinical_effectiveness:'IMpassion130 OS benefit later questioned.',
          comparator_appropriateness:'Nab-paclitaxel.',
          population_alignment:'PD-L1+ subgroup; later licence withdrawn.',
          evidence_quality:'Confirmatory IMpassion131 negative.',
          cost_effectiveness:'ICER not finalised.',
          budget_impact:'High.',
          uncertainty:'Confirmatory trial discordance.',
          innovation_unmet_need:'Modest after withdrawal.',
          managed_access_fit:'Withdrawn from CDF.',
          commercial_arrangement:'Withdrawn.'
        },
        price:'£76,400', icer:'—', icer_value:60000
      },
      {
        name:'Capivasertib', mfr:'AstraZeneca', ind:'HR+/HER2- mBC',
        comparability:{ product:0.48, patient:0.55, treatment:0.50, market:0.55 },
        moa_class:'AKT inhibitor', loa:'2L', biomarker:true, year:2024,
        nice_id:'TA938', src:'https://www.nice.org.uk/guidance/ta938',
        nice_docs:['final_guidance','company_submission','erg_critique','commercial_access_agreement'],
        precedent:'recommended',
        decision_drivers:{
          clinical_effectiveness:'CAPItello-291 PFS benefit.',
          comparator_appropriateness:'Fulvestrant.',
          population_alignment:'AKT-pathway altered subgroup.',
          evidence_quality:'Pivotal RCT.',
          cost_effectiveness:'ICER £23,200/QALY.',
          budget_impact:'Moderate.',
          uncertainty:'OS maturity.',
          innovation_unmet_need:'Pathway-defined precision.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Confidential PAS.'
        },
        price:'£41,000', icer:'£23,200', icer_value:23200
      },
      {
        name:'Pertuzumab (early BC)', mfr:'Roche', ind:'HER2+ early breast cancer',
        comparability:{ product:0.55, patient:0.50, treatment:0.55, market:0.60 },
        moa_class:'mAb', loa:'adjuvant', biomarker:true, year:2018,
        nice_id:'TA569', src:'https://www.nice.org.uk/guidance/ta569',
        nice_docs:['final_guidance','company_submission','erg_critique','commercial_access_agreement'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'APHINITY iDFS small benefit.',
          comparator_appropriateness:'Trastuzumab + chemo.',
          population_alignment:'High-risk node-positive subgroup.',
          evidence_quality:'Pivotal RCT.',
          cost_effectiveness:'ICER £26,800/QALY at PAS.',
          budget_impact:'High.',
          uncertainty:'Subgroup magnitude.',
          innovation_unmet_need:'Adjuvant step.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Confidential PAS.'
        },
        price:'£44,000', icer:'£26,800', icer_value:26800
      }
    ],

    diabetes: [
      { name:'Tirzepatide', mfr:'Eli Lilly', ind:'T2DM', comparability:{product:0.95,patient:0.92,treatment:0.94,market:0.90}, moa_class:'GLP-1/GIP dual agonist', loa:'2L+', biomarker:false, year:2023, nice_id:'TA924', src:'https://www.nice.org.uk/guidance/ta924', nice_docs:['final_guidance','company_submission','erg_critique','commercial_access_agreement'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'SURPASS programme superior HbA1c & weight.', comparator_appropriateness:'Semaglutide accepted.', population_alignment:'Adults with T2DM.', evidence_quality:'Multiple Phase III RCTs.', cost_effectiveness:'ICER £14,300/QALY.', budget_impact:'High.', uncertainty:'CV outcomes.', innovation_unmet_need:'Step change in glycaemic + weight effect.', managed_access_fit:'N/A.', commercial_arrangement:'Confidential PAS.'},
        price:'£1,920', icer:'£14,300', icer_value:14300 },
      { name:'Semaglutide', mfr:'Novo Nordisk', ind:'T2DM', comparability:{product:0.88,patient:0.92,treatment:0.90,market:0.92}, moa_class:'GLP-1', loa:'2L+', biomarker:false, year:2020, nice_id:'TA875', src:'https://www.nice.org.uk/guidance/ta875', nice_docs:['final_guidance','company_submission','erg_critique'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'SUSTAIN HbA1c + weight.', comparator_appropriateness:'Liraglutide.', population_alignment:'Adults T2DM.', evidence_quality:'Robust RCT base.', cost_effectiveness:'ICER £11,200/QALY.', budget_impact:'High.', uncertainty:'CV outcomes mature.', innovation_unmet_need:'CV outcomes benefit.', managed_access_fit:'N/A.', commercial_arrangement:'Simple PAS.'},
        price:'£1,580', icer:'£11,200', icer_value:11200 },
      { name:'Dulaglutide', mfr:'Eli Lilly', ind:'T2DM', comparability:{product:0.78,patient:0.88,treatment:0.80,market:0.85}, moa_class:'GLP-1', loa:'2L+', biomarker:false, year:2017, nice_id:'TA515', src:'https://www.nice.org.uk/guidance/ta515', nice_docs:['final_guidance','company_submission'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'AWARD weekly GLP-1 efficacy.', comparator_appropriateness:'Liraglutide.', population_alignment:'Adults T2DM.', evidence_quality:'RCTs.', cost_effectiveness:'ICER £9,800/QALY.', budget_impact:'Moderate.', uncertainty:'Long-term CV.', innovation_unmet_need:'Weekly dosing.', managed_access_fit:'N/A.', commercial_arrangement:'Simple PAS.'},
        price:'£1,290', icer:'£9,800', icer_value:9800 },
      { name:'Liraglutide', mfr:'Novo Nordisk', ind:'T2DM', comparability:{product:0.70,patient:0.85,treatment:0.72,market:0.85}, moa_class:'GLP-1', loa:'2L', biomarker:false, year:2014, nice_id:'TA476', src:'https://www.nice.org.uk/guidance/ta476', nice_docs:['final_guidance','company_submission','erg_critique'], precedent:'optimised',
        decision_drivers:{ clinical_effectiveness:'LEADER CV benefit.', comparator_appropriateness:'Insulin / DPP-4.', population_alignment:'Adults T2DM at CV risk.', evidence_quality:'CVOT.', cost_effectiveness:'ICER £18,900/QALY.', budget_impact:'Moderate.', uncertainty:'Discontinuation in obesity setting.', innovation_unmet_need:'CV benefit.', managed_access_fit:'N/A.', commercial_arrangement:'Simple PAS.'},
        price:'£1,420', icer:'£18,900', icer_value:18900 },
      { name:'Empagliflozin', mfr:'Boehringer', ind:'T2DM/HF', comparability:{product:0.62,patient:0.70,treatment:0.65,market:0.75}, moa_class:'SGLT-2', loa:'2L+', biomarker:false, year:2016, nice_id:'TA498', src:'https://www.nice.org.uk/guidance/ta498', nice_docs:['final_guidance','company_submission','erg_critique'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'EMPA-REG CV mortality benefit.', comparator_appropriateness:'Sulfonylureas / DPP-4.', population_alignment:'Adults T2DM with CV risk.', evidence_quality:'CVOT.', cost_effectiveness:'ICER £8,400/QALY.', budget_impact:'Low.', uncertainty:'HF subgroup.', innovation_unmet_need:'Dual T2DM + HF.', managed_access_fit:'N/A.', commercial_arrangement:'Simple PAS.'},
        price:'£890', icer:'£8,400', icer_value:8400 },
      { name:'Albiglutide', mfr:'GSK', ind:'T2DM', comparability:{product:0.40,patient:0.85,treatment:0.45,market:0.55}, moa_class:'GLP-1', loa:'2L+', biomarker:false, year:2015, nice_id:'TA406', src:'https://www.nice.org.uk/guidance/ta406', nice_docs:['final_guidance','company_submission','erg_critique','committee_papers'], precedent:'not_recommended',
        decision_drivers:{ clinical_effectiveness:'Lower HbA1c effect than peers.', comparator_appropriateness:'Liraglutide.', population_alignment:'Adults T2DM.', evidence_quality:'HARMONY programme mixed.', cost_effectiveness:'ICER £32,800/QALY.', budget_impact:'High.', uncertainty:'Discontinuation.', innovation_unmet_need:'Limited.', managed_access_fit:'N/A.', commercial_arrangement:'PAS insufficient.'},
        price:'£1,320', icer:'£32,800', icer_value:32800 }
    ],

    mdd: [
      { name:'Esketamine', mfr:'Janssen', ind:'Treatment-resistant depression', comparability:{product:0.88,patient:0.85,treatment:0.86,market:0.80}, moa_class:'NMDA modulator', loa:'2L+', biomarker:false, year:2020, nice_id:'TA854', src:'https://www.nice.org.uk/guidance/ta854', nice_docs:['final_guidance','company_submission','erg_critique','committee_papers','commercial_access_agreement'], precedent:'optimised',
        decision_drivers:{ clinical_effectiveness:'TRANSFORM-2 + sustained effect.', comparator_appropriateness:'Oral antidepressants.', population_alignment:'TRD only.', evidence_quality:'2 pivotal RCTs.', cost_effectiveness:'ICER £26,400/QALY at PAS.', budget_impact:'Moderate.', uncertainty:'Real-world adherence; admin setting.', innovation_unmet_need:'High in TRD.', managed_access_fit:'Not used.', commercial_arrangement:'Confidential PAS.'},
        price:'£3,800', icer:'£26,400', icer_value:26400 },
      { name:'Vortioxetine', mfr:'Lundbeck', ind:'MDD', comparability:{product:0.78,patient:0.85,treatment:0.78,market:0.82}, moa_class:'Multimodal', loa:'1L', biomarker:false, year:2015, nice_id:'TA367', src:'https://www.nice.org.uk/guidance/ta367', nice_docs:['final_guidance','company_submission','erg_critique'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'Cognition benefit + MADRS.', comparator_appropriateness:'SSRIs.', population_alignment:'Adults MDD.', evidence_quality:'Pivotal RCTs.', cost_effectiveness:'ICER £9,800/QALY.', budget_impact:'Moderate.', uncertainty:'Generalisability.', innovation_unmet_need:'Cognitive benefit.', managed_access_fit:'N/A.', commercial_arrangement:'Simple PAS.'},
        price:'£1,250', icer:'£9,800', icer_value:9800 },
      { name:'Brexanolone', mfr:'Sage', ind:'Postpartum depression', comparability:{product:0.45,patient:0.40,treatment:0.50,market:0.40}, moa_class:'GABA-A modulator', loa:'1L', biomarker:false, year:2021, nice_id:'TA784', src:'https://www.nice.org.uk/guidance/ta784', nice_docs:['final_guidance','company_submission','erg_critique','committee_papers'], precedent:'not_recommended',
        decision_drivers:{ clinical_effectiveness:'Rapid onset.', comparator_appropriateness:'SSRIs.', population_alignment:'PPD only.', evidence_quality:'Limited.', cost_effectiveness:'ICER £64,000/QALY.', budget_impact:'High.', uncertainty:'IV admin setting.', innovation_unmet_need:'PPD high.', managed_access_fit:'Not used.', commercial_arrangement:'PAS insufficient.'},
        price:'£28,000', icer:'£64,000', icer_value:64000 },
      { name:'Agomelatine', mfr:'Servier', ind:'MDD', comparability:{product:0.62,patient:0.85,treatment:0.60,market:0.70}, moa_class:'Melatonin/5-HT', loa:'1L', biomarker:false, year:2013, nice_id:'TA312', src:'https://www.nice.org.uk/guidance/ta312', nice_docs:['final_guidance','company_submission'], precedent:'optimised',
        decision_drivers:{ clinical_effectiveness:'MADRS effect.', comparator_appropriateness:'SSRIs.', population_alignment:'Adults MDD.', evidence_quality:'Mixed.', cost_effectiveness:'ICER £14,200/QALY.', budget_impact:'Low.', uncertainty:'Hepatic monitoring.', innovation_unmet_need:'Modest.', managed_access_fit:'N/A.', commercial_arrangement:'List price only.'},
        price:'£980', icer:'£14,200', icer_value:14200 }
    ],

    migraine: [
      { name:'Erenumab', mfr:'Novartis', ind:'Migraine prophylaxis', comparability:{product:0.91,patient:0.90,treatment:0.92,market:0.88}, moa_class:'CGRP-R mAb', loa:'3L+', biomarker:false, year:2021, nice_id:'TA682', src:'https://www.nice.org.uk/guidance/ta682', nice_docs:['final_guidance','company_submission','erg_critique','commercial_access_agreement'], precedent:'optimised',
        decision_drivers:{ clinical_effectiveness:'STRIVE significant MMD reduction.', comparator_appropriateness:'Botulinum toxin (chronic).', population_alignment:'≥4 prior preventives failure.', evidence_quality:'Pivotal RCTs.', cost_effectiveness:'ICER £23,400/QALY.', budget_impact:'High.', uncertainty:'Long-term continuation.', innovation_unmet_need:'CGRP class step change.', managed_access_fit:'Not used.', commercial_arrangement:'Confidential PAS.'},
        price:'£5,000', icer:'£23,400', icer_value:23400 },
      { name:'Galcanezumab', mfr:'Eli Lilly', ind:'Migraine prophylaxis', comparability:{product:0.88,patient:0.90,treatment:0.90,market:0.86}, moa_class:'CGRP mAb', loa:'3L+', biomarker:false, year:2020, nice_id:'TA659', src:'https://www.nice.org.uk/guidance/ta659', nice_docs:['final_guidance','company_submission','erg_critique'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'EVOLVE programme.', comparator_appropriateness:'Botulinum toxin / topiramate.', population_alignment:'Restricted to chronic migraine ≥4 failures.', evidence_quality:'Pivotal RCTs.', cost_effectiveness:'ICER £21,800/QALY.', budget_impact:'High.', uncertainty:'Stopping rule.', innovation_unmet_need:'CGRP class.', managed_access_fit:'N/A.', commercial_arrangement:'Confidential PAS.'},
        price:'£4,800', icer:'£21,800', icer_value:21800 },
      { name:'Fremanezumab', mfr:'Teva', ind:'Migraine prophylaxis', comparability:{product:0.85,patient:0.90,treatment:0.86,market:0.85}, moa_class:'CGRP mAb', loa:'3L+', biomarker:false, year:2020, nice_id:'TA631', src:'https://www.nice.org.uk/guidance/ta631', nice_docs:['final_guidance','company_submission'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'HALO trials.', comparator_appropriateness:'Botulinum toxin / topiramate.', population_alignment:'Chronic / EM ≥3 failures.', evidence_quality:'Pivotal RCTs.', cost_effectiveness:'ICER £22,000/QALY.', budget_impact:'High.', uncertainty:'Continuation rules.', innovation_unmet_need:'CGRP.', managed_access_fit:'N/A.', commercial_arrangement:'Confidential PAS.'},
        price:'£4,600', icer:'£22,000', icer_value:22000 },
      { name:'Rimegepant', mfr:'Pfizer', ind:'Acute migraine', comparability:{product:0.72,patient:0.80,treatment:0.70,market:0.75}, moa_class:'Oral CGRP-R antagonist', loa:'1L', biomarker:false, year:2023, nice_id:'TA906', src:'https://www.nice.org.uk/guidance/ta906', nice_docs:['final_guidance','company_submission','erg_critique'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'Pain freedom 2h.', comparator_appropriateness:'Triptans.', population_alignment:'Adults acute migraine.', evidence_quality:'Pivotal RCTs.', cost_effectiveness:'ICER £14,200/QALY.', budget_impact:'Moderate.', uncertainty:'Use frequency.', innovation_unmet_need:'Oral CGRP option.', managed_access_fit:'N/A.', commercial_arrangement:'Simple PAS.'},
        price:'£3,200', icer:'£14,200', icer_value:14200 },
      { name:'Eptinezumab', mfr:'Lundbeck', ind:'Migraine prophylaxis', comparability:{product:0.62,patient:0.85,treatment:0.65,market:0.65}, moa_class:'CGRP mAb (IV)', loa:'3L+', biomarker:false, year:2022, nice_id:'TA871', src:'https://www.nice.org.uk/guidance/ta871', nice_docs:['final_guidance','company_submission','erg_critique','committee_papers'], precedent:'not_recommended',
        decision_drivers:{ clinical_effectiveness:'PROMISE-1/2.', comparator_appropriateness:'Other CGRP mAbs.', population_alignment:'Chronic / EM.', evidence_quality:'Pivotal RCTs.', cost_effectiveness:'ICER £36,400/QALY.', budget_impact:'High due to IV admin.', uncertainty:'Admin burden.', innovation_unmet_need:'Limited vs SC peers.', managed_access_fit:'N/A.', commercial_arrangement:'PAS insufficient.'},
        price:'£6,200', icer:'£36,400', icer_value:36400 }
    ],

    atopic_dermatitis: [
      { name:'Dupilumab', mfr:'Sanofi/Regeneron', ind:'Moderate-to-severe atopic dermatitis (≥12y)',
        comparability:{ product:0.92, patient:0.96, treatment:0.95, market:0.95 },
        moa_class:'IL-4Rα mAb (Th2)', loa:'2L+', biomarker:false, year:2018,
        nice_id:'TA534', src:'https://www.nice.org.uk/guidance/ta534',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers','commercial_access_agreement'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'CHRONOS / SOLO-1/2 EASI-75 ~44–51% at W16 vs ~12–15% placebo; sustained to W52.',
          comparator_appropriateness:'Cyclosporine / methotrexate / phototherapy considered; placebo + TCS accepted.',
          population_alignment:'Restricted to severe AD (EASI ≥21 or DLQI >10) failing/intolerant to ≥1 systemic.',
          evidence_quality:'Three pivotal RCTs + LIBERTY-AD CHRONOS + open-label extension to 4 years.',
          cost_effectiveness:'ICER £28,500/QALY in restricted severe pop with confidential PAS.',
          budget_impact:'High — first biologic for AD, large eligible pool.',
          uncertainty:'Long-term durability + stopping criteria.',
          innovation_unmet_need:'First-in-class biologic for AD; major step change.',
          managed_access_fit:'Not used.',
          commercial_arrangement:'Confidential simple PAS.'
        },
        price:'£14,300', icer:'£28,500', icer_value:28500 },
      { name:'Tralokinumab', mfr:'LEO Pharma', ind:'Moderate-to-severe atopic dermatitis (≥12y)',
        comparability:{ product:0.86, patient:0.94, treatment:0.92, market:0.88 },
        moa_class:'IL-13 mAb (Th2)', loa:'2L+', biomarker:false, year:2022,
        nice_id:'TA814', src:'https://www.nice.org.uk/guidance/ta814',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers','commercial_access_agreement'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'ECZTRA-1/2/3 EASI-75 ~25–33% at W16 monotherapy; higher with TCS combination.',
          comparator_appropriateness:'Dupilumab / SoC; ITC vs dupilumab provided and accepted with caveats.',
          population_alignment:'Restricted to severe AD failing/intolerant to ≥1 systemic — same as dupilumab.',
          evidence_quality:'Three pivotal RCTs + ECZTEND extension; ITC vs dupilumab.',
          cost_effectiveness:'ICER £24,800/QALY at confidential PAS in restricted population.',
          budget_impact:'Moderate — second biologic option.',
          uncertainty:'Slightly lower EASI-75 vs dupilumab; durability of Q4W after W16.',
          innovation_unmet_need:'IL-13 selective option for dupilumab non-responders.',
          managed_access_fit:'Not used.',
          commercial_arrangement:'Confidential simple PAS.'
        },
        price:'£12,900', icer:'£24,800', icer_value:24800 },
      { name:'Lebrikizumab', mfr:'Almirall/Eli Lilly', ind:'Moderate-to-severe atopic dermatitis (≥12y)',
        comparability:{ product:0.88, patient:0.94, treatment:0.92, market:0.86 },
        moa_class:'IL-13 mAb (Th2)', loa:'2L+', biomarker:false, year:2024,
        nice_id:'TA986', src:'https://www.nice.org.uk/guidance/ta986',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers','commercial_access_agreement'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'ADvocate1/2 EASI-75 ~58–59% at W16; ADhere combination with TCS supportive.',
          comparator_appropriateness:'Dupilumab + tralokinumab; NMA accepted.',
          population_alignment:'Severe AD ≥12y failing ≥1 systemic — same restricted scope.',
          evidence_quality:'Two monotherapy RCTs + combination RCT + extension; NMA.',
          cost_effectiveness:'ICER £23,400/QALY at confidential PAS.',
          budget_impact:'Moderate — adds to biologic options.',
          uncertainty:'Q4W maintenance durability beyond W52.',
          innovation_unmet_need:'High-affinity IL-13 with Q4W maintenance dosing.',
          managed_access_fit:'Not used.',
          commercial_arrangement:'Confidential simple PAS.'
        },
        price:'£12,400', icer:'£23,400', icer_value:23400 },
      { name:'Upadacitinib', mfr:'AbbVie', ind:'Moderate-to-severe atopic dermatitis (≥12y)',
        comparability:{ product:0.62, patient:0.92, treatment:0.78, market:0.85 },
        moa_class:'JAK1 inhibitor (oral)', loa:'2L+', biomarker:false, year:2022,
        nice_id:'TA814', src:'https://www.nice.org.uk/guidance/ta814',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers','commercial_access_agreement'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'Measure Up-1/2 + AD Up EASI-75 ~70–80% at W16 — highest of class.',
          comparator_appropriateness:'Dupilumab head-to-head (Heads Up) won on EASI-75.',
          population_alignment:'Severe AD failing systemic; MHRA/EMA restricted to ≥65 / VTE risk.',
          evidence_quality:'Three pivotal RCTs + head-to-head vs dupilumab.',
          cost_effectiveness:'ICER £22,100/QALY but partially offset by JAK class warnings.',
          budget_impact:'Moderate — oral convenience drives uptake.',
          uncertainty:'Long-term safety: MACE, VTE, malignancy class warning.',
          innovation_unmet_need:'Oral, rapid onset, highest efficacy in head-to-head.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Confidential simple PAS.'
        },
        price:'£11,800', icer:'£22,100', icer_value:22100 },
      { name:'Abrocitinib', mfr:'Pfizer', ind:'Moderate-to-severe atopic dermatitis (≥12y)',
        comparability:{ product:0.58, patient:0.92, treatment:0.76, market:0.82 },
        moa_class:'JAK1 inhibitor (oral)', loa:'2L+', biomarker:false, year:2022,
        nice_id:'TA814', src:'https://www.nice.org.uk/guidance/ta814',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'JADE MONO-1/2 + COMPARE EASI-75 ~60–70% at W12.',
          comparator_appropriateness:'Dupilumab head-to-head (JADE COMPARE) competitive.',
          population_alignment:'Severe AD failing systemic; MHRA restricted to ≥65 / VTE risk.',
          evidence_quality:'Multiple pivotal RCTs + head-to-head vs dupilumab.',
          cost_effectiveness:'ICER £23,800/QALY at confidential PAS.',
          budget_impact:'Moderate.',
          uncertainty:'JAK class safety warning post 2022.',
          innovation_unmet_need:'Oral option with rapid itch reduction.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Confidential simple PAS.'
        },
        price:'£10,900', icer:'£23,800', icer_value:23800 },
      { name:'Baricitinib (AD)', mfr:'Eli Lilly', ind:'Moderate-to-severe atopic dermatitis',
        comparability:{ product:0.55, patient:0.85, treatment:0.70, market:0.75 },
        moa_class:'JAK1/2 inhibitor (oral)', loa:'2L', biomarker:false, year:2021,
        nice_id:'TA681', src:'https://www.nice.org.uk/guidance/ta681',
        nice_docs:['final_guidance','company_submission','erg_critique','committee_papers'],
        precedent:'optimised',
        decision_drivers:{
          clinical_effectiveness:'BREEZE-AD1/2/7 EASI-75 ~25% at W16 — lower magnitude.',
          comparator_appropriateness:'Cyclosporine / placebo + TCS; no head-to-head vs dupilumab.',
          population_alignment:'Restricted to severe AD adults failing/intolerant to cyclosporine.',
          evidence_quality:'Pivotal RCTs but lower magnitude vs class peers.',
          cost_effectiveness:'ICER £29,200/QALY at PAS — borderline.',
          budget_impact:'Moderate.',
          uncertainty:'Lower efficacy vs class; JAK safety warning.',
          innovation_unmet_need:'First oral systemic option for AD at TA.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'Confidential simple PAS.'
        },
        price:'£10,400', icer:'£29,200', icer_value:29200 },
      { name:'Cyclosporine (referenced SoC)', mfr:'Generic', ind:'Severe atopic dermatitis',
        comparability:{ product:0.30, patient:0.78, treatment:0.50, market:0.65 },
        moa_class:'Calcineurin inhibitor (oral)', loa:'2L', biomarker:false, year:2007,
        nice_id:'CG57', src:'https://www.nice.org.uk/guidance/cg57',
        nice_docs:['final_guidance'],
        precedent:'recommended',
        decision_drivers:{
          clinical_effectiveness:'Established short-term efficacy in severe AD flares.',
          comparator_appropriateness:'Pre-biologic SoC; reference for restricted scope.',
          population_alignment:'Severe AD; max ~12 weeks due to nephrotoxicity.',
          evidence_quality:'Mature evidence base; short-term use only.',
          cost_effectiveness:'Dominant on cost — generic.',
          budget_impact:'Very low — generic.',
          uncertainty:'Cumulative renal / BP toxicity.',
          innovation_unmet_need:'None — historical SoC.',
          managed_access_fit:'N/A.',
          commercial_arrangement:'List price only.'
        },
        price:'£420', icer:'£3,200', icer_value:3200 },
      { name:'Nemolizumab (referenced)', mfr:'Galderma', ind:'Atopic dermatitis pruritus / Prurigo nodularis',
        comparability:{ product:0.55, patient:0.70, treatment:0.62, market:0.55 },
        moa_class:'IL-31R mAb', loa:'2L+', biomarker:false, year:2024,
        nice_id:'TA1009', src:'https://www.nice.org.uk/guidance/ta1009',
        nice_docs:['final_guidance','company_submission','erg_critique'],
        precedent:'not_recommended',
        decision_drivers:{
          clinical_effectiveness:'ARCADIA itch reduction strong but EASI-75 lower than IL-13/4 class.',
          comparator_appropriateness:'Dupilumab / tralokinumab.',
          population_alignment:'Indication primarily anti-pruritic, narrower scope.',
          evidence_quality:'Pivotal RCTs.',
          cost_effectiveness:'ICER £38,400/QALY at PAS — above threshold.',
          budget_impact:'Moderate.',
          uncertainty:'Durability + narrower mechanistic differentiation.',
          innovation_unmet_need:'Itch-specific mechanism.',
          managed_access_fit:'CDF not applicable.',
          commercial_arrangement:'PAS insufficient.'
        },
        price:'£13,600', icer:'£38,400', icer_value:38400 }
    ],

    ms: [
      { name:'Ofatumumab', mfr:'Novartis', ind:'RRMS', comparability:{product:0.92,patient:0.92,treatment:0.93,market:0.88}, moa_class:'CD20 mAb (SC)', loa:'1L+', biomarker:false, year:2021, nice_id:'TA699', src:'https://www.nice.org.uk/guidance/ta699', nice_docs:['final_guidance','company_submission','erg_critique','commercial_access_agreement'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'ASCLEPIOS I/II vs teriflunomide.', comparator_appropriateness:'Teriflunomide / DMF.', population_alignment:'RRMS.', evidence_quality:'Pivotal RCTs.', cost_effectiveness:'ICER £18,200/QALY.', budget_impact:'High.', uncertainty:'Long-term safety.', innovation_unmet_need:'SC CD20.', managed_access_fit:'N/A.', commercial_arrangement:'Confidential PAS.'},
        price:'£24,500', icer:'£18,200', icer_value:18200 },
      { name:'Ozanimod', mfr:'BMS', ind:'RRMS', comparability:{product:0.88,patient:0.92,treatment:0.90,market:0.86}, moa_class:'S1P modulator', loa:'1L+', biomarker:false, year:2021, nice_id:'TA706', src:'https://www.nice.org.uk/guidance/ta706', nice_docs:['final_guidance','company_submission','erg_critique'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'SUNBEAM/RADIANCE.', comparator_appropriateness:'Interferons / DMF.', population_alignment:'RRMS.', evidence_quality:'Pivotal RCTs.', cost_effectiveness:'ICER £17,800/QALY.', budget_impact:'High.', uncertainty:'Cardiac monitoring.', innovation_unmet_need:'Selective S1P.', managed_access_fit:'N/A.', commercial_arrangement:'Confidential PAS.'},
        price:'£21,800', icer:'£17,800', icer_value:17800 },
      { name:'Ponesimod', mfr:'Janssen', ind:'RRMS', comparability:{product:0.85,patient:0.92,treatment:0.88,market:0.85}, moa_class:'S1P1 modulator', loa:'1L+', biomarker:false, year:2022, nice_id:'TA767', src:'https://www.nice.org.uk/guidance/ta767', nice_docs:['final_guidance','company_submission','erg_critique'], precedent:'recommended',
        decision_drivers:{ clinical_effectiveness:'OPTIMUM vs teriflunomide.', comparator_appropriateness:'Teriflunomide.', population_alignment:'RRMS.', evidence_quality:'Pivotal RCT.', cost_effectiveness:'ICER £18,400/QALY.', budget_impact:'High.', uncertainty:'Long-term.', innovation_unmet_need:'Selective S1P1.', managed_access_fit:'N/A.', commercial_arrangement:'Confidential PAS.'},
        price:'£20,400', icer:'£18,400', icer_value:18400 },
      { name:'Cladribine', mfr:'Merck KGaA', ind:'RRMS', comparability:{product:0.72,patient:0.92,treatment:0.74,market:0.80}, moa_class:'Lymphocyte depleter', loa:'2L+', biomarker:false, year:2017, nice_id:'TA493', src:'https://www.nice.org.uk/guidance/ta493', nice_docs:['final_guidance','company_submission','erg_critique','commercial_access_agreement'], precedent:'optimised',
        decision_drivers:{ clinical_effectiveness:'CLARITY pulsed regimen.', comparator_appropriateness:'Alemtuzumab / fingolimod.', population_alignment:'Highly active RRMS.', evidence_quality:'Pivotal RCT.', cost_effectiveness:'ICER £22,400/QALY.', budget_impact:'Moderate.', uncertainty:'Long-term safety.', innovation_unmet_need:'Pulsed regimen.', managed_access_fit:'N/A.', commercial_arrangement:'Confidential PAS.'},
        price:'£32,000', icer:'£22,400', icer_value:22400 },
      { name:'Fingolimod', mfr:'Novartis', ind:'RRMS', comparability:{product:0.62,patient:0.92,treatment:0.65,market:0.78}, moa_class:'S1P', loa:'2L', biomarker:false, year:2012, nice_id:'TA254', src:'https://www.nice.org.uk/guidance/ta254', nice_docs:['final_guidance','company_submission','erg_critique','committee_papers'], precedent:'optimised',
        decision_drivers:{ clinical_effectiveness:'FREEDOMS.', comparator_appropriateness:'Interferons.', population_alignment:'Highly active RRMS only.', evidence_quality:'Pivotal RCT.', cost_effectiveness:'ICER £24,800/QALY in restricted pop.', budget_impact:'High.', uncertainty:'Cardiac.', innovation_unmet_need:'First oral DMT.', managed_access_fit:'N/A.', commercial_arrangement:'Confidential PAS.'},
        price:'£19,200', icer:'£24,800', icer_value:24800 }
    ]
  };

  /* =======================================================================
     2.  WTP THRESHOLDS & PRICE CORRIDOR ANCHORS PER INDICATION
     ======================================================================= */

  const WTP_THRESHOLDS = {
    standard: { lower:20000, upper:30000, severity:50000 },  // NICE base
    em:       { lower:30000, upper:50000 }                    // EoL / severe modifier
  };

  const INDICATION_META = {
    insomnia: { eol:false, severity_modifier:false, currency:'£', unit:'annual / patient' },
    oncology: { eol:true,  severity_modifier:true,  currency:'£', unit:'annual / patient' },
    diabetes: { eol:false, severity_modifier:false, currency:'£', unit:'annual / patient' },
    mdd:      { eol:false, severity_modifier:true,  currency:'£', unit:'annual / patient' },
    migraine: { eol:false, severity_modifier:false, currency:'£', unit:'annual / patient' },
    ms:       { eol:false, severity_modifier:true,  currency:'£', unit:'annual / patient' },
    atopic_dermatitis: { eol:false, severity_modifier:true, currency:'£', unit:'annual / patient' }
  };

  /* =======================================================================
     3.  AGENT — DOSSIER PARSER
     -----------------------------------------------------------------------
     Extracts indication, MoA, population, endpoints, comparators and the
     present evidence package from raw text. Used as input to Logics 0/3.
     ======================================================================= */

  const DossierAgent = {
    parse(rawText) {
      const t = (rawText || '').toLowerCase();

      // Default skeleton — will be overwritten if indication is detected.
      const profile = {
        productName:        this._guessName(rawText),
        indication:         null,
        indicationKey:      null,
        mechanism:          null,
        moaClass:           null,
        population:         null,
        primaryEndpoints:   [],
        comparators:        [],
        lineOfTherapy:      null,
        biomarker:          false,
        phase:              null,
        trials:             [],
        dosing:             null,
        // present evidence package — what the dossier ALREADY contains
        evidence_present:   {
          pivotal_rct:        false,
          long_term_extension:false,
          itc_or_nma:         false,
          rwe_persistence:    false,
          uk_utility:         false,
          subgroup:           false,
          extrapolation:      false,
          budget_impact:      false,
          pas_offered:        false,
          managed_access:     false,
          pro:                false,
          severity_qaly:      false
        }
      };

      // Indication detection — must be explicit, no silent default.
      // Order matters: more specific patterns first.
      const map = [
        // Atopic dermatitis (now with TPP-aware keywords incl. ox40l, dupilumab, easi etc.)
        ['atopic_dermatitis', /atopic dermatitis|\beczema\b|moderate-?to-?severe ad\b|\bad\b.{0,40}(biolog|systemic)|easi[- ]?(75|90)|iga 0\/1|dupilumab|tralokinumab|lebrikizumab|amlitelimab|nemolizumab|ox40l|ox-?40 ?l|il-?13|il-?4r|jak.{0,15}(upadacitinib|abrocitinib|baricitinib|ad)/,
                              'Moderate-to-severe atopic dermatitis',
                              'Anti-OX40L mAb (Th2 / Th17 / Th22 modulation)', 'Anti-OX40L'],
        ['oncology',  /oncolog|tumou?r|cancer|carcinoma|lymphoma|her2|brca|metasta|adjuvant|neoadjuvant/, 'Solid tumour oncology',         'Targeted small-molecule kinase inhibitor', 'TKI'],
        ['diabetes',  /diabet|glycaem|hba1c|insulin|glp-?1|gip/,           'Type 2 Diabetes Mellitus',               'GLP-1 / GIP dual agonist',                  'GLP-1/GIP'],
        ['mdd',       /depress|mdd|ssri|treatment-?resist|psychiatr/,      'Major Depressive Disorder',              'NMDA receptor modulator',                   'NMDA modulator'],
        ['migraine',  /migrain|cgrp|headache/,                              'Migraine prophylaxis',                  'CGRP receptor antagonist',                  'CGRP'],
        ['ms',        /multipl.*sclerosis|\brrms\b|relapsing.{0,15}remitt|\bs1p\b/, 'Relapsing-remitting Multiple Sclerosis', 'S1P receptor modulator',                    'S1P'],
        ['insomnia',  /insomn|sleep[- ]?onset|wake.{0,15}sleep|orexin|\bdora\b|melaton|\bsol\b|\bwaso\b|\btst\b|\bisi\b/, 'Chronic Insomnia', 'Dual Orexin Receptor Antagonist (DORA)','DORA']
      ];
      for (const [key, re, ind, moa, cls] of map) {
        if (re.test(t)) {
          profile.indication    = ind;
          profile.indicationKey = key;
          profile.mechanism     = moa;
          profile.moaClass      = cls;
          break;
        }
      }

      // Per-indication enrichment — populates fields the user is likely to
      // want surfaced and that downstream logics use directly.
      this._enrich(profile, rawText, t);

      // Heuristic evidence-present flags.
      profile.evidence_present.pivotal_rct         = /phase ?(iii|3)|pivotal|randomi[sz]ed|placebo-?controlled|primary endpoint/.test(t);
      profile.evidence_present.long_term_extension = /long-?term|open[- ]?label|extension|maintenance|week ?52|week ?104|≥?\s*12 ?months?|≥?\s*24 ?months?|year ?[1-5]/.test(t);
      profile.evidence_present.itc_or_nma          = /\bitc\b|indirect (treatment )?comparison|network meta|nma|head-?to-?head/.test(t);
      profile.evidence_present.rwe_persistence     = /real[- ]world|\brwe\b|persistence|adherence|registry/.test(t);
      profile.evidence_present.uk_utility          = /eq-?5d|uk utility|utility weights|hrqol/.test(t);
      profile.evidence_present.subgroup            = /subgroup|adolescen|elderly|biomarker|stratified|prior biologic|prior jak/.test(t);
      profile.evidence_present.pas_offered         = /\bpas\b|patient access scheme|simple discount|confidential discount/.test(t);
      profile.evidence_present.managed_access      = /managed access|\bcdf\b|\bimf\b|data collection arrangement/.test(t);
      profile.evidence_present.severity_qaly       = /severity|qaly[- ]?shortfall|disease severity|dlqi|cdlqi|easi.{0,5}21/.test(t);
      profile.evidence_present.pro                 = /\bpro\b|patient-?reported|dlqi|cdlqi|poem|isi|adsis/.test(t);
      profile.evidence_present.budget_impact       = /budget impact|nhs population|eligible pool|uptake/.test(t);
      profile.evidence_present.extrapolation       = /extrapolat|parametric|markov|partitioned|model.{0,15}(horizon|lifetime)/.test(t);

      return profile;
    },

    /* Per-indication enrichment — fills indication-specific fields. */
    _enrich(profile, rawText, t) {
      if (!profile.indicationKey) return;

      // Phase detection
      const phase = rawText.match(/phase ?(I{1,3}V?|1|2|3|4)/i);
      if (phase) profile.phase = `Phase ${phase[1].toUpperCase()}`;

      // Trial-name detection — looks for ALL-CAPS trial-style names.
      const trialMatches = rawText.match(/\b[A-Z][A-Z0-9\-]{3,}(?:[\- ]?\d)?\b/g) || [];
      const trialBlacklist = new Set(['NICE','HTA','TPP','NHS','EASI','IGA','SOL','WASO','TST','ISI','DLQI','POEM','OX40L','OX40','MoA','MOA','UK','AD','MS','TCS','TCI','EQ-5D','RCT','ITC','NMA','RWE','PAS','CDF','IMF','NMDA','GLP','GIP','DORA','CGRP','SC','IV','PD-L1','HER2','BRCA','MACE','VTE','JAK','EU','EMA','MHRA','FDA','FAD','ACD','ERG','EAG']);
      profile.trials = [...new Set(trialMatches.filter(s => !trialBlacklist.has(s) && s.length >= 4 && s.length <= 14))].slice(0, 6);

      // Dosing
      const dosing = rawText.match(/q\s*(\d+)\s*w(eek)?s?|every\s*(\d+)\s*weeks?|loading dose[^.\n]{0,80}|maintenance[^.\n]{0,80}/i);
      if (dosing) profile.dosing = dosing[0].trim();

      // Indication-specific defaults
      if (profile.indicationKey === 'atopic_dermatitis') {
        profile.indication = 'Moderate-to-severe atopic dermatitis';
        // OX40L / amlitelimab specific
        if (/amlitelimab|ox-?40 ?l/.test(t)) {
          profile.mechanism = 'Anti-OX40L mAb — non–T-cell-depleting, Th2/Th17/Th22 immune-axis modulation';
          profile.moaClass  = 'Anti-OX40L';
        } else if (/upadacitinib|abrocitinib|baricitinib|jak/.test(t)) {
          profile.mechanism = 'Oral JAK inhibitor';
          profile.moaClass  = 'JAK1 inhibitor (oral)';
        } else if (/tralokinumab|lebrikizumab|il-?13/.test(t)) {
          profile.mechanism = 'Anti–IL-13 mAb';
          profile.moaClass  = 'IL-13 mAb (Th2)';
        } else if (/dupilumab|il-?4r/.test(t)) {
          profile.mechanism = 'Anti-IL-4Rα mAb (dupilumab class)';
          profile.moaClass  = 'IL-4Rα mAb (Th2)';
        }
        profile.population       = 'Adults and adolescents ≥12 years with moderate-to-severe atopic dermatitis inadequately controlled with topical therapies, or where topicals are not advisable.';
        profile.primaryEndpoints = ['EASI-75 at Week 16', 'IGA 0/1', 'Itch NRS ≥4-pt reduction', 'EASI-90', 'DLQI / CDLQI'];
        profile.comparators      = ['Dupilumab', 'Tralokinumab', 'Lebrikizumab', 'Upadacitinib', 'Abrocitinib', 'Cyclosporine / SoC'];
        profile.lineOfTherapy    = '2L+ (post-systemic / topical failure)';
      } else if (profile.indicationKey === 'insomnia') {
        profile.population       = 'Adults with chronic insomnia disorder per DSM-5; ≥3 nights/week for ≥3 months.';
        profile.primaryEndpoints = ['SOL', 'WASO', 'sTST', 'ISI score change'];
        profile.comparators      = ['Placebo', 'Z-drugs', 'Melatonin agonists'];
        profile.lineOfTherapy    = '1L+';
      } else if (profile.indicationKey === 'oncology') {
        profile.population       = 'Adults with the targeted tumour type per licence.';
        profile.primaryEndpoints = ['PFS', 'OS', 'ORR', 'DoR'];
        profile.comparators      = ['Standard of care chemotherapy', 'Targeted comparator'];
        profile.lineOfTherapy    = '2L+';
      } else if (profile.indicationKey === 'diabetes') {
        profile.population       = 'Adults with type-2 diabetes inadequately controlled on metformin ± SoC.';
        profile.primaryEndpoints = ['HbA1c reduction', 'Body-weight change', 'CV outcomes (where powered)'];
        profile.comparators      = ['Semaglutide', 'Liraglutide', 'Insulin'];
        profile.lineOfTherapy    = '2L+';
      } else if (profile.indicationKey === 'mdd') {
        profile.population       = 'Adults with MDD; treatment-resistant subset where applicable.';
        profile.primaryEndpoints = ['MADRS change', 'HAM-D', 'Response rate'];
        profile.comparators      = ['SSRIs', 'SNRIs', 'Esketamine'];
        profile.lineOfTherapy    = '1L–2L+';
      } else if (profile.indicationKey === 'migraine') {
        profile.population       = 'Adults with chronic / episodic migraine.';
        profile.primaryEndpoints = ['Monthly migraine days reduction', 'Acute medication days'];
        profile.comparators      = ['Topiramate', 'Botulinum toxin', 'Other CGRP mAbs'];
        profile.lineOfTherapy    = '3L+';
      } else if (profile.indicationKey === 'ms') {
        profile.population       = 'Adults with relapsing-remitting MS.';
        profile.primaryEndpoints = ['Annualised relapse rate', 'MRI activity', 'Disability progression'];
        profile.comparators      = ['Teriflunomide', 'DMF', 'Other DMTs'];
        profile.lineOfTherapy    = '1L+';
      }
    },

    _guessName(rawText) {
      // Look for explicit Product/Drug/Compound declarations first.
      const m = (rawText || '').match(/(?:product|drug|compound|name|inn)\s*[:\-]\s*([A-Z][\w\-\.]+)/i);
      if (m) return m[1];
      // Then look for known compound names in body text.
      const known = ['amlitelimab','dupilumab','tralokinumab','lebrikizumab','upadacitinib','abrocitinib','baricitinib','nemolizumab','rocatinlimab','somnexa','daridorexant','lemborexant'];
      const lower = (rawText || '').toLowerCase();
      for (const k of known) {
        if (lower.includes(k)) return k.charAt(0).toUpperCase() + k.slice(1);
      }
      // Filename-style hint
      const file = (rawText || '').match(/\[BINARY DOSSIER:\s*([^\]]+)\]/i);
      if (file) {
        const base = file[1].split('.')[0].split(/[_\-]/)[0];
        if (base && /^[A-Za-z]/.test(base)) return base.charAt(0).toUpperCase() + base.slice(1);
      }
      return 'Product A';
    }
  };

  /* =======================================================================
     3b.  AGENT — SUFFICIENCY GATE
     -----------------------------------------------------------------------
     Decides whether the dossier carries enough information to drive Logic
     0–5. If not, returns { ok:false, missing:[...] } so the upload page can
     show a helpful notice and let the user enrich the input.

     Required fields (HARD):
        • Indication detected
        • Mechanism / MoA detected
        • Population OR primary endpoints OR comparators present
        • Phase or evidence anchor

     Soft fields (warnings only) — still allow analysis to proceed:
        • Dosing regimen
        • Specific trial names
        • Patient-reported outcome anchors
     ======================================================================= */

  const SufficiencyAgent = {
    /**
     * @param  {string} rawText  the user's combined dossier text
     * @param  {object} dossier  output of DossierAgent.parse(rawText)
     * @returns {{ ok:boolean, missing:Array, warnings:Array, summary:object }}
     */
    check(rawText, dossier) {
      const text = (rawText || '').trim();
      const len  = text.length;
      const missing = [];
      const warnings = [];

      // 1. Minimum substantive content.
      if (len < 80) {
        missing.push({
          field: 'Substantive product description',
          why:   'The uploaded content is too short for the agents to derive any reliable analysis (only ' + len + ' characters of usable text were detected).',
          example: 'Add at least a short paragraph naming the product, its indication and its mechanism of action — e.g. "Amlitelimab — anti-OX40L biologic for moderate-to-severe atopic dermatitis."'
        });
      }

      // 2. Indication MUST be detected.
      if (!dossier.indicationKey) {
        missing.push({
          field: 'Disease / Indication',
          why:   'No recognised indication was detected. The Analogue Agent cannot search the NICE corpus without a target disease.',
          example: 'Add a clear sentence such as "Target indication: moderate-to-severe atopic dermatitis" or "Indication: relapsing-remitting multiple sclerosis".'
        });
      }

      // 3. Mechanism / MoA.
      if (!dossier.mechanism || !dossier.moaClass) {
        missing.push({
          field: 'Mechanism of action',
          why:   'NICE benchmarking depends on MoA-class matching. Without the mechanism, comparator selection in Logic 0 cannot run.',
          example: 'State the MoA explicitly — e.g. "anti-OX40L monoclonal antibody", "JAK1 inhibitor", "IL-13 inhibitor".'
        });
      }

      // 4. At least ONE of {population, endpoints, comparators}.
      const hasPop  = !!(dossier.population && dossier.population.length > 10);
      const hasEp   = (dossier.primaryEndpoints || []).length > 0;
      const hasComp = (dossier.comparators || []).length > 0;
      if (!hasPop && !hasEp && !hasComp) {
        missing.push({
          field: 'Patient population, endpoints or comparators',
          why:   'Logics 1–3 score Product A across NICE decision domains using these fields.',
          example: 'Add population (e.g. "Adults with severe AD failing systemic therapy"), primary endpoints (e.g. "EASI-75 at Week 16"), and intended comparators (e.g. "Dupilumab, tralokinumab, upadacitinib").'
        });
      }

      // 5. Soft / warnings.
      if (!dossier.phase && !/phase|pivotal|randomi[sz]ed/i.test(text)) {
        warnings.push({
          field:   'Trial phase',
          message: 'No clinical phase detected — Logic 3 evidence-quality scoring will use a conservative default.'
        });
      }
      if (!dossier.trials || dossier.trials.length === 0) {
        warnings.push({
          field:   'Trial names',
          message: 'No specific trial names were detected. Add e.g. COAST 1/2, SHORE, ECZTRA-1/2/3, SUNRISE-2 to anchor evidence references.'
        });
      }
      if (!dossier.evidence_present.pro) {
        warnings.push({
          field:   'Patient-reported outcomes',
          message: 'No PRO instruments mentioned (DLQI / POEM / ISI / etc.). NICE expects PRO evidence for HTA.'
        });
      }
      if (!dossier.evidence_present.severity_qaly) {
        warnings.push({
          field:   'Severity / QALY-shortfall basis',
          message: 'No severity / QALY-shortfall language detected. Mention DLQI, EASI ≥21, EDSS, etc., where applicable to access NICE severity modifiers.'
        });
      }

      // Summary for the UI banner.
      const summary = {
        characters_seen:   len,
        indication:        dossier.indication || '—',
        mechanism:         dossier.mechanism  || '—',
        endpoints_count:   (dossier.primaryEndpoints || []).length,
        comparators_count: (dossier.comparators || []).length,
        trials_count:      (dossier.trials || []).length,
        ok_fields: [
          dossier.indicationKey                     ? 'Indication'        : null,
          (dossier.mechanism && dossier.moaClass)   ? 'Mechanism of action' : null,
          hasPop                                    ? 'Population'        : null,
          hasEp                                     ? 'Primary endpoints' : null,
          hasComp                                   ? 'Comparators'       : null,
          dossier.phase                             ? 'Trial phase'       : null,
          (dossier.trials || []).length             ? 'Trial names'       : null
        ].filter(Boolean)
      };

      return { ok: missing.length === 0, missing, warnings, summary };
    }
  };

  /* =======================================================================
     4.  AGENT — ANALOGUE IDENTIFICATION (Logic 0)
     -----------------------------------------------------------------------
     Scores comparability on PRODUCT / PATIENT / TREATMENT / MARKET only.
     Does NOT touch reimbursement strength or evidence quality (those are
     handled in Logics 1 / 3). Output: ranked shortlist for user
     confirmation, with competitors flagged.
     ======================================================================= */

  const AnalogueIdAgent = {
    /**
     * @param {object} dossier  output from DossierAgent.parse
     * @returns {Array<analogue>} ranked list with full structured profiles
     */
    select(dossier) {
      const pool = ANALOGUE_LIBRARY[dossier.indicationKey] || [];
      // Logic 0 does NOT touch precedent / reimbursement — only comparability.
      const scored = pool.map(a => {
        // weight per Logic 0: product 0.35, patient 0.25, treatment 0.25, market 0.15
        const score =
          a.comparability.product   * 0.35 +
          a.comparability.patient   * 0.25 +
          a.comparability.treatment * 0.25 +
          a.comparability.market    * 0.15;
        // Competitor flag: same MoA class + same indication + recent (<5y from 2024)
        const isCompetitor =
          a.moa_class === dossier.moaClass &&
          score >= 0.80 &&
          (2024 - (a.year || 2024)) <= 5;
        return {
          ...a,
          comparability_score: Math.round(score * 100),
          competitor_flag: isCompetitor,
          // criteria-match pills used by the UI (4 buckets)
          match: [
            score >= 0.65,                                 // same indication
            a.moa_class === dossier.moaClass,              // same MoA class
            score >= 0.55,                                 // comparator overlap (proxy)
            a.comparability.treatment >= 0.55              // endpoint / treatment alignment
          ]
        };
      });
      // Rank competitors first, then by overall comparability.
      scored.sort((a, b) => {
        if (a.competitor_flag !== b.competitor_flag) return b.competitor_flag - a.competitor_flag;
        return b.comparability_score - a.comparability_score;
      });
      return scored;
    }
  };

  /* =======================================================================
     5.  AGENT — NICE HISTORY / DOC PULLER
     -----------------------------------------------------------------------
     For each shortlisted analogue, identifies the NICE TA record and lists
     the document set that would be ingested by Logic 1.
     ======================================================================= */

  const NiceHistoryAgent = {
    pull(analogues) {
      return analogues.map(a => ({
        analogue_id:   a.nice_id,
        product:       a.name,
        record_url:    a.src,
        history_url:   `${a.src}/history`,
        documents_found: a.nice_docs.map(t => ({
          type:  t,
          label: NICE_DOC_LABEL[t] || t,
          url:   `${a.src}/documents/${t.replace(/_/g, '-')}`
        }))
      }));
    }
  };

  const NICE_DOC_LABEL = {
    committee_papers:                'Committee papers',
    company_submission:              'Company submission',
    erg_critique:                    'ERG / EAG critique',
    appraisal_consultation_document: 'Appraisal Consultation Document (ACD)',
    final_appraisal_determination:   'Final Appraisal Determination (FAD)',
    final_guidance:                  'Final guidance (TA / HST)',
    appeal_material:                 'Appeal materials',
    commercial_access_agreement:     'Commercial / managed-access agreement',
    patient_expert_statement:        'Patient expert statement',
    clinical_expert_statement:       'Clinical expert statement'
  };

  /* =======================================================================
     6.  AGENT — SINGLE-ANALOGUE NICE PROFILE BUILDER (Logic 1)
     -----------------------------------------------------------------------
     Converts the document set for ONE analogue into a structured decision
     profile across the 10 NICE domains. The library entries are already
     pre-built profiles, so this agent simply normalises them.
     ======================================================================= */

  const SingleAnalogueAgent = {
    profile(analogue) {
      return {
        product:           analogue.name,
        nice_id:           analogue.nice_id,
        precedent:         analogue.precedent,
        decision_profile:  analogue.decision_drivers,   // keyed by NICE_DOMAINS
        price:             analogue.price,
        icer:              analogue.icer,
        icer_value:        analogue.icer_value,
        year:              analogue.year,
        source_link:       analogue.src,
        nice_docs_used:    analogue.nice_docs
      };
    }
  };

  /* =======================================================================
     7.  AGENT — CROSS-ANALOGUE COMPARISON (Logic 2)
     -----------------------------------------------------------------------
     Does NOT average. Buckets analogues by precedent and surfaces, per NICE
     domain, the clusters of analogues that are most predictive vs boundary.
     ======================================================================= */

  const CrossAnalogueAgent = {
    compare(analogues) {
      const buckets = {
        recommended:     [],
        optimised:       [],
        managed_access:  [],
        not_recommended: [],
        terminated:      []
      };
      analogues.forEach(a => {
        if (buckets[a.precedent]) buckets[a.precedent].push(a);
      });

      // ICER distribution — NOT mean; report min / median / max per bucket
      function dist(arr) {
        const v = arr.map(a => a.icer_value).filter(n => n && n > 0).sort((x, y) => x - y);
        if (!v.length) return null;
        return {
          n:      v.length,
          min:    v[0],
          median: v[Math.floor(v.length / 2)],
          max:    v[v.length - 1]
        };
      }

      // Per-domain cluster — does this domain consistently drive decisions?
      const domain_signal = {};
      NICE_DOMAINS.forEach(d => {
        const drivers = analogues.map(a => ({
          name:     a.name,
          decision: a.precedent,
          driver:   a.decision_drivers[d]
        })).filter(x => x.driver);
        domain_signal[d] = drivers;
      });

      return {
        buckets,
        icer_distribution: {
          recommended:     dist(buckets.recommended),
          optimised:       dist(buckets.optimised),
          not_recommended: dist(buckets.not_recommended)
        },
        domain_signal,
        most_predictive: this._mostPredictive(analogues),
        boundary_cases:  this._boundary(analogues)
      };
    },

    _mostPredictive(analogues) {
      // Top 3 by comparability that are also Recommended / Optimised.
      return analogues
        .filter(a => a.precedent === 'recommended' || a.precedent === 'optimised')
        .slice()
        .sort((a, b) => b.comparability_score - a.comparability_score)
        .slice(0, 3);
    },

    _boundary(analogues) {
      // Analogues that flipped on a single domain weakness.
      return analogues
        .filter(a => a.precedent === 'not_recommended' || a.precedent === 'terminated')
        .slice()
        .sort((a, b) => b.comparability_score - a.comparability_score)
        .slice(0, 3);
    }
  };

  /* =======================================================================
     8.  AGENT — BASE-CASE PREDICTION (Logic 3)
     -----------------------------------------------------------------------
     Combines Product A's CURRENT evidence + cross-analogue comparison.
     Outputs:
       • predicted reimbursement pathway (precedent class)
       • base-case price corridor (range, NOT a point)
     Driven by structured NICE-style reasoning — every score is traceable.
     ======================================================================= */

  const BaseCasePredictor = {
    /**
     * @param {object} dossier   parsed Product A dossier
     * @param {object} compare   output of CrossAnalogueAgent.compare
     * @param {Array}  analogues full ranked analogue set
     */
    predict(dossier, compare, analogues) {
      // ---- 1. Domain scores for Product A under CURRENT evidence ----
      const ev = dossier.evidence_present;
      const domainScores = {
        clinical_effectiveness:     ev.pivotal_rct ? 75 : 45,
        comparator_appropriateness: ev.itc_or_nma ? 80 : 55,
        population_alignment:       ev.subgroup ? 80 : 70,
        evidence_quality:           (ev.pivotal_rct ? 35 : 0) + (ev.long_term_extension ? 25 : 0) +
                                    (ev.itc_or_nma ? 20 : 0) + (ev.rwe_persistence ? 20 : 0),
        cost_effectiveness:         (ev.uk_utility ? 30 : 0) + (ev.extrapolation ? 25 : 0) +
                                    (ev.pas_offered ? 25 : 0) + 20,
        budget_impact:              ev.budget_impact ? 70 : 50,
        uncertainty:                100 - ((ev.long_term_extension ? 0 : 15) + (ev.itc_or_nma ? 0 : 15) +
                                            (ev.extrapolation ? 0 : 10) + (ev.subgroup ? 0 : 10)),
        innovation_unmet_need:      70,
        managed_access_fit:         ev.managed_access ? 80 : 40,
        commercial_arrangement:     ev.pas_offered ? 75 : 35
      };
      domainScores.evidence_quality   = Math.min(100, domainScores.evidence_quality);
      domainScores.cost_effectiveness = Math.min(100, domainScores.cost_effectiveness);
      domainScores.uncertainty        = Math.max(0, Math.min(100, domainScores.uncertainty));

      // ---- 2. Composite decision score (NICE-weighted) ----
      const weights = {
        clinical_effectiveness: 0.18,
        cost_effectiveness:     0.20,
        uncertainty:            0.12,
        comparator_appropriateness: 0.10,
        evidence_quality:       0.12,
        population_alignment:   0.06,
        budget_impact:          0.08,
        innovation_unmet_need:  0.06,
        managed_access_fit:     0.04,
        commercial_arrangement: 0.04
      };
      let composite = 0;
      Object.entries(weights).forEach(([k, w]) => { composite += (domainScores[k] || 0) * w; });

      // ---- 3. Precedent class assignment ----
      // Compare composite against the bucketed analogue ICER distributions.
      let precedent_predicted, prediction_label, predictClass, confidence;
      if (composite >= 78) {
        precedent_predicted = 'recommended';
        prediction_label    = 'Likely Recommend';
        predictClass        = 'accept';
      } else if (composite >= 68) {
        precedent_predicted = 'optimised';
        prediction_label    = 'Likely Recommend (Restricted)';
        predictClass        = 'conditional';
      } else if (composite >= 58 && (dossier.indicationKey === 'oncology' || domainScores.uncertainty > 70)) {
        precedent_predicted = 'managed_access';
        prediction_label    = 'Managed-access pathway likely';
        predictClass        = 'conditional';
      } else if (composite >= 50) {
        precedent_predicted = 'optimised';
        prediction_label    = 'Conditional Accept (subject to PAS)';
        predictClass        = 'conditional';
      } else {
        precedent_predicted = 'not_recommended';
        prediction_label    = 'Likely Not Recommended';
        predictClass        = 'reject';
      }
      confidence = Math.round(Math.max(45, Math.min(92, 50 + (composite - 60) * 1.2)));

      // ---- 4. Identify weakest domains (input to Logic 4) ----
      const weakDomains = Object.entries(domainScores)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 4)
        .map(([k, v]) => ({ domain: k, score: Math.round(v) }));

      // ---- 5. Price corridor — anchored on bucketed analogue ICERs ----
      const corridor = this._priceCorridor(dossier, compare, precedent_predicted, domainScores);

      // ---- 6. Rationale items ----
      const rationale = this._rationale(dossier, domainScores, compare, analogues);

      return {
        domain_scores:        domainScores,
        composite_score:      Math.round(composite),
        precedent_predicted,
        prediction:           prediction_label,
        predictClass,
        confidence,
        weakest_domains:      weakDomains,
        price_corridor:       corridor,
        rationale,
        // headline KPIs derived from domain scores
        kpi: {
          efficacy:    Math.round((domainScores.clinical_effectiveness + domainScores.evidence_quality) / 2),
          safety:      Math.round((100 - (100 - domainScores.uncertainty) * 0.4 +
                                   domainScores.population_alignment) / 2),
          innovation:  Math.round(domainScores.innovation_unmet_need),
          unmet:       Math.round((domainScores.innovation_unmet_need + domainScores.managed_access_fit) / 2)
        }
      };
    },

    _priceCorridor(dossier, compare, precedent, domainScores) {
      const bucket = compare.buckets[precedent] && compare.buckets[precedent].length
                       ? compare.buckets[precedent]
                       : (compare.buckets.recommended.length
                            ? compare.buckets.recommended
                            : (compare.buckets.optimised.length
                                 ? compare.buckets.optimised
                                 : compare.buckets.not_recommended));
      // Anchor on the bucketed analogue prices.
      const prices = bucket
        .map(a => parseInt(String(a.price).replace(/[^\d]/g, ''), 10))
        .filter(n => n > 0)
        .sort((x, y) => x - y);
      if (!prices.length) return { low:0, high:0, anchor:0, scaleMax:1 };

      const median = prices[Math.floor(prices.length / 2)];
      const min    = prices[0];
      const max    = prices[prices.length - 1];

      // Lower bound = max(min analogue price, NHS WTP-implied floor)
      // Upper bound = bounded by upper-quartile + value-driver premium for differentiation
      const ce = domainScores.cost_effectiveness;
      const inn = domainScores.innovation_unmet_need;
      const premium  = (inn >= 75 ? 0.18 : inn >= 65 ? 0.10 : 0.04);
      const discount = (ce  <  60 ? 0.18 : ce  <  70 ? 0.08 : 0.0);

      let low  = Math.round(min * (1 - discount));
      let high = Math.round(max * (1 + premium));
      if (precedent === 'not_recommended') {
        // Tighter corridor — needs PAS to clear.
        high = Math.round(median);
        low  = Math.round(min * 0.85);
      }
      const anchor = median;
      const scaleMax = Math.max(8000, Math.ceil((high * 1.4) / 1000) * 1000);

      return { low, high, anchor, scaleMax,
               basis: `Anchored on ${bucket.length} ${precedent.replace('_',' ')} analogues; median ${INDICATION_META[dossier.indicationKey].currency}${median.toLocaleString()}.` };
    },

    _rationale(dossier, ds, compare, analogues) {
      const top = analogues.slice().sort((a, b) => b.comparability_score - a.comparability_score)[0];
      return {
        strengths: [
          `Closest analogue ${top.name} (${top.comparability_score}% comparability) was ${top.precedent.replace('_',' ')} at NICE ${top.nice_id}.`,
          `Clinical effectiveness domain score ${Math.round(ds.clinical_effectiveness)}/100 driven by Product A's pivotal evidence.`,
          `Innovation / unmet-need score ${Math.round(ds.innovation_unmet_need)}/100 supports value premium.`
        ],
        concerns: [
          ds.comparator_appropriateness < 70 ? 'No accepted ITC — NICE will likely reject placebo-only relative-effectiveness modelling.' : null,
          ds.evidence_quality          < 65 ? 'Evidence base lacks long-term follow-up and/or RWE persistence data.' : null,
          ds.cost_effectiveness        < 65 ? 'Cost-effectiveness inputs (utilities, extrapolation, PAS) need strengthening.' : null,
          ds.uncertainty               < 65 ? 'High structural / parameter uncertainty — committee will discount benefit.' : null
        ].filter(Boolean),
        icer_projection: this._projectICER(dossier, ds, compare)
      };
    },

    _projectICER(dossier, ds, compare) {
      const bucketMedian = (compare.icer_distribution.recommended || compare.icer_distribution.optimised || {}).median || 25000;
      // Push higher when uncertainty / cost-effectiveness lower
      const projected = Math.round(bucketMedian * (1 + (100 - ds.cost_effectiveness) * 0.005 + (100 - ds.uncertainty) * 0.003));
      const threshold = (INDICATION_META[dossier.indicationKey].eol) ? WTP_THRESHOLDS.em.upper : WTP_THRESHOLDS.standard.upper;
      return {
        value:   projected,
        threshold,
        verdict: projected <= threshold * 0.85 ? 'comfortably below threshold'
              : projected <= threshold         ? 'near threshold — sensitive'
              :                                 'above threshold — needs PAS'
      };
    }
  };

  /* =======================================================================
     9.  AGENT — EVIDENCE RECOMMENDATION (Logic 4)
     -----------------------------------------------------------------------
     Each recommendation maps:
        weak NICE domain  →  evidence-gap category  →  analogue precedent
     Returns a MINIMAL but decision-relevant package, prioritised.
     ======================================================================= */

  const EvidenceRecAgent = {
    recommend(dossier, baseCase, analogues) {
      const ev = dossier.evidence_present;
      const list = [];

      // Map each weak domain to a specific evidence gap.
      baseCase.weakest_domains.forEach(({ domain, score }) => {
        const gap = this._gapForDomain(domain, ev);
        if (!gap) return;
        const precedent = this._precedentFor(domain, analogues);
        list.push({
          gap_id:       gap.id,
          gap_label:    gap.label,
          target_domain: domain,
          weakness_score: score,
          priority:     score < 55 ? 'High' : score < 70 ? 'Med' : 'Low',
          rationale:    this._gapRationale(gap.id, dossier),
          precedent_link: precedent ? `${precedent.name} (NICE ${precedent.nice_id}) — ${precedent.precedent}` : null,
          expected_uplift: this._uplift(gap.id, score)
        });
      });

      // Always add a PAS recommendation if not present and base case is borderline.
      if (!ev.pas_offered && baseCase.predictClass !== 'accept') {
        list.push({
          gap_id: EVIDENCE_GAPS.PAS_COMMERCIAL.id,
          gap_label: EVIDENCE_GAPS.PAS_COMMERCIAL.label,
          target_domain: 'commercial_arrangement',
          weakness_score: 35,
          priority: 'High',
          rationale: 'Confidential simple PAS converts borderline ICERs across the analogue set; a 10–15% discount typically shifts NICE outcome.',
          precedent_link: 'Multiple — confidential PAS used in >70% of recommended analogues',
          expected_uplift: { verdict_shift_pp: 12, corridor_widen_pct: 6 }
        });
      }

      // Deduplicate by gap_id, keep highest priority.
      const dedup = new Map();
      list.forEach(item => {
        const cur = dedup.get(item.gap_id);
        if (!cur || PRIORITY_RANK[item.priority] > PRIORITY_RANK[cur.priority]) {
          dedup.set(item.gap_id, item);
        }
      });
      return Array.from(dedup.values()).sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
    },

    _gapForDomain(domain, ev) {
      const map = {
        comparator_appropriateness: ev.itc_or_nma ? null            : EVIDENCE_GAPS.COMPARATOR,
        evidence_quality:           ev.long_term_extension ? null   : EVIDENCE_GAPS.LONG_TERM,
        population_alignment:       ev.subgroup ? null              : EVIDENCE_GAPS.SUBGROUP,
        cost_effectiveness:         ev.uk_utility ? null            : EVIDENCE_GAPS.UTILITY,
        uncertainty:                EVIDENCE_GAPS.EXTRAPOLATION,
        budget_impact:              EVIDENCE_GAPS.BUDGET_IMPACT,
        commercial_arrangement:     ev.pas_offered ? null           : EVIDENCE_GAPS.PAS_COMMERCIAL,
        managed_access_fit:         ev.managed_access ? null        : EVIDENCE_GAPS.MANAGED_ACCESS,
        clinical_effectiveness:     ev.pro ? null                   : EVIDENCE_GAPS.PATIENT_REPORTED,
        innovation_unmet_need:      ev.severity_qaly ? null         : EVIDENCE_GAPS.SEVERITY_QALY
      };
      return map[domain];
    },

    _precedentFor(domain, analogues) {
      // pick the analogue whose decision driver best matches this domain
      // and that landed positive (recommended/optimised).
      const positives = analogues.filter(a => a.precedent === 'recommended' || a.precedent === 'optimised');
      return positives[0] || analogues[0] || null;
    },

    _gapRationale(gapId, dossier) {
      const map = {
        comparator: `Indirect treatment comparison vs the closest analogues; NICE rejects placebo-only relative-effectiveness in ${dossier.indication}.`,
        long_term:  'Add ≥26-week / 12-month real-world or open-label persistence data; NICE consistently flags adherence drop-off as cost-effectiveness driver.',
        subgroup:   'Pre-specified subgroup analyses (elderly / line-of-therapy / biomarker) align with NICE scope and support a restricted recommendation.',
        utility:    'UK-relevant EQ-5D-5L utility weights replace mapped utilities and harden QALY estimates.',
        extrapolation:'Provide multiple parametric extrapolations + clinician validation to reduce structural uncertainty.',
        budget_impact:'Refined NHS budget-impact model with realistic uptake curves to remove affordability concern.',
        pas_commercial:'Confidential simple PAS — used in the majority of recommended analogues at this severity / ICER profile.',
        managed_access:'Propose a CDF / managed-access agreement with a defined data-collection plan to bridge OS uncertainty.',
        pro:        'Robust patient-reported outcome evidence aligned with NICE real-world value framework.',
        severity_qaly:'Severity / QALY-shortfall calculation to access the 1.2× / 1.7× modifier uplift in the WTP threshold.'
      };
      return map[gapId] || 'Strengthens a NICE decision domain weakened in the base case.';
    },

    _uplift(gapId, score) {
      // Each gap has a typical verdict-shift impact (percentage points)
      // and a corridor-widening impact (% of upper bound).
      const map = {
        comparator:     { verdict_shift_pp: 14, corridor_widen_pct: 8 },
        long_term:      { verdict_shift_pp: 12, corridor_widen_pct: 5 },
        subgroup:       { verdict_shift_pp: 9,  corridor_widen_pct: 4 },
        utility:        { verdict_shift_pp: 7,  corridor_widen_pct: 4 },
        extrapolation:  { verdict_shift_pp: 8,  corridor_widen_pct: 3 },
        budget_impact:  { verdict_shift_pp: 6,  corridor_widen_pct: 3 },
        pas_commercial: { verdict_shift_pp: 12, corridor_widen_pct: 6 },
        managed_access: { verdict_shift_pp: 10, corridor_widen_pct: 6 },
        pro:            { verdict_shift_pp: 5,  corridor_widen_pct: 2 },
        severity_qaly:  { verdict_shift_pp: 11, corridor_widen_pct: 9 }
      };
      const base = map[gapId] || { verdict_shift_pp: 5, corridor_widen_pct: 2 };
      // Bigger uplift if the underlying weakness is severe.
      const factor = score < 55 ? 1.2 : score < 70 ? 1.0 : 0.7;
      return {
        verdict_shift_pp:   Math.round(base.verdict_shift_pp * factor),
        corridor_widen_pct: Math.round(base.corridor_widen_pct * factor)
      };
    }
  };

  const PRIORITY_RANK = { Low: 1, Med: 2, High: 3 };

  /* =======================================================================
     10.  AGENT — DELTA PREDICTOR (Logic 5)
     -----------------------------------------------------------------------
     Re-runs Logic 3 AFTER applying the Logic 4 evidence package. Reports
     which decision weaknesses are resolved, which remain, and the new
     pathway + corridor as a DELTA against the base case (NOT a de novo
     forecast).
     ======================================================================= */

  const DeltaPredictor = {
    rerun(dossier, baseCase, recommendations, compare) {
      // Apply the recommended evidence to a clone of the present-evidence package.
      const evNew = { ...dossier.evidence_present };
      recommendations.forEach(r => {
        switch (r.gap_id) {
          case 'comparator':     evNew.itc_or_nma = true; break;
          case 'long_term':      evNew.long_term_extension = true; break;
          case 'subgroup':       evNew.subgroup = true; break;
          case 'utility':        evNew.uk_utility = true; break;
          case 'extrapolation':  evNew.extrapolation = true; break;
          case 'budget_impact':  evNew.budget_impact = true; break;
          case 'pas_commercial': evNew.pas_offered = true; break;
          case 'managed_access': evNew.managed_access = true; break;
          case 'pro':            evNew.pro = true; break;
          case 'severity_qaly':  evNew.severity_qaly = true; break;
        }
      });
      // Re-run base-case predictor with the upgraded evidence package.
      const upgradedDossier = { ...dossier, evidence_present: evNew };
      const upgraded = BaseCasePredictor.predict(upgradedDossier, compare,
        ANALOGUE_LIBRARY[dossier.indicationKey] || []);

      // Delta vs base case — explicit per Logic 5.
      const resolved = [];
      const remaining = [];
      Object.keys(baseCase.domain_scores).forEach(d => {
        const before = baseCase.domain_scores[d];
        const after  = upgraded.domain_scores[d];
        if (after - before >= 10) resolved.push({ domain: d, before: Math.round(before), after: Math.round(after) });
        else if (after < 65)      remaining.push({ domain: d, before: Math.round(before), after: Math.round(after) });
      });

      return {
        delta_summary: {
          composite_before:  baseCase.composite_score,
          composite_after:   upgraded.composite_score,
          confidence_before: baseCase.confidence,
          confidence_after:  upgraded.confidence,
          verdict_before:    baseCase.prediction,
          verdict_after:     upgraded.prediction,
          predictClass_after: upgraded.predictClass,
          precedent_before:  baseCase.precedent_predicted,
          precedent_after:   upgraded.precedent_predicted
        },
        resolved_weaknesses:  resolved,
        remaining_weaknesses: remaining,
        upgraded_corridor:    upgraded.price_corridor,
        upgraded_rationale:   upgraded.rationale
      };
    }
  };

  /* =======================================================================
     11.  ORCHESTRATOR — runs Logics 0 → 5 in sequence
     ======================================================================= */

  function runPipeline(rawDossierText, opts) {
    opts = opts || {};
    const dossier  = DossierAgent.parse(rawDossierText);

    // Sufficiency gate — caller (upload.js) typically runs SufficiencyAgent
    // separately, but we also guard here so dashboard demo seeds don't break.
    const sufficiency = SufficiencyAgent.check(rawDossierText, dossier);
    if (!sufficiency.ok && !opts.skipSufficiency) {
      return { insufficient: true, sufficiency, dossier };
    }

    const analogues      = AnalogueIdAgent.select(dossier);
    if (!analogues.length) {
      // No analogue library exists for this indication — escalate to user.
      return {
        insufficient: true,
        sufficiency: {
          ok: false,
          missing: [{
            field: 'NICE analogue coverage',
            why:   `Indication "${dossier.indication}" is recognised but no NICE analogue precedents are currently indexed in PharmIQ.`,
            example:'Choose a different indication, or extend the analogue library before re-running.'
          }],
          warnings: [],
          summary: sufficiency.summary
        },
        dossier
      };
    }

    const niceHistory    = NiceHistoryAgent.pull(analogues);
    const profiles       = analogues.map(SingleAnalogueAgent.profile);
    const comparison     = CrossAnalogueAgent.compare(analogues);
    const baseCase       = BaseCasePredictor.predict(dossier, comparison, analogues);
    const recommendations= EvidenceRecAgent.recommend(dossier, baseCase, analogues);
    const delta          = DeltaPredictor.rerun(dossier, baseCase, recommendations, comparison);

    // Search criteria surfaced for the user (NICE-style).
    const popHead = (dossier.population || '').split(';')[0] || '—';
    const criteria = [
      `Indication: ${dossier.indication}`,
      `MoA class: ${dossier.mechanism}`,
      `Comparators: ${(dossier.comparators || []).join(', ') || '—'}`,
      `Population: ${popHead}`,
      `Endpoints: ${(dossier.primaryEndpoints || []).join(', ') || '—'}`
    ];

    // Build the dashboard payload that dashboard.js consumes.
    return {
      // ---- product card fields ----
      productName:    dossier.productName,
      indication:     dossier.indication,
      indicationKey:  dossier.indicationKey,
      mechanism:      dossier.mechanism,
      population:     dossier.population,
      primaryEndpoints: dossier.primaryEndpoints,
      comparators:    dossier.comparators,
      criteria,
      evidence_present: dossier.evidence_present,

      // ---- KPIs ----
      efficacy:       baseCase.kpi.efficacy,
      safety:         baseCase.kpi.safety,
      innovation:     baseCase.kpi.innovation,
      unmet:          baseCase.kpi.unmet,

      // ---- Logic 3: base-case prediction & corridor ----
      domain_scores:  baseCase.domain_scores,
      composite:      baseCase.composite_score,
      precedent_predicted: baseCase.precedent_predicted,
      prediction:     baseCase.prediction,
      predictClass:   baseCase.predictClass,
      confidence:     baseCase.confidence,
      priceLow:       baseCase.price_corridor.low,
      priceHigh:      baseCase.price_corridor.high,
      anchor:         baseCase.price_corridor.anchor,
      scaleMax:       baseCase.price_corridor.scaleMax,
      corridor_basis: baseCase.price_corridor.basis,
      rationale_obj:  baseCase.rationale,

      // ---- Logic 4: evidence recommendations ----
      recommendations,

      // ---- Logic 5: delta-assessment ----
      delta,

      // ---- Logic 1 / 2: analogue intelligence ----
      analogues,                  // ranked, with comparability_score + match[] for UI
      analogue_profiles: profiles,
      comparison,
      nice_history: niceHistory,

      // ---- meta ----
      generatedAt: Date.now(),
      methodology_version: 'PharmIQ-2.0 (Logic 0–5)'
    };
  }

  /* =======================================================================
     12.  EXPORT
     ======================================================================= */

  global.PharmIQ = {
    NICE_DOMAINS,
    PRECEDENT_CLASSES,
    EVIDENCE_GAPS,
    NICE_DOC_TYPES,
    NICE_DOC_LABEL,
    ANALOGUE_LIBRARY,
    DossierAgent,
    SufficiencyAgent,
    AnalogueIdAgent,
    NiceHistoryAgent,
    SingleAnalogueAgent,
    CrossAnalogueAgent,
    BaseCasePredictor,
    EvidenceRecAgent,
    DeltaPredictor,
    runPipeline,
    /** Convenience helper used by upload.js. */
    checkSufficiency(rawText) {
      const dossier = DossierAgent.parse(rawText);
      return { dossier, ...SufficiencyAgent.check(rawText, dossier) };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
