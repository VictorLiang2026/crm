// 人物回收站：已软删人物列表 + 恢复（restorePerson 服务端直接执行，同批级联数据一并还原）。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openSheet } from '../write.js';
import { pageHead, emptyNote, loadInto } from '../ui.js';
import { t } from '../i18n.js';

const PAGE_SIZE = 20;

function fmtTs(v) {
  if (!v) return '-';
  return String(v).slice(0, 16).replace('T', ' ');
}

export function renderPeopleTrash(ctx) {
  const state = { page: 1 };
  const listEl = h('div', {});
  const metaEl = h('span', { class: 'foot-note' }, '');
  const prevBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_prev'));
  const nextBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_next'));
  const pageInfo = h('span', { class: 'pager-info' }, '');

  function openRestore(row) {
    const name = row.display_name || `#${row.id}`;
    const confirmBtn = h('button', { class: 'btn btn-primary', type: 'button' }, t('btn_restore'));
    const sheet = openSheet({
      title: t('restore_person_title'), sub: name,
      body: h('div', {}, [
        h('p', { class: 'sheet-note', style: 'margin:0 0 10px' }, t('restore_person_note')),
        row.batch_scoped ? null : h('p', { class: 'sheet-note', style: 'margin:0 0 10px' }, t('restore_legacy_note')),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
          confirmBtn,
        ]),
      ]),
    });
    document.body.appendChild(sheet.overlay);
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true; confirmBtn.textContent = t('restoring');
      try {
        const res = await data.restorePerson(ctx, row.id);
        if (!res || res.ok === false) throw new Error(t('restore_failed'));
        sheet.overlay.remove();
        ctx.toast(t('person_restored'), 'ok');
        runQuery();
      } catch (err) {
        confirmBtn.disabled = false; confirmBtn.textContent = t('btn_restore');
        sheet.showErr(err.message);
      }
    };
  }

  function runQuery() {
    loadInto(listEl, async () => {
      const res = await data.listPersonTrash(ctx, { page: state.page, pageSize: PAGE_SIZE });
      const rows = res.rows || [];
      pageInfo.textContent = `${res.page}`;
      prevBtn.disabled = res.page <= 1;
      nextBtn.disabled = !res.hasMore;
      metaEl.textContent = '';
      if (!rows.length) {
        return h('div', { class: 'card-body' }, [emptyNote(t('trash_empty'), t('trash_empty_note'))]);
      }
      const thead = h('thead', {}, h('tr', {}, [
        h('th', {}, t('col_name')),
        h('th', {}, t('trash_col_deleted_at')),
        h('th', {}, t('trash_col_customer')),
        h('th', {}, t('trash_col_action')),
      ]));
      const tbody = h('tbody', {}, rows.map((r) => {
        const name = r.display_name || `#${r.id}`;
        const customerCell = r.customer_id
          ? (r.customer_deleted ? `#${r.customer_id}` : t('trash_customer_active').replace('{id}', r.customer_id))
          : '-';
        return h('tr', {}, [
          h('td', {}, h('span', { title: t('deleted_person_open_hint') }, name)),
          h('td', { 'data-label': t('trash_col_deleted_at') }, fmtTs(r.deleted_at)),
          h('td', { 'data-label': t('trash_col_customer') }, customerCell),
          h('td', { 'data-label': t('trash_col_action') }, h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openRestore(r),
          }, [ic('refresh'), t('btn_restore')])),
        ]);
      }));
      return h('div', { class: 'table-scroll' }, h('table', { class: 'people-table' }, [thead, tbody]));
    });
  }

  prevBtn.onclick = () => { if (state.page > 1) { state.page--; runQuery(); } };
  nextBtn.onclick = () => { state.page++; runQuery(); };

  ctx.main.replaceChildren(
    pageHead({
      kicker: t('kicker_people_trash'), title: t('title_people_trash'),
      sub: t('sub_people_trash'),
      actions: [h('a', { class: 'btn btn-ghost', href: '#/people' }, [ic('users'), t('title_people')])],
    }),
    h('section', { class: 'card' }, [
      listEl,
      h('div', { class: 'card-foot' }, [
        metaEl,
        h('div', { class: 'pager', style: 'margin-left:auto' }, [prevBtn, pageInfo, nextBtn]),
      ]),
    ]),
  );
  runQuery();
}
