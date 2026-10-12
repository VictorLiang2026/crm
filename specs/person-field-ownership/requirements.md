# 人物资料归属与 console 人物目录

## Problem

身份资料和共享关系属性分散在客户、招募候选人和嘉宾记录中，导致不同角色下的录入和展示口径不一致。人物目录还缺少三类优先级、转角色入口和可组合的回收站筛选。

## User stories

- 作为 CRM 使用者，我希望人物级资料只维护一份，并在客户、招募、嘉宾等角色中复用。
- 作为 CRM 使用者，我希望招募优先级跟随招募记录，客户与转介绍优先级及人物关系属性跟随人物。
- 作为 CRM 使用者，我希望在人物目录快速查看优先级和跟进日期，并将人物转为客户或招募对象。
- 作为 CRM 使用者，我希望按人物角色及相应优先级筛选回收站记录。

## Acceptance criteria

1. When a customer is created or edited, the system shall persist person-wide attributes to public.persons and customer-only attributes to public.customers.
2. When a recruit candidate is created or edited, the system shall persist recruitment priority to public.recruit_candidates.
3. When a speaker profile is read or edited, the system shall use public.persons for contact, organization, source, and other shared person attributes; the speaker record shall retain only speaker/activity data and its permitted name field.
4. During migration, the system shall backfill person attributes before removing duplicate customer and speaker columns; conflicts shall preserve the current Person value.
5. During migration, the system shall carry all 572 populated customer recruitment-priority values to existing candidate rows or new candidate rows; the 558 missing candidates shall be created as active candidates with the existing default stage and an audit milestone.
6. When the Person directory loads, it shall show customer, recruit, and referral priority; latest and next follow-up dates; and customer/recruit conversion actions. Priority and follow-up date columns shall be sortable. The generic priority and customer-stage columns shall be absent.
7. When the Person recycle bin is used, the system shall allow multi-select role filters and show priority filters only for selected roles that have a priority. Search shall apply the selected criteria together and preserve server-side pagination.
8. When a role form shows shared Person context, it shall show only a compact relevant summary and link to the Person editor; it shall not introduce duplicate editing controls for Person fields.
9. New/changed console labels shall use crm/js/modules/console/i18n.js and support Simplified Chinese and English.
10. All database SQL shall explicitly use public; every database migration shall include a paired rollback; existing delete/restore and identity-resolution semantics shall remain intact.

## Scope

- persons, customers, recruit_candidates, and activity_speakers field ownership and data migration.
- Dependent public views and directory/trash read functions.
- Existing customer/recruit/speaker forms, Person editor, console Person directory and Person recycle bin.
- Regression for affected customer, recruit, speaker, Person, and recycle-bin flows, plus shared release gates.

## Non-goals

- No changes to pr schema or pr_* functions.
- No removal of existing routes, functions, views, or compatibility flows beyond the specifically named duplicate columns.
- No broad admin.html extraction or runtime upgrade.
- No phone-first layout redesign.

## Data decisions confirmed by user

- Create recruit candidate rows for the 558 active customers that have a recruitment priority but no recruit row.
- For duplicate speaker fields, fill missing Person values from speaker rows and preserve Person values when conflicting; then remove duplicate speaker columns.
- Person is authoritative for shared fields; name may remain as a role-specific display copy.
