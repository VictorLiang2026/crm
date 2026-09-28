'use strict';

const PAGE_SIZE = 50;

function beijingHorizon(now) {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(),
    local.getUTCDate() + 4) - 8 * 60 * 60 * 1000);
}

class CommitmentService {
  constructor({ request, now = () => new Date() }) {
    this.request = request;
    this.now = now;
  }

  async listDue() {
    const now = this.now();
    const asOf = now.toISOString();
    const horizon = beijingHorizon(now);
    const select = 'id,person_id,interaction_id,commitment_type,content,due_at,status,source,created_at';
    const [overdueRows, upcomingRows] = await Promise.all([
      this.request('commitments', 'GET', {
        select, status: 'eq.open', due_at: `lt.${asOf}`,
        order: 'due_at.desc,id.desc', limit: PAGE_SIZE + 1,
      }),
      this.request('commitments', 'GET', {
        select, status: 'eq.open', due_at: `gte.${asOf}`,
        order: 'due_at.asc,id.asc', limit: PAGE_SIZE + 1,
      }),
    ]);
    const overdue = overdueRows.slice(0, PAGE_SIZE);
    const dueSoonRows = upcomingRows.filter(row => {
      const dueAt = new Date(row.due_at);
      return Number.isFinite(dueAt.getTime()) && dueAt < horizon;
    });
    const dueSoon = dueSoonRows.slice(0, PAGE_SIZE);
    const ids = [...new Set([...overdue, ...dueSoon].map(row => String(row.person_id)))];
    const persons = ids.length ? await this.request('persons', 'GET', {
      select: 'id,display_name', id: `in.(${ids.join(',')})`,
      deleted_at: 'is.null', limit: PAGE_SIZE * 2,
    }) : [];
    const names = new Map(persons.map(person => [String(person.id), person.display_name]));
    const present = row => names.has(String(row.person_id));
    const decorate = row => ({ ...row, person_name: names.get(String(row.person_id)) });
    return {
      overdue: overdue.filter(present).map(decorate),
      dueSoon: dueSoon.filter(present).map(decorate),
      hasMoreOverdue: overdueRows.length > PAGE_SIZE,
      hasMoreDueSoon: dueSoonRows.length > PAGE_SIZE,
      asOf,
    };
  }
}

module.exports = { CommitmentService, beijingHorizon };
