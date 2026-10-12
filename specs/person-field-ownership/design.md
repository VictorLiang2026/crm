# Design: Person field ownership and console directory

## Ownership model

| Owner | Fields |
| --- | --- |
| persons | name/display name; phone, wechat, gender, birthday, occupation, organization, education, source, notes; hobbies, marital status, customer stage, sales priority, referral priority, first-contact date |
| customers | Customer-only insurance/relationship fields such as customer tags, income, property information, customer profile, and customer notes |
| recruit_candidates | Recruitment stage/profile/follow-up data and recruitment priority |
| activity_speakers | Speaker position, expertise, topic, contact cadence, cooperation count, preferred format, status, notes, and links; name remains an allowed display copy |
| activity_participants | Activity participation and attendance data; person name remains an allowed display copy |

Shared values in customer and speaker rows will fill blank Person values only. Existing nonblank Person data wins conflicts. Recruitment priority will update the 13 active matched candidates and one existing deleted candidate; 558 active candidates will be created with stage 新增人才, matching timestamps, and a creation milestone. No customer deletion or restore semantics will change.

Customer additional_info remains a customer note because it is customer-domain context; Person notes remains general Person context. The forms will label and present these separately.

## Read and write boundaries

- Keep the legacy callFn entry points. Split allowed input fields server-side: Person fields go to persons, Customer-only fields to customers, and recruitment priority to recruit_candidates.
- Person edit continues to require an explicit Person ID and optimistic lock.
- Person-to-customer and Person-to-recruit actions use the existing server-side identity preview and execution flow, followed by a visible human confirmation.
- Rebuild every dependent public view before dropping the old base columns and regrant its current SELECT permissions.
- Extend the existing server-side Person directory query for new fields and sorting.
- Use a server-side trash query for role and priority filtering so filters compose with pagination.

## Person information display recommendation

- Person 360 is the complete source of truth and the only editor for shared Person attributes.
- Customer/recruit/speaker workflows show a compact context strip: name, phone, occupation, and organization when present, plus a link to Person 360.
- Keep role fields in their own form. Do not repeat birthday, gender, source, hobbies, marital status, or general notes in role forms.
- Keep customer-specific income, property, tag, and note fields on the customer profile.

## UI specification

- Follow the existing console industrial/utilitarian design system and its red, ink, gold, jade, and light-gray tokens.
- Use the existing iPad/table toolbar and table conventions. Preserve existing responsive behavior without expanding this work into a phone redesign.
- Person directory columns: name, customer priority, recruit priority, referral priority, latest follow-up, next follow-up, customer conversion, recruit conversion, and ID. Remove generic priority and customer stage.
- Recycle-bin filters: multi-select roles; once selected, reveal the applicable customer/recruit/referral priority multi-selects. Search applies the pending selection in one request. Role matches are OR; values within each role priority are OR; selected role groups compose as OR, with keyword if present as AND.
- Use t(key) for every new visible string in Simplified Chinese and English.

## Migration and rollback

- One versioned public migration adds the Person and recruit columns, backfills data, creates missing recruit candidates/milestones, replaces dependent views and functions, then drops duplicate base columns.
- The paired rollback recreates removed columns with matching types, restores values from Person/recruit rows, recreates the prior views and directory function, and removes only the columns added by this migration.
- Before applying the migration, verify current public schema, exact dependencies, RLS/grants, and recent migration history. After applying, inspect every touched table/view/function.
- Release only changed pages/modules/functions. Stop if release gate, relevant regression, Git publication, or cloud verification fails.

## Validation

- Static syntax checks for modified JavaScript and migration parsing/preflight.
- Read-only SQL checks for migrated row counts, absence of duplicated base columns, rebuilt view columns, and function signatures.
- Business regression for Person editing, customer add/edit/list, recruit create/update/list/funnel, speaker profile read/edit, recycle-bin filter/restore, and customer/recruit role conversion.
