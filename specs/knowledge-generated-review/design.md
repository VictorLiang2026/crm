# Generated knowledge review design

## State model

- New uploaded/extracted knowledge remains in existing `draft` lifecycle state. The source remains draft with `extraction_status=draft`; the current automatic `crm_knowledge_source_review_v1(..., 'verify')` call is removed. The existing source/item review RPC is used only after a person clicks the explicit review action.
- `saveKnowledge` only auto-verifies when the user supplied the summary. When the AI Gateway generated the summary, the row stays draft (a prior verified row remains active if a superseding draft is created).
- Existing content-version command rows gain `pending_review` and `rejected` terminal states. Editing/restoring creates a pending command without changing record content. The new `approve` operation locks the record, checks `expected_updated_at` and the original snapshot, then applies the saved after-state. `reject` discards the candidate and preserves history.
- Selection of a previously reviewed complete pair remains a separate preview and confirm operation. A pending candidate cannot be selected or passed to AI consumers.

## UI

The current knowledge governance page exposes review/activate for generated draft items and shows a pending-revision badge on records with a queued content command. The content-version panel shows pending candidate text and separate Approve / Discard controls. Existing edit, clear, regenerate, and history actions continue through the server preview workflow. All new copy is in the existing bilingual dictionary.

## Safety / compatibility

- Schema changes stay within `public`; no object is renamed or removed.
- Generated draft items already have the existing `draft` lifecycle, so no new lifecycle value or downstream resolver exception is needed.
- `knowledge_content_commands` is extended additively; pending commands remain bound to their creating actor, one at a time per record and actor. Old previews/history remain valid. Rollback restores the prior function and status constraint without deleting retained command history.
- The source file is never mutated by content editing/deletion. No client `confirmed` flag bypasses server preview or authorization.
