import { createApi } from '../core/api.js';

const make = (tag, text = '', cls = '') => {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = cls;
  return el;
};
const MARKER = '【系统测试·勿联系】';

export function openQuickCaptureV2({ callFn, scenario }) {
  const api = createApi(callFn);
  if (!document.getElementById('qcv2-style')) {
    const link = make('link'); link.id = 'qcv2-style'; link.rel = 'stylesheet';
    link.href = '/crm/css/quick-capture-v2.css'; document.head.append(link);
  }
  const overlay = make('div', '', 'modal-overlay');
  const box = make('div', '', 'modal qcv2-modal');
  const title = make('h3', '快速记录 V2 · 人工确认');
  const close = make('button', '关闭', 'btn'); close.type = 'button';
  close.onclick = () => overlay.remove();
  const top = make('div', '', 'qcv2-row'); top.append(title, close);
  const notice = make('p', '先确认人物身份，再编辑草稿。保存后事实与信号仍待独立核验。', 'qcv2-hint');
  const raw = make('textarea'); raw.maxLength = 10000; raw.placeholder = '输入刚发生的沟通、观察或约定';
  const preset = make('button', '使用预填测试场景', 'btn'); preset.type = 'button';
  preset.onclick = () => { raw.value = `${MARKER}虚构体验甲参加了虚构活动。我们讨论了下周整理活动反馈，约定双方周五核对材料。我需要记录行动：整理反馈。`; raw.focus(); };
  const parse = make('button', '解析为草稿', 'btn btn-ai'); parse.type = 'button';
  const status = make('p', '', 'qcv2-status'); status.setAttribute('role', 'status');
  const preview = make('div', '', 'qcv2-preview');
  box.append(top, notice, preset, raw, parse, status, preview); overlay.append(box);
  document.getElementById('modal-root').append(overlay); raw.focus();

  const setStatus = (text, error = false) => {
    status.textContent = text; status.classList.toggle('qcv2-error', error);
  };
  const call = async (fn, data) => {
    const result = await api.call(fn, data);
    if (!result || result.ok === false || result.error) {
      const code = result?.error?.code || result?.error || '请求失败';
      const task = result?.error?.auditTaskId;
      throw new Error(task ? `${code}（AI task #${task}，请勿重复解析）` : code);
    }
    return result;
  };
  const section = (title, hint) => {
    const el = make('section', '', 'qcv2-section');
    el.append(make('h4', title), make('p', hint, 'qcv2-hint'));
    preview.append(el); return el;
  };
  const field = (parent, label, value, max, tag = 'input') => {
    const wrap = make('label', '', 'qcv2-field');
    const control = make(tag); control.value = value || ''; control.maxLength = max;
    wrap.append(make('span', label), control); parent.append(wrap); return control;
  };
  parse.onclick = async () => {
    const text = raw.value.trim();
    if (!text) return setStatus('请先输入原话。', true);
    parse.disabled = true; preview.replaceChildren(); setStatus('正在生成候选项…');
    try {
      const result = await call('assistant', { action: 'quickCaptureV2', stage: 'parse', text });
      render(result.preview, result.today, text, result.aiTaskId, result.aiResultId);
      setStatus('草稿已生成。请确认身份并逐项检查。');
    } catch (error) { setStatus(`解析失败：${error.message}`, true); }
    finally { parse.disabled = false; }
  };

  function render(draft, today, text, aiTaskId, aiResultId) {
    if (!draft?.interaction) throw new Error('草稿格式无效');
    preview.replaceChildren();
    const identity = section('1 · 人物身份', '必须手动选择已有 Person；AI 不会认定身份。本版不自动创建人物。');
    const name = field(identity, '姓名', scenario?.targets?.personId ? `${MARKER}虚构体验甲` : draft.personName, 160);
    const search = make('button', '查找 Person', 'btn'); search.type = 'button'; identity.append(search);
    const matches = make('div', '', 'qcv2-matches'); identity.append(matches);
    let chosen = null;
    name.oninput = () => { chosen = null; matches.replaceChildren(); };
    search.onclick = async () => {
      chosen = null; matches.replaceChildren();
      if (!name.value.trim()) return setStatus('请先输入姓名。', true);
      search.disabled = true;
      try {
        const result = await call('assistant', { action:'quickCaptureV2', stage:'resolve', name:name.value.trim() });
        if (!result.resolution.candidates.length) matches.append(make('p', '没有找到现有 Person。', 'qcv2-hint'));
        if (result.resolution.hasMore) matches.append(make('p', '仅显示前 10 位；请增加括号限定后重试。', 'qcv2-hint'));
        if (result.resolution.candidates.length > 1) matches.append(make('p', '同名冲突：必须人工选择正确的 Person。', 'qcv2-hint'));
        for (const candidate of result.resolution.candidates) {
          const label = make('label', '', 'qcv2-match');
          const radio = make('input'); radio.type = 'radio'; radio.name = 'qcv2-person';
          radio.onchange = () => { chosen = candidate; };
          label.append(radio, make('span', `${candidate.displayName}${candidate.organization ? ` · ${candidate.organization}` : ''} (#${candidate.id})`));
          matches.append(label);
        }
      } catch (error) { setStatus(`身份查找失败：${error.message}`, true); }
      finally { search.disabled = false; }
    };
    const interaction = section('2 · 互动候选', '请检查方式、日期、渠道和摘要。');
    const type = field(interaction, '方式', draft.interaction.type, 64);
    const date = field(interaction, '日期', draft.interaction.date || today, 10); date.type = 'date';
    const channel = field(interaction, '渠道', draft.interaction.channel, 100);
    const summary = field(interaction, '摘要', draft.interaction.summary, 2000, 'textarea');
    const candidates = (title, hint, values, { writable = true, commitment = false } = {}) => {
      const panel = section(title, hint), entries = [];
      for (const value of values || []) {
        const row = make('div', '', 'qcv2-candidate');
        const choose = make('input'); choose.type = 'checkbox'; choose.checked = false;
        choose.disabled = !writable;
        const edit = make('textarea'); edit.value = value; edit.maxLength = commitment ? 4000 : 500;
        edit.readOnly = !writable;
        row.append(choose, edit);
        let kind;
        if (commitment) {
          kind = make('select');
          for (const [key, label] of [['', '请选择承诺方'], ['I_PROMISED', '我承诺'],
            ['THEY_PROMISED', '对方承诺'], ['MUTUAL', '双方约定']]) {
            const option = make('option', label); option.value = key; kind.append(option);
          }
          row.append(kind);
        }
        panel.append(row); entries.push({ choose, edit, kind });
      }
      if (!entries.length) panel.append(make('p', '未提取候选项。', 'qcv2-hint'));
      return () => entries.filter(x => x.choose.checked && x.edit.value.trim()).map(x => ({
        text: x.edit.value.trim(), type: x.kind?.value,
      }));
    };
    const facts = candidates('3 · 事实候选', '逐条勾选与编辑；写入后仍为未确认的 AI Fact Candidate。', draft.facts);
    const signals = candidates('4 · 信号候选', '观察线索不等于事实。', draft.signals);
    candidates('5 · 机会候选', '仅供人工查看；本工作包不写入机会。',
      draft.opportunityCandidates, { writable: false });
    const actions = candidates('6 · 行动候选', '勾选的行动会在最终确认后写入。', draft.actionCandidates);
    const commitments = candidates('7 · 承诺候选', '勾选后必须选择承诺方；最终确认后写入。',
      draft.commitmentCandidates, { commitment: true });
    if (draft.evidence?.length) field(section('原话依据', '核对候选内容的依据。'),
      '依据', draft.evidence.join('\n'), 6000, 'textarea');
    const save = make('button', '生成服务端预览', 'btn btn-primary'); save.type = 'button';
    preview.append(save);
    save.onclick = async () => {
      if (!chosen) return setStatus('请先手动选择已有 Person。', true);
      if (raw.value.trim() !== text) return setStatus('原话已变更，请重新解析后预览。', true);
      if (!date.value || !type.value.trim() || !summary.value.trim()) return setStatus('请填写互动方式、日期和摘要。', true);
      const factItems = facts(), signalItems = signals(), actionItems = actions(), commitmentItems = commitments();
      if (commitmentItems.some(x => !x.type)) return setStatus('请为每条选中的承诺选择承诺方。', true);
      save.disabled = true; setStatus('正在核实人物及生成服务端预览…');
      try {
        const planned = await call('assistant', { action:'quickCaptureV2', stage:'plan',
          personId:chosen.id, selectedDisplayName:chosen.displayName, aiTaskId, aiResultId,
          draft:{interaction:{type:type.value.trim(),at:`${date.value}T12:00:00+08:00`,
            channel:channel.value.trim(),summary:summary.value.trim(),rawNote:text},
            facts:factItems.map(x=>x.text), signals:signalItems.map(x=>x.text),
            actions:actionItems.map(x=>({title:x.text,description:'',dueAt:null,priority:'medium'})),
            commitments:commitmentItems.map(x=>({type:x.type,content:x.text,dueAt:null}))} });
        const receipt = await call('assistant', {action:'quickCaptureV2',stage:'preview',commandId:planned.commandId});
        for (const control of preview.querySelectorAll('input,textarea,select,button')) control.disabled = true;
        const review = make('section', '', 'qcv2-section');
        review.append(make('h4', '服务端预览 · 含测试数据'),
          make('p', `Person #${receipt.preview.personId} · ${receipt.preview.displayName}`),
          make('p', `互动 1 条；未确认事实/信号 ${receipt.preview.facts.length + receipt.preview.signals.length} 条；行动 ${receipt.preview.actions.length} 条；承诺 ${receipt.preview.commitments.length} 条。`),
          make('p', `有效期至 ${receipt.expiresAt}。未确认前不写入业务表。`, 'qcv2-hint'));
        const detail = make('pre', JSON.stringify(receipt.preview, null, 2), 'qcv2-json'); review.append(detail);
        const confirm = make('button', '确认以上内容并写入', 'btn btn-primary'); confirm.type='button';
        review.append(confirm); preview.append(review);
        confirm.onclick = async () => {
          confirm.disabled = true; setStatus('正在确认并写入…');
          try {
            await call('assistant', {action:'quickCaptureV2',stage:'confirm',
              commandId:receipt.commandId,previewHash:receipt.previewHash});
            const result = await call('assistant', {action:'quickCaptureV2',stage:'execute',
              commandId:receipt.commandId});
            preview.replaceChildren(make('p', `已保存互动 #${result.resultIds.interactionId}；行动 ${result.resultIds.actionIds.length} 条；承诺 ${result.resultIds.commitmentIds.length} 条。含测试数据。`, 'qcv2-success'));
            setStatus('保存完成。衍生记录和 AI 审计 ID 已登记。');
          } catch (error) {
            setStatus(`结果待核对：${error.message}。请在原预览上重试，不要新建草稿。`, true);
            confirm.textContent = '重试同一预览'; confirm.disabled = false;
          }
        };
        setStatus('服务端预览完成，请逐项核对后确认。');
      } catch (error) {
        save.disabled = false;
        setStatus(`预览失败：${error.message}`, true);
      }
    };
  }
}
