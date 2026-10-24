// Person 360 的礼品与附件入口：数据仍按 customer_id 归档；文件内容只在用户请求时读取。
import { h } from './dom.js';
import { data } from './data.js';
import { openSheet } from './write.js';
import { sectionTitle, fmtDate, emptyNote } from './ui.js';
import { t } from './i18n.js';

const PAGE_SIZE = 30;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function actionError(result, fallback) {
  if (result && result.ok === false) throw new Error(t('care_scope_mismatch'));
  if (!result || result.error) throw new Error(result?.error || fallback);
  return result;
}

function inputField(label, attrs, value = '') {
  const field = h(attrs.tag || 'input', {
    class: attrs.tag === 'textarea' ? 'sheet-textarea' : 'sheet-input',
    type: attrs.type || undefined,
    name: attrs.name,
    value: value == null ? '' : String(value),
    rows: attrs.rows,
    required: attrs.required || undefined,
    min: attrs.min,
    step: attrs.step,
    placeholder: attrs.placeholder,
  });
  return { field, row: h('div', { class: 'sheet-field' }, [h('label', {}, label), field]) };
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('care_file_read_failed')));
    reader.onload = () => {
      const value = String(reader.result || '');
      const comma = value.indexOf(',');
      if (comma < 0) reject(new Error(t('care_file_read_failed')));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function careMaterialsNode(ctx, personId, { onDone } = {}) {
  const profile = await data.customerProfile(ctx, personId);
  if (profile.status !== 'linked' || !profile.customerId) {
    return h('div', { class: 'tab-stack care-materials' }, [
      sectionTitle(t('care_materials_title')),
      emptyNote(t('care_customer_required'), t('care_customer_required_note')),
    ]);
  }

  const customerId = Number(profile.customerId);
  const root = h('div', { class: 'tab-stack care-materials', 'data-customer-id': String(customerId) });
  const giftList = h('div', { class: 'care-materials-list' });
  const photoList = h('div', { class: 'care-materials-list' });
  const giftStatus = h('p', { class: 'care-status', role: 'status' });
  const photoStatus = h('p', { class: 'care-status', role: 'status' });
  const giftMore = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'display:none' }, t('care_load_more'));
  const photoMore = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'display:none' }, t('care_load_more'));
  const giftAdd = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('care_add_gift'));
  const photoInput = h('input', { type: 'file', multiple: true, class: 'care-file-input' });
  const photoAdd = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('care_add_file'));
  photoInput.style.display = 'none';

  let giftOffset = 0;
  let photoOffset = 0;
  let photoFilter = 'all';
  let uploading = false;
  const gifts = new Map();
  const photos = new Map();

  function submitButton(label, handler) {
    const button = h('button', { class: 'btn btn-primary', type: 'button' }, label);
    button.addEventListener('click', handler);
    return button;
  }

  function openGiftForm(row) {
    const name = inputField(t('care_gift_name'), { name: 'gift_name', required: true }, row?.gift_name);
    const quantity = inputField(t('care_gift_quantity'), { name: 'quantity', type: 'number', min: '1', step: '1' }, row?.quantity);
    const date = inputField(t('care_given_date'), { name: 'given_date', type: 'date' }, String(row?.given_date || '').slice(0, 10));
    const notes = inputField(t('care_notes'), { name: 'notes', tag: 'textarea', rows: '3' }, row?.notes);
    const save = submitButton(t('care_save'), async () => {
      if (save.disabled) return;
      const giftName = name.field.value.trim();
      const quantityValue = quantity.field.value.trim();
      if (!giftName || (quantityValue && (!Number.isInteger(Number(quantityValue)) || Number(quantityValue) < 1))) {
        sheet.showErr(t('care_gift_invalid'));
        return;
      }
      save.disabled = true;
      save.textContent = t('care_saving');
      try {
        const payload = {
          gift_name: giftName,
          quantity: quantityValue ? Number(quantityValue) : null,
          given_date: date.field.value || null,
          notes: notes.field.value.trim() || null,
        };
        if (row) actionError(await data.updateGift(ctx, row.Id, customerId, payload), t('care_save_failed'));
        else actionError(await data.createGift(ctx, { ...payload, customer_id: customerId }), t('care_save_failed'));
        sheet.overlay.remove();
        ctx.toast(t(row ? 'care_gift_saved' : 'care_gift_added'), 'ok');
        await refreshGifts(true);
      } catch (error) {
        save.disabled = false;
        save.textContent = t('care_save');
        sheet.showErr(error.message || t('care_save_failed'));
      }
    });
    const sheet = openSheet({
      title: t(row ? 'care_edit_gift' : 'care_add_gift'),
      sub: t('care_gift_contract_note'),
      body: h('div', { class: 'care-form' }, [name.row, quantity.row, date.row, notes.row,
        h('div', { class: 'sheet-actions' }, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')), save])]),
    });
    document.body.appendChild(sheet.overlay);
  }

  async function deleteGift(row, button) {
    if (button.disabled) return;
    if (!window.confirm(t('care_delete_gift_confirm'))) return;
    button.disabled = true;
    try {
      actionError(await data.removeGift(ctx, row.Id, customerId), t('care_delete_failed'));
      ctx.toast(t('care_gift_deleted'), 'ok');
      await refreshGifts(true);
    } catch (error) {
      button.disabled = false;
      ctx.toast(error.message || t('care_delete_failed'), 'err');
    }
  }

  function renderGift(row) {
    const item = h('article', { class: 'care-record' }, [
      h('div', { class: 'care-record-main' }, [
        h('strong', { class: 'care-record-title' }, row.gift_name || t('care_gift_unnamed')),
        row.quantity != null ? h('span', { class: 'care-record-quantity' }, `×${row.quantity}`) : null,
      ]),
      h('div', { class: 'care-record-meta' }, `${t('care_given_date')}: ${row.given_date ? fmtDate(row.given_date) : t('no_date')}`),
      row.notes ? h('p', { class: 'care-record-notes' }, row.notes) : null,
      h('div', { class: 'care-record-actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openGiftForm(row) }, t('btn_edit')),
        h('button', { class: 'btn btn-ghost btn-sm care-delete', type: 'button', onclick: (event) => deleteGift(row, event.currentTarget) }, t('btn_delete')),
      ]),
    ]);
    return item;
  }

  function renderPhoto(row) {
    const category = row.category === 'attachment' ? 'attachment' : 'photo';
    const item = h('article', { class: 'care-record care-file-record', 'data-photo-id': String(row.id) }, [
      h('div', { class: 'care-record-main' }, [
        h('strong', { class: 'care-record-title', title: row.file_name || '' }, row.file_name || t('care_file_unnamed')),
        h('span', { class: 'care-category' }, t(category === 'photo' ? 'care_category_photo' : 'care_category_attachment')),
      ]),
      h('div', { class: 'care-record-meta' }, `${row.content_type || 'application/octet-stream'} · ${fmtDate(row.created_at)} · ${t('care_sort_order')} ${row.sort_order ?? 0}`),
      row.photo_notes ? h('p', { class: 'care-record-notes' }, row.photo_notes) : null,
      h('div', { class: 'care-record-actions' }, [
        h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: (event) => getFile(row, event.currentTarget) }, t(category === 'photo' ? 'care_preview' : 'care_download')),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openPhotoNotes(row) }, t('care_edit_notes')),
        h('button', { class: 'btn btn-ghost btn-sm care-delete', type: 'button', onclick: (event) => deletePhoto(row, event.currentTarget) }, t('btn_delete')),
      ]),
    ]);
    return item;
  }

  async function getFile(row, button) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = actionError(await data.getPhoto(ctx, row.id, customerId), t('care_file_missing'));
      const photo = result.photo;
      if (!photo?.photo_url) throw new Error(t('care_file_missing'));
      const isImage = (photo.category || row.category) === 'photo' && /^image\//i.test(photo.content_type || '');
      if (isImage) {
        const preview = openSheet({
          title: photo.file_name || t('care_preview'),
          sub: photo.photo_notes || '',
          body: h('div', { class: 'care-preview' }, [h('img', { src: photo.photo_url, alt: photo.file_name || t('care_category_photo') })]),
        });
        document.body.appendChild(preview.overlay);
      } else {
        const link = document.createElement('a');
        link.href = photo.photo_url;
        link.download = photo.file_name || 'attachment';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (error) {
      ctx.toast(error.message || t('care_file_missing'), 'err');
    } finally { button.disabled = false; }
  }

  function openPhotoNotes(row) {
    const notes = inputField(t('care_notes'), { name: 'photo_notes', tag: 'textarea', rows: '4' }, row.photo_notes);
    const save = submitButton(t('care_save'), async () => {
      if (save.disabled) return;
      save.disabled = true;
      try {
        actionError(await data.updatePhoto(ctx, row.id, customerId, { photo_notes: notes.field.value.trim() || null }), t('care_save_failed'));
        sheet.overlay.remove();
        ctx.toast(t('care_notes_saved'), 'ok');
        await refreshPhotos(true);
      } catch (error) {
        save.disabled = false;
        sheet.showErr(error.message || t('care_save_failed'));
      }
    });
    const sheet = openSheet({
      title: t('care_edit_notes'), sub: row.file_name || '',
      body: h('div', { class: 'care-form' }, [notes.row,
        h('div', { class: 'sheet-actions' }, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')), save])]),
    });
    document.body.appendChild(sheet.overlay);
  }

  async function deletePhoto(row, button) {
    if (button.disabled) return;
    if (!window.confirm(t('care_delete_photo_confirm'))) return;
    button.disabled = true;
    try {
      actionError(await data.removePhoto(ctx, row.id, customerId), t('care_delete_failed'));
      ctx.toast(t('care_file_deleted'), 'ok');
      await refreshPhotos(true);
    } catch (error) {
      button.disabled = false;
      ctx.toast(error.message || t('care_delete_failed'), 'err');
    }
  }

  function renderPhotoRows() {
    const rows = [...photos.values()].filter((row) => photoFilter === 'all' || row.category === photoFilter);
    photoList.replaceChildren(...(rows.length ? rows.map(renderPhoto) : [emptyNote(t('care_no_files'), '')]));
  }

  async function refreshGifts(reset) {
    if (reset) { gifts.clear(); giftOffset = 0; }
    giftStatus.textContent = t('loading');
    try {
      const res = actionError(await data.gifts(ctx, customerId, { limit: PAGE_SIZE, offset: giftOffset }), t('care_load_failed'));
      (res.rows || []).forEach((row) => gifts.set(String(row.Id), row));
      giftOffset = gifts.size;
      giftList.replaceChildren(...(gifts.size ? [...gifts.values()].map(renderGift) : [emptyNote(t('care_no_gifts'), '')]));
      giftMore.style.display = res.hasMore ? '' : 'none';
      giftStatus.textContent = '';
    } catch (error) { giftStatus.textContent = error.message || t('care_load_failed'); }
  }

  async function refreshPhotos(reset) {
    if (reset) { photos.clear(); photoOffset = 0; }
    photoStatus.textContent = t('loading');
    try {
      const res = actionError(await data.photos(ctx, customerId, { limit: PAGE_SIZE, offset: photoOffset }), t('care_load_failed'));
      (res.rows || []).forEach((row) => photos.set(String(row.id), row));
      photoOffset = photos.size;
      renderPhotoRows();
      photoMore.style.display = res.hasMore ? '' : 'none';
      photoStatus.textContent = '';
    } catch (error) { photoStatus.textContent = error.message || t('care_load_failed'); }
  }

  giftMore.addEventListener('click', async () => {
    giftMore.disabled = true;
    try {
      const res = actionError(await data.gifts(ctx, customerId, { limit: PAGE_SIZE, offset: giftOffset }), t('care_load_failed'));
      (res.rows || []).forEach((row) => gifts.set(String(row.Id), row));
      giftOffset = gifts.size;
      giftList.replaceChildren(...[...gifts.values()].map(renderGift));
      giftMore.style.display = res.hasMore ? '' : 'none';
    } catch (error) { giftStatus.textContent = error.message || t('care_load_failed'); }
    finally { giftMore.disabled = false; }
  });
  photoMore.addEventListener('click', async () => {
    photoMore.disabled = true;
    try {
      const res = actionError(await data.photos(ctx, customerId, { limit: PAGE_SIZE, offset: photoOffset }), t('care_load_failed'));
      (res.rows || []).forEach((row) => photos.set(String(row.id), row));
      photoOffset = photos.size;
      renderPhotoRows();
      photoMore.style.display = res.hasMore ? '' : 'none';
    } catch (error) { photoStatus.textContent = error.message || t('care_load_failed'); }
    finally { photoMore.disabled = false; }
  });

  giftAdd.addEventListener('click', () => openGiftForm(null));
  photoAdd.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', async () => {
    if (uploading) return;
    const files = Array.from(photoInput.files || []);
    if (!files.length) return;
    const invalid = files.filter((file) => !file.name || file.size <= 0 || file.size > MAX_FILE_BYTES);
    const valid = files.filter((file) => file.name && file.size > 0 && file.size <= MAX_FILE_BYTES);
    if (invalid.length) photoStatus.textContent = t('care_invalid_files').replace('{count}', String(invalid.length));
    if (!valid.length) { photoInput.value = ''; return; }
    uploading = true;
    photoAdd.disabled = true;
    photoAdd.textContent = t('care_uploading');
    let saved = 0;
    const failed = [];
    try {
      for (const file of valid) {
        try {
          const contentType = file.type || 'application/octet-stream';
          const result = actionError(await data.createPhoto(ctx, {
            customer_id: customerId,
            image_base64: await readBase64(file),
            file_name: file.name,
            content_type: contentType,
            category: contentType.startsWith('image/') ? 'photo' : 'attachment',
          }), t('care_upload_failed'));
          if (!result.id) throw new Error(t('care_upload_failed'));
          saved++;
        } catch (error) { failed.push(`${file.name}: ${error.message || t('care_upload_failed')}`); }
      }
      if (saved) {
        ctx.toast(t('care_upload_complete').replace('{count}', String(saved)), 'ok');
        await refreshPhotos(true);
      }
      if (failed.length) photoStatus.textContent = failed.join(' · ').slice(0, 400);
      else if (!invalid.length) photoStatus.textContent = '';
    } finally {
      uploading = false;
      photoAdd.disabled = false;
      photoAdd.textContent = t('care_add_file');
      photoInput.value = '';
    }
  });

  const filters = h('div', { class: 'care-filters' }, ['all', 'photo', 'attachment'].map((value) => {
    const button = h('button', {
      class: `btn btn-sm ${photoFilter === value ? 'btn-primary' : 'btn-ghost'}`,
      type: 'button',
      onclick: (event) => {
        photoFilter = value;
        filters.querySelectorAll('button').forEach((item) => item.classList.toggle('btn-primary', item === event.currentTarget));
        filters.querySelectorAll('button').forEach((item) => item.classList.toggle('btn-ghost', item !== event.currentTarget));
        renderPhotoRows();
      },
    }, t(`care_filter_${value}`));
    return button;
  }));

  root.append(
    h('div', { class: 'more-actions care-workspace-links' }, [
      h('a', { class: 'btn btn-ghost btn-sm', href: `#/person/${personId}/insurance` }, t('tab_insurance')),
      h('a', { class: 'btn btn-ghost btn-sm', href: `#/person/${personId}/ocr` }, t('tab_ocr_review')),
    ]),
    h('p', { class: 'foot-note' }, t('care_review_workflow_note')),
    h('a', { class: 'btn btn-soft', href: `#/person/${personId}/ocr` }, t('file_import_entry')),
    h('div', { class: 'care-materials-grid' }, [
      h('section', { class: 'care-materials-section' }, [
        h('div', { class: 'care-section-head' }, [sectionTitle(t('care_gifts_title')), giftAdd]),
        h('p', { class: 'care-section-note' }, t('care_gifts_note')),
        giftStatus, giftList, giftMore,
      ]),
      h('section', { class: 'care-materials-section' }, [
        h('div', { class: 'care-section-head' }, [sectionTitle(t('care_files_title')), photoAdd]),
        h('p', { class: 'care-section-note' }, t('care_files_note')),
        h('p', { class: 'care-status' }, [t('care_upload_limit')]),
        photoInput, filters, photoStatus, photoList, photoMore,
      ]),
    ]),
  );
  await Promise.all([refreshGifts(true), refreshPhotos(true)]);
  return root;
}
