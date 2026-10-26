import { h } from './dom.js';
import { data } from './data.js';
import { loadInto, kvGrid } from './ui.js';
import { t } from './i18n.js';

const STATES = new Set(['signal','stable','insufficient_evidence']);
const number = value => Number.isFinite(value) && value >= 0 ? String(value) : t('l08_unknown');

// Read the existing deterministic service lazily. No new score, model or Action write.
export function personCadence(ctx, personId) {
  const body=h('div',{class:'person-cadence-body'});
  const details=h('details',{class:'person-cadence card card-body'},[
    h('summary',{style:'min-height:44px;cursor:pointer'},t('l08_cadence_title')),body,
  ]);
  let requested=false;
  details.addEventListener('toggle',()=>{
    if(!details.open||requested)return;
    requested=true;
    loadInto(body,async()=>{
      const result=await data.personRelationshipCadence(ctx,personId);
      if(!STATES.has(result.status)||typeof result.why!=='string'||typeof result.recommended_action!=='string') {
        throw new Error(t('l08_cadence_invalid'));
      }
      const evidence=result.evidence||{};
      const confidence=result.status!=='insufficient_evidence'&&Number.isFinite(result.confidence)&&result.confidence>=0&&result.confidence<=1
        ?`${Math.round(result.confidence*100)}%`:t('l08_unknown');
      const metrics=kvGrid([
        [t('l08_cadence_elapsed'),number(evidence.elapsed_days)],
        [t('l08_cadence_interval'),number(evidence.cadence_days)],
        [t('l08_cadence_observation'),number(evidence.observation_days)],
        [t('l08_cadence_count'),number(evidence.interaction_count)],
      ]);
      metrics.style.gridTemplateColumns='minmax(0, 45%) minmax(0, 1fr)';
      return h('div',{class:'tab-stack'},[
        h('b',{},t('l08_cadence_'+result.status)),
        h('p',{class:'foot-note'},t('l08_cadence_readonly')),
        result.testData?.containsTestData===true?h('p',{class:'sheet-note'},t('pc30_test_data')):null,
        result.testData?.status!=='verified'?h('p',{class:'foot-note'},t('pc18_test_data_unverified')):null,
        result.status==='insufficient_evidence'?h('p',{},t('l08_cadence_insufficient_note')):metrics,
        h('p',{class:'foot-note'},`${t('l08_cadence_confidence')}: ${confidence}`),
        evidence.importance_source==='sales_priority_proxy'?h('p',{class:'sheet-note'},t('l08_cadence_proxy')):null,
        h('details',{},[h('summary',{},t('l08_cadence_source')),
          h('p',{},result.why),h('p',{},result.recommended_action)]),
      ]);
    });
  });
  return details;
}
