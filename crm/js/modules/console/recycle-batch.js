import { h } from './dom.js';
import { data } from './data.js';
import { openSheet } from './write.js';
import { t } from './i18n.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DONE = new Set(['RESTORED', 'ALREADY_RESTORED']);
const CODES = new Set(['READY', ...DONE, 'NOT_AVAILABLE', 'FORBIDDEN', 'STALE_SCOPE', 'PARENT_DELETED', 'TOO_LARGE', 'BUSY', 'FAILED']);
const COUNTS = { followups:'trash_count_followups', gifts:'trash_count_gifts', photos:'trash_count_photos',
  policy_review_reports:'trash_count_reports', ocr_records:'trash_count_ocr', products:'trash_count_products',
  recruit_candidates:'trash_count_recruits', recruit_followups:'l07_recruit_followups' };
const keyOf = item => `${item.kind}:${item.id}`;
const identity = item => ({ kind: item.kind, id: Number(item.id) });
function check(value) {
  if (!value || !UUID.test(value.previewId) || !['preview','executed'].includes(value.status) ||
      !Array.isArray(value.items) || !value.items.length || value.items.length > 20 ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      (value.status === 'executed' && (!Array.isArray(value.results) || value.results.length !== value.items.length))) {
    throw new Error(t('trash_invalid_result'));
  }
  for (const row of [...value.items, ...(value.results || [])]) {
    if (!['customer','recruit','person_recruit'].includes(row.kind) || !Number.isSafeInteger(row.id) || row.id < 1 || !CODES.has(row.code)) {
      throw new Error(t('trash_invalid_result'));
    }
  }
  return value;
}

export function createRecycleBatch(ctx, kind, onChanged) {
  const storageKey = `crm_recycle_receipt_${kind}`;
  const selected = new Map();
  const inputs = [];
  let pageItems = [], busy = false;
  const receipt = h('section', { class: 'recycle-batch-receipt', 'aria-live': 'polite' });
  const count = h('span', { class: 'foot-note' });
  const all = h('input', { type:'checkbox', 'aria-label':t('l07_select_page') });
  const preview = h('button', { class:'btn btn-soft', type:'button', 'data-batch-preview':'' }, t('l07_preview'));
  const toolbar = h('div', { class:'recycle-batch-toolbar card-body' }, [
    h('label', { class:'recycle-check' }, [all,t('l07_select_page')]), count, preview,
    h('p', { class:'foot-note' }, t('l07_limit')),
  ]);
  function update() {
    count.textContent = t('l07_selected').replace('{count}',String(selected.size));
    preview.disabled = busy || !selected.size;
    all.disabled = busy || !pageItems.length;
    all.checked = !!pageItems.length && selected.size === pageItems.length;
    all.indeterminate = !!selected.size && selected.size < pageItems.length;
    for (const [input,item] of inputs) { input.checked=selected.has(keyOf(item)); input.disabled=busy; }
  }
  function reset(rows = []) {
    selected.clear(); inputs.length=0;
    pageItems=rows.slice(0,20).map(row=>({kind:kind==='customer'?'customer':row.customer_id==null?'person_recruit':'recruit',
      id:Number(kind==='customer'?row.Id:row.candidate_id)}));
    update();
  }
  function checkbox(row) {
    const item={kind:kind==='customer'?'customer':row.customer_id==null?'person_recruit':'recruit',
      id:Number(kind==='customer'?row.Id:row.candidate_id)};
    const input=h('input',{type:'checkbox','aria-label':`${t('l07_select')} ${row.customer_name||''} #${item.id}`});
    inputs.push([input,item]);
    input.onchange=()=>{ if(input.checked) selected.set(keyOf(item),item); else selected.delete(keyOf(item)); update(); };
    return h('label',{class:'recycle-check'},[input,h('span',{class:'foot-note'},`#${item.id}`)]);
  }
  all.onchange=()=>{ selected.clear(); if(all.checked) for(const item of pageItems) selected.set(keyOf(item),item); update(); };
  function remember(id) { try { sessionStorage.setItem(storageKey,id); } catch { /* optional recovery bookmark */ } }
  function forget() { try { sessionStorage.removeItem(storageKey); } catch { /* optional */ } }
  function rowView(row) {
    const type=t(row.kind==='customer'?'customer_trash_entry':row.kind==='person_recruit'?'trash_person_only':'trash_customer_linked');
    const counts=Object.entries(COUNTS).filter(([key])=>Number(row.counts?.[key])>0)
      .map(([key,label])=>`${t(label)} ${row.counts[key]}`).join(' · ');
    return h('li',{class:'recycle-result-row','data-result-code':row.code},[
      h('b',{},`${row.name||''} #${row.id} · ${type}`),
      h('span',{},t(`l07_code_${row.code}`)),
      row.code==='READY'||row.code==='RESTORED' ? h('small',{},[
        row.batchId ? `${t('l07_batch')} ${row.batchId}` : t('trash_scope_legacy'),
        counts ? ` · ${counts}` : '',
      ]) : null,
    ]);
  }
  function showResult(value) {
    const failed=value.results.filter(row=>!DONE.has(row.code));
    const retry=h('button',{class:'btn btn-soft',type:'button','data-batch-retry':''},t('l07_retry_failed'));
    retry.onclick=()=>review(failed.map(identity),retry);
    receipt.replaceChildren(h('div',{class:'card card-body'},[
      h('b',{},t('l07_result')),h('ul',{class:'recycle-results'},value.results.map(rowView)),
      failed.length?retry:null,
    ]));
    forget();
  }
  function showUncertain(id) {
    const read=h('button',{class:'btn btn-ghost',type:'button','data-batch-read':''},t('l07_read_result'));
    read.onclick=()=>recover(id,read);
    receipt.replaceChildren(h('div',{class:'card card-body'},[h('p',{},t('l07_uncertain')),read]));
  }
  async function recover(id, button) {
    if(busy) return;
    busy=true; if(button) button.disabled=true; update();
    try {
      const value=check(await data.getRecycleBatch(ctx,id));
      if(!toolbar.isConnected)return;
      if(value.status==='executed') {showResult(value);onChanged();}
      else showPreview(value);
    } catch { showUncertain(id); }
    finally {busy=false;if(button)button.disabled=false;update();}
  }
  function showPreview(value) {
    const expired=Date.parse(value.expiresAt)<=Date.now();
    const confirm=h('button',{class:'btn btn-primary',type:'button','data-batch-confirm':'',
      disabled:expired||!value.items.some(row=>row.code==='READY')},t('l07_confirm'));
    const fresh=h('button',{class:'btn btn-soft',type:'button'},t('l07_refresh_preview'));
    const sheet=openSheet({title:t('l07_preview_title'),body:h('div',{},[
      h('p',{class:'sheet-note'},t('l07_preview_note')),
      h('p',{class:'foot-note'},`${t('l07_expires')} ${new Date(value.expiresAt).toLocaleString()}`),
      h('ul',{class:'recycle-results'},value.items.map(rowView)),
      expired?h('p',{class:'sheet-note'},t('l07_expired')):null,
      h('div',{class:'sheet-actions'},[
        h('button',{class:'btn btn-ghost',type:'button',onclick:()=>sheet.overlay.remove()},t('cancel')),
        expired?fresh:confirm,
      ]),
    ])});
    fresh.onclick=()=>{sheet.overlay.remove();review(value.items.map(identity));};
    confirm.onclick=async()=>{
      if(busy||confirm.disabled)return;
      busy=true;confirm.disabled=true;update();remember(value.previewId);
      showUncertain(value.previewId);
      try {
        const result=check(await data.executeRecycleBatch(ctx,value.previewId));
        if(result.status!=='executed')throw new Error(t('trash_invalid_result'));
        if(!toolbar.isConnected){sheet.overlay.remove();return;}
        showResult(result);sheet.overlay.remove();onChanged();
      } catch { sheet.overlay.remove();showUncertain(value.previewId); }
      finally {busy=false;update();}
    };
    document.body.appendChild(sheet.overlay);
  }
  async function review(items,button) {
    if(busy||!items.length)return;
    busy=true;if(button)button.disabled=true;update();
    try {
      const value=check(await data.previewRecycleBatch(ctx,{requestKey:crypto.randomUUID(),items:items.map(identity)}));
      if(!toolbar.isConnected)return;
      if(value.status==='executed')showResult(value);else showPreview(value);
    } catch { ctx.toast(t('l07_preview_failed'),'error'); }
    finally {busy=false;if(button)button.disabled=false;update();}
  }
  preview.onclick=()=>review([...selected.values()]);
  update();
  // A browser bookmark is never authorization to write. Resume reads server status only.
  let pending;try{pending=sessionStorage.getItem(storageKey);}catch{/* optional */}
  if(pending&&UUID.test(pending)) queueMicrotask(()=>recover(pending));
  return {toolbar,receipt,reset,checkbox};
}
