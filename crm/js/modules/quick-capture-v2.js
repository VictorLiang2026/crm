import { createApi } from '../core/api.js';

const make = (tag, text = '', cls = '') => {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = cls;
  return el;
};
const lines = text => text.split(/\r?\n/u).map(x => x.trim()).filter(Boolean);

export function openQuickCaptureV2({ callFn }) {
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
  const parse = make('button', '解析为草稿', 'btn btn-ai'); parse.type = 'button';
  const status = make('p', '', 'qcv2-status'); status.setAttribute('role', 'status');
  const preview = make('div', '', 'qcv2-preview');
  box.append(top, notice, raw, parse, status, preview); overlay.append(box);
  document.getElementById('modal-root').append(overlay); raw.focus();

  const setStatus = (text, error = false) => {
    status.textContent = text; status.classList.toggle('qcv2-error', error);
  };
  const call = async (fn, data) => {
    const result = await api.call(fn, data);
    if (!result || result.error) throw new Error(result?.error || '请求失败');
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
      const result = await call('ai_parse', { action: 'quick_capture', version: 2, text });
      render(result.preview, result.today, text);
      setStatus('草稿已生成。请确认身份并逐项检查。');
    } catch (error) { setStatus(`解析失败：${error.message}`, true); }
    finally { parse.disabled = false; }
  };

  function render(draft, today, text) {
    if (!draft?.interaction) throw new Error('草稿格式无效');
    preview.replaceChildren();
    const identity = section('1 · 人物身份', '必须手动选择已有 Person；AI 不会认定身份。本版不自动创建人物。');
    const name = field(identity, '姓名', draft.personName, 160);
    const search = make('button', '查找 Person', 'btn'); search.type = 'button'; identity.append(search);
    const matches = make('div', '', 'qcv2-matches'); identity.append(matches);
    let chosen = null;
    name.oninput = () => { chosen = null; matches.replaceChildren(); };
    search.onclick = async () => {
      chosen = null; matches.replaceChildren();
      if (!name.value.trim()) return setStatus('请先输入姓名。', true);
      search.disabled = true;
      try {
        const result = await call('person_360', { action: 'resolveQuickCaptureName', name: name.value.trim() });
        if (!result.candidates.length) matches.append(make('p', '没有找到现有 Person，请先在 CRM 中建档。', 'qcv2-hint'));
        if (result.hasMore) matches.append(make('p', '仅显示前 10 位；如未找到目标，请增加括号限定后重试。', 'qcv2-hint'));
        for (const candidate of result.candidates) {
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
    const facts = field(section('3 · 事实候选', '每行一条；保存后仍是未确认的 AI Fact Candidate。'),
      '事实', (draft.facts || []).join('\n'), 10000, 'textarea');
    const signals = field(section('4 · 信号候选', '观察线索不等于事实。'),
      '信号', (draft.signals || []).join('\n'), 6000, 'textarea');
    for (const [title, key] of [['5 · 机会候选', 'opportunityCandidates'],
      ['6 · 行动候选', 'actionCandidates'], ['7 · 承诺候选', 'commitmentCandidates']]) {
      field(section(title, '本版仅预览与编辑，不写旧业务表。'), '候选项',
        (draft[key] || []).join('\n'), 6000, 'textarea');
    }
    if (draft.evidence?.length) field(section('原话依据', '核对候选内容的依据。'),
      '依据', draft.evidence.join('\n'), 6000, 'textarea');
    const save = make('button', '确认身份与内容并保存', 'btn btn-primary'); save.type = 'button';
    preview.append(save);
    save.onclick = async () => {
      if (!chosen) return setStatus('请先手动选择已有 Person。', true);
      if (!date.value || !type.value.trim() || !summary.value.trim()) return setStatus('请填写互动方式、日期和摘要。', true);
      if (!window.confirm(`确认保存到 ${chosen.displayName}？机会、行动和承诺不会写入业务表。`)) return;
      save.disabled = true; setStatus('正在保存，请勿重复提交…');
      try {
        const result = await call('person_360', { action: 'commitQuickCaptureV2', data: {
          personId: chosen.id, selectedDisplayName: chosen.displayName, confirmed: true,
          interaction: { type: type.value.trim(), at: `${date.value}T12:00:00+08:00`,
            channel: channel.value.trim(), summary: summary.value.trim(), rawNote: text },
          facts: lines(facts.value), signals: lines(signals.value),
        } });
        preview.replaceChildren(make('p', `已保存互动 #${result.interactionId} 和 ${result.contextItemCount} 条未确认候选项。`, 'qcv2-success'));
        setStatus('保存完成。');
      } catch (error) {
        setStatus(`保存结果未确认：${error.message}。请先到 Person 360 核对，避免重复提交。`, true);
      }
    };
  }
}
