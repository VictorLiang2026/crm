import { h } from './dom.js';
import { t, translateEnum } from './i18n.js';
import { data } from './data.js';
import { openSheet } from './write.js';

export const FLOW_STAGES = {
  protection: ['需求线索','需求已核实','保障分析','方案沟通','等待决定','已成交','暂缓','未达成'],
  recruitment: ['关系建立','兴趣了解','双向评估','职业沟通','决策跟进','已加入','继续培养','暂不推进'],
};
export const protectionTypes = ['insurance','医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障'];
export function stageLabel(track,value) {
  return FLOW_STAGES[track]?.includes(value) ? t('pipeline_stage_'+value)
    : translateEnum(track==='recruitment'?'recruit_stage':'opportunity_stage',value) || value || '—';
}

export function openPipelineStage(ctx,target,onDone) {
  const sheet=openSheet({title:t('pipeline_change'),body:h('p',{},t('loading'))});
  document.body.append(sheet.overlay);
  const label=(key,input)=>h('label',{class:'sheet-field'},[t(key),input]);
  const info=(key,value)=>h('p',{},[h('b',{},t(key)+' '),value]);
  const report=error=>sheet.showErr(error.message==='PIPELINE_REVIEW_AGAIN' ? t('pipeline_review_again')
    : error.message==='PIPELINE_TARGET_UNAVAILABLE' ? t('pipeline_unavailable') : error.message);
  async function load() {
    try {
      const state=await data.pipelineState(ctx,target);
      const stages=FLOW_STAGES[target.track];
      const stage=h('select',{class:'sheet-select'},[h('option',{value:''},'—'),
        ...stages.map(value=>h('option',{value},stageLabel(target.track,value)))]);
      stage.value=stages.includes(state.stage)?state.stage:'';
      const source=h('select',{class:'sheet-select'},[h('option',{value:''},'—'),
        h('option',{value:'referral'},t('pipeline_referral_source'))]);
      source.value=state.source || '';
      const reason=h('textarea',{class:'sheet-textarea',maxlength:4000});
      const preview=h('button',{class:'btn btn-primary',type:'button'},t('pipeline_preview'));
      const form=h('div',{},[info('pipeline_current',stageLabel(target.track,state.stage)),
        state.confirmedAt ? info('pipeline_confirmed_at',String(state.confirmedAt).slice(0,10)) : null,
        state.reason ? info('pipeline_reason',state.reason) : null,
        label('pipeline_stage',stage),label('pipeline_source',source),label('pipeline_reason',reason),
        target.track==='recruitment' ? h('p',{class:'sheet-note'},t('pipeline_milestone_note')) : null,preview]);
      preview.onclick=async()=>{
        if(!stage.value || (stages.slice(-3).includes(stage.value)&&!reason.value.trim())) {
          sheet.showErr(t('pipeline_required'));return;
        }
        preview.disabled=true;
        try {
          const response=await data.previewPipelineStage(ctx,{...target,requestId:crypto.randomUUID(),
            stage:stage.value,source:source.value,reason:reason.value.trim()});
          const p=response.preview;
          const confirm=h('button',{class:'btn btn-primary',type:'button'},t('confirm_execute'));
          confirm.onclick=async()=>{
            confirm.disabled=true;
            try {
              await data.confirmPipelineStage(ctx,response.previewId);
              sheet.overlay.remove();ctx.toast(t('pipeline_saved'),'ok');onDone?.();
            } catch(e){report(e);confirm.disabled=false;}
          };
          sheet.swap(h('div',{class:'sheet-preview'},[
            info('person',p.personName+' #'+p.personId),info('pipeline_record',t('pipeline_'+p.track)+' #'+p.recordId),
            info('pipeline_current',stageLabel(p.track,p.before)),info('pipeline_stage',stageLabel(p.track,p.stage)),
            info('pipeline_source',p.source==='referral'?t('pipeline_referral_source'):'—'),
            info('pipeline_reason',p.reason || '—'),
            p.track==='recruitment'?h('p',{class:'sheet-note'},t('pipeline_milestone_note')):null,
            h('div',{class:'sheet-actions'},[h('button',{class:'btn btn-ghost',type:'button',onclick:()=>sheet.swap(form)},t('back_to_edit')),confirm]),
          ]));
        } catch(e){report(e);}
        finally {preview.disabled=false;}
      };
      sheet.swap(form);
    } catch(e){
      sheet.swap(h('button',{class:'btn btn-soft',type:'button',onclick:load},t('btn_retry_ai')));
      report(e);
    }
  }
  load();
}
