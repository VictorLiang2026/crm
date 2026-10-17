/** Bounded, deterministic PC30 candidates and persisted human review state. */
'use strict';

const crypto = require('node:crypto');
const { RelationshipDecayService } = require('./relationship-decay-service');
const { disclose, refsForRows } = require('./test-data');

const MAX_CANDIDATES = 12;
const MAX_RELATIONSHIP_REVIEWS = 8;
const DAY = 86400000;
const TERMINAL_RECRUIT_STAGES = new Set(['签约入司']);
const SOURCE_TYPES = new Set(['commitment_due','relationship_decay','relationship_changed','activity_followup','recruit_stagnation']);
const DECISIONS = new Set(['deferred','rejected','action_created']);
const idOf = value => {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid proactive coach ID');
  return id;
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = value => Number.isFinite(Date.parse(value || '')) ? new Date(value).toISOString() : null;
const one = rows => Array.isArray(rows) ? rows[0] || null : null;

function candidateKey(actorUid, type, personId, sourceId, version) {
  const digest = crypto.createHash('sha256')
    .update(['pc30',actorUid,type,String(personId),String(sourceId),String(version)].join('|'))
    .digest().subarray(0,16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function daysSince(value, nowMs) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? Math.floor((nowMs - ms) / DAY) : null;
}

function makeActionDraft(titleKey, descriptionKey, priority, dueAt, templateArgs) {
  return { titleKey, descriptionKey, priority, dueAt:iso(dueAt), templateArgs };
}

class ProactiveCoachService {
  constructor({ request, rpc, disclosure = disclose, now = () => new Date() } = {}) {
    if (typeof request !== 'function' || typeof rpc !== 'function') throw new Error('Proactive coach database adapters are required');
    this.request=request; this.rpc=rpc; this.disclosure=disclosure; this.now=now;
  }

  async list(actorUid) {
    if (typeof actorUid !== 'string' || !actorUid.trim() || actorUid.length > 128) throw new Error('UNAUTHORIZED');
    const now=this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid proactive coach clock');
    const nowMs=now.getTime(), nowIso=now.toISOString();
    const withinDays=days=>new Date(nowMs+days*DAY).toISOString();
    const sinceDays=days=>new Date(nowMs-days*DAY).toISOString();
    const caps={commitments:101,relationships:101,activities:101,participants:501,recruits:301,
      recruitFollowups:501,actions:501,activityInteractions:1001,context:301};
    const [dueCommitments,relationships,activities,recruits,openActions,contextItems]=await Promise.all([
      this.request('commitments','GET',{select:'id,person_id,interaction_id,commitment_type,content,due_at,status,updated_at',
        status:'eq.open',due_at:`lt.${withinDays(7)}`,order:'due_at.asc,id.asc',limit:101}),
      this.request('relationships','GET',{select:'id,from_person_id,to_person_id,relationship_type,strength,importance,status,confirmed_at,updated_at,deleted_at',
        status:'eq.confirmed',deleted_at:'is.null',updated_at:`gte.${sinceDays(7)}`,order:'updated_at.desc,id.desc',limit:caps.relationships}),
      this.request('activities','GET',{select:'id,name,status,activity_date,updated_at,deleted_at',
        status:'in.(ended,reviewed)',deleted_at:'is.null',activity_date:`gte.${sinceDays(30)}`,
        order:'activity_date.desc,id.desc',limit:caps.activities}),
      this.request('recruit_candidates','GET',{select:'id,person_id,customer_id,stage,stage_changed_at,next_action_date,next_action,created_at,updated_at,deleted_at',
        stage:'neq.签约入司',deleted_at:'is.null',order:'stage_changed_at.asc,id.asc',limit:caps.recruits}),
      this.request('actions','GET',{select:'id,person_id,activity_id,interaction_id,title,description,due_at,status,updated_at',
        status:'in.(open,in_progress)',order:'updated_at.desc,id.desc',limit:caps.actions}),
      this.request('context_items','GET',{select:'id,person_id,item_type,category,content,structured_value,confirmed,valid_from,valid_to,created_at',
        item_type:'in.(fact,inference)',confirmed:'eq.true',
        category:'in.(relationship_strength,relationship_importance,last_meaningful_interaction_at)',
        created_at:`gte.${sinceDays(730)}`,order:'created_at.desc,id.desc',limit:caps.context}),
    ]);
    const activityRows=activities.filter(row=>!row.deleted_at);
    const activityIds=[...new Set(activityRows.map(row=>idOf(row.id)))];
    const recruitIds=[...new Set(recruits.filter(row=>!row.deleted_at && row.person_id && !TERMINAL_RECRUIT_STAGES.has(row.stage)).map(row=>idOf(row.id)))];
    const [participants,recruitFollowups,activityInteractions]=await Promise.all([
      activityIds.length ? this.request('activity_participants','GET',{select:'id,activity_id,canonical_person_id,person_id,person_type,followup_status,updated_at,deleted_at',
        activity_id:`in.(${activityIds.join(',')})`,canonical_person_id:'not.is.null',deleted_at:'is.null',
        order:'updated_at.desc,id.desc',limit:caps.participants}) : [],
      recruitIds.length ? this.request('recruit_followups','GET',{select:'id,candidate_id,followup_date,next_followup_date,updated_at,deleted_at',
        candidate_id:`in.(${recruitIds.join(',')})`,deleted_at:'is.null',order:'followup_date.desc,id.desc',limit:caps.recruitFollowups}) : [],
      activityIds.length ? this.request('interactions','GET',{select:'id,person_id,activity_id,interaction_type,interaction_at,created_at',
        activity_id:`in.(${activityIds.join(',')})`,interaction_type:'eq.post_event_followup',
        order:'interaction_at.desc,id.desc',limit:caps.activityInteractions}) : [],
    ]);
    if (![dueCommitments,relationships,activities,recruits,openActions,contextItems,participants,recruitFollowups,activityInteractions].every(Array.isArray)) {
      throw new Error('Invalid proactive coach source response');
    }

    const personIds=new Set();
    for (const row of dueCommitments) if (row.person_id) personIds.add(idOf(row.person_id));
    for (const row of relationships) { personIds.add(idOf(row.from_person_id)); personIds.add(idOf(row.to_person_id)); }
    for (const row of participants) if (row.canonical_person_id) personIds.add(idOf(row.canonical_person_id));
    for (const row of recruits) if (row.person_id && !row.deleted_at) personIds.add(idOf(row.person_id));
    for (const row of contextItems) personIds.add(idOf(row.person_id));
    for (const row of openActions) if (row.person_id) personIds.add(idOf(row.person_id));
    const ids=[...personIds];
    const people=[];
    for (let offset=0;offset<ids.length;offset+=100) {
      people.push(...await this.request('persons','GET',{select:'id,display_name,deleted_at',
        id:`in.(${ids.slice(offset,offset+100).join(',')})`,deleted_at:'is.null',limit:100}));
    }
    const personMap=new Map(people.filter(p=>!p.deleted_at).map(p=>[String(p.id),p]));
    const activePerson=id=>personMap.get(String(id))||null;
    const activeOpenActions=openActions.filter(row=>activePerson(row.person_id));
    const candidates=[];

    const dueRows=dueCommitments.filter(row=>row.person_id && activePerson(row.person_id) &&
      Date.parse(row.due_at||'')<Date.parse(withinDays(7)));
    for (const row of dueRows) {
      if (activeOpenActions.some(action=>(row.interaction_id && String(action.interaction_id)===String(row.interaction_id)) ||
        String(action.description||'').includes(`public.commitments#${row.id}`))) continue;
      const person=activePerson(row.person_id); const due=iso(row.due_at);
      const overdue=Date.parse(due||'')<nowMs;
      const source=`public.commitments#${row.id}`;
      const c={type:'commitment_due',candidateKey:candidateKey(actorUid,'commitment_due',row.person_id,row.id,`${row.updated_at}|${row.due_at}|${row.status}`),
        sourceType:'commitment_due',sourceId:Number(row.id),personId:Number(row.person_id),personName:person.display_name,
        source,sourceTable:'commitments',sourceRow:row,target:`#/person/${row.person_id}`,
        windowStart:due,windowEnd:nowIso,confidence:0.95,priority:overdue?'urgent':'high',
        data:{dueAt:due,overdue,commitmentType:row.commitment_type},
        title:row.content?.slice(0,160)||'Open commitment',
        reasonKey:'pc30_commitment_reason'};
      c.actionDraft=makeActionDraft('pc30_action_commitment_title','pc30_action_commitment_description',
        overdue?'high':'medium',due,{content:row.content||'核对待办',source,candidateKey:c.candidateKey});
      candidates.push(c);
    }

    for (const row of relationships.filter(r=>!r.deleted_at && r.status==='confirmed' && activePerson(r.from_person_id) && activePerson(r.to_person_id))) {
      const changedAt=Date.parse(row.updated_at||'');
      if (!Number.isFinite(changedAt) || changedAt>nowMs || changedAt<Date.parse(sinceDays(7))) continue;
      const person=activePerson(row.from_person_id), source=`public.relationships#${row.id}`;
      const c={type:'relationship_changed',candidateKey:candidateKey(actorUid,'relationship_changed',row.from_person_id,row.id,row.updated_at),
        sourceType:'relationship_changed',sourceId:Number(row.id),personId:Number(row.from_person_id),personName:person.display_name,
        source,sourceTable:'relationships',sourceRow:row,target:`#/person/${row.from_person_id}/relationships`,
        windowStart:iso(row.updated_at),windowEnd:nowIso,confidence:0.7,
        priority:Number(row.importance)>=4?'high':'medium',data:{updatedAt:iso(row.updated_at),relationshipType:row.relationship_type,
          importance:row.importance,strength:row.strength},reasonKey:'pc30_relationship_changed_reason',title:row.relationship_type};
      c.actionDraft=makeActionDraft('pc30_action_relationship_title','pc30_action_relationship_description','low',withinDays(1),
        {person:person.display_name,updated:row.updated_at,source,candidateKey:c.candidateKey});
      candidates.push(c);
    }

    const followupsByKey=new Set(activityInteractions.map(row=>`${row.activity_id}:${row.person_id}`));
    const participantCount=new Map();
    for (const row of participants) if (!row.deleted_at && row.canonical_person_id && activePerson(row.canonical_person_id)) {
      const activity=activityRows.find(a=>String(a.id)===String(row.activity_id));
      if (!activity || !['ended','reviewed'].includes(activity.status)) continue;
      const key=`${activity.id}:${row.canonical_person_id}`;
      if (followupsByKey.has(key) || (row.followup_status||'').toLowerCase()==='completed') continue;
      if (activeOpenActions.some(action=>String(action.activity_id)===String(activity.id) && String(action.person_id)===String(row.canonical_person_id))) continue;
      if (participantCount.has(key)) continue;
      participantCount.set(key,true);
      const person=activePerson(row.canonical_person_id), source=`public.activity_participants#${row.id}`;
      const c={type:'activity_followup',candidateKey:candidateKey(actorUid,'activity_followup',row.canonical_person_id,row.id,
          `${activity.updated_at}|${row.updated_at}|${activity.status}`),
        sourceType:'activity_followup',sourceId:Number(row.id),personId:Number(row.canonical_person_id),personName:person.display_name,
        source,sourceTable:'activity_participants',sourceRow:row,extraSources:[{table:'activities',id:activity.id}],
        target:`#/activity/${activity.id}`,windowStart:iso(activity.activity_date),windowEnd:nowIso,
        confidence:0.75,priority:'medium',data:{activityId:Number(activity.id),activityName:activity.name,
          activityDate:iso(activity.activity_date)},reasonKey:'pc30_activity_reason',title:activity.name};
      c.actionDraft=makeActionDraft('pc30_action_activity_title','pc30_action_activity_description','medium',withinDays(1),
        {activity:activity.name||'活动',person:person.display_name,source,activitySource:`public.activities#${activity.id}`,candidateKey:c.candidateKey});
      candidates.push(c);
    }

    const followupLatest=new Map();
    for (const row of recruitFollowups) {
      const old=followupLatest.get(String(row.candidate_id));
      if (!old || Date.parse(row.followup_date||'')>Date.parse(old.followup_date||'')) followupLatest.set(String(row.candidate_id),row);
    }
    for (const row of recruits) {
      if (row.deleted_at || !row.person_id || TERMINAL_RECRUIT_STAGES.has(row.stage)) continue;
      const person=activePerson(row.person_id); if (!person) continue;
      const recent=followupLatest.get(String(row.id));
      const anchor=Date.parse(row.stage_changed_at||row.created_at||'');
      const last=recent ? Math.max(anchor,Date.parse(recent.followup_date||'')) : anchor;
      if (!Number.isFinite(last) || Math.floor((nowMs-last)/DAY)<14) continue;
      if (activeOpenActions.some(action=>String(action.person_id)===String(row.person_id) &&
        String(action.description||'').includes(`public.recruit_candidates#${row.id}`))) continue;
      const source=`public.recruit_candidates#${row.id}`, idle=Math.floor((nowMs-last)/DAY);
      const c={type:'recruit_stagnation',candidateKey:candidateKey(actorUid,'recruit_stagnation',row.person_id,row.id,
          `${row.stage}|${row.stage_changed_at}|${recent?.id||''}|${recent?.followup_date||''}`),
        sourceType:'recruit_stagnation',sourceId:Number(row.id),personId:Number(row.person_id),personName:person.display_name,
        source,sourceTable:'recruit_candidates',sourceRow:row,
        ...(recent?{extraSources:[{table:'recruit_followups',id:recent.id}]}:{}),
        target:`#/person/${row.person_id}/recruit`,windowStart:new Date(last).toISOString(),windowEnd:nowIso,
        confidence:0.75,priority:idle>=30?'high':'medium',data:{idleDays:idle,stage:row.stage},
        reasonKey:'pc30_recruit_reason',title:row.next_action||row.stage||'Recruit follow-up'};
      c.actionDraft=makeActionDraft('pc30_action_recruit_title','pc30_action_recruit_description',idle>=30?'high':'medium',
        withinDays(1),{person:person.display_name,stage:row.stage||'—',days:String(idle),source,candidateKey:c.candidateKey});
      candidates.push(c);
    }

    const relationshipTargets=[...new Set([
      ...relationships.filter(r=>!r.deleted_at && r.status==='confirmed' && (Number(r.importance)>=3 || r.strength))
        .flatMap(r=>[String(r.from_person_id),String(r.to_person_id)]),
      ...contextItems.filter(row=>row.category==='relationship_strength' || row.category==='relationship_importance')
        .map(row=>String(row.person_id)),
    ])].filter(id=>activePerson(id)).slice(0,MAX_RELATIONSHIP_REVIEWS);
    const relationshipResults=[];
    for (let offset=0;offset<relationshipTargets.length;offset+=2) {
      const pair=relationshipTargets.slice(offset,offset+2);
      relationshipResults.push(...await Promise.all(pair.map(personId=>
        new RelationshipDecayService({request:this.request,now:()=>now}).evaluateForPerson(personId))));
    }
    for (const result of relationshipResults) {
      if (result.candidate!==true || !activePerson(result.person_id)) continue;
      const version=JSON.stringify({sources:result.sources,evidence:result.evidence});
      const person=activePerson(result.person_id), source=result.sources.cadence[0]||result.sources.last_meaningful||`public.persons#${result.person_id}`;
      const c={type:'relationship_decay',candidateKey:candidateKey(actorUid,'relationship_decay',result.person_id,result.person_id,version),
        sourceType:'relationship_decay',sourceId:Number(result.person_id),personId:Number(result.person_id),personName:person.display_name,
        source,sourceTable:'persons',sourceRow:{id:result.person_id},extraRefs:result.sources,
        target:`#/person/${result.person_id}/relationships`,windowStart:sinceDays(730),windowEnd:nowIso,
        confidence:result.confidence,priority:result.confidence>=0.75?'high':'medium',data:result.evidence,
        reasonKey:'pc30_relationship_decay_reason',title:'relationship_decay'};
      c.actionDraft=makeActionDraft('pc30_action_cadence_title','pc30_action_cadence_description','medium',withinDays(1),
        {person:person.display_name,why:result.why,elapsed:String(result.evidence.elapsed_days),cadence:String(result.evidence.cadence_days),
          source,candidateKey:c.candidateKey});
      candidates.push(c);
    }

    const unique=new Map();
    for (const c of candidates) if (!unique.has(c.candidateKey)) unique.set(c.candidateKey,c);
    const priorityOrder={urgent:0,high:1,medium:2,low:3};
    const sorted=[...unique.values()].sort((a,b)=>priorityOrder[a.priority]-priorityOrder[b.priority] ||
      Date.parse(a.windowStart||'9999-12-31')-Date.parse(b.windowStart||'9999-12-31') || a.candidateKey.localeCompare(b.candidateKey));
    const decisionWindow=sorted.slice(0,100);
    const decisions=decisionWindow.length ? await this.request('crm_proactive_coach_decisions','GET',{
      select:'candidate_key,decision,snooze_until,action_id,updated_at',actor_uid:`eq.${actorUid}`,
      candidate_key:`in.(${decisionWindow.map(c=>c.candidateKey).join(',')})`,limit:100,
    }) : [];
    if (!Array.isArray(decisions)) throw new Error('Invalid proactive coach decision response');
    const decisionMap=new Map(decisions.map(row=>[String(row.candidate_key),row]));
    const eligible=decisionWindow.filter(c=>{
      const decision=decisionMap.get(c.candidateKey);
      return decision?.decision!=='rejected' && decision?.decision!=='action_created' &&
        !(decision?.decision==='deferred' && Date.parse(decision.snooze_until||'')>nowMs);
    });
    const active=[];
    for (const c of eligible.slice(0,MAX_CANDIDATES)) {
      const refs=[...refsForRows(c.sourceTable,[c.sourceRow]),...(c.extraSources||[]).flatMap(x=>refsForRows(x.table,[{id:x.id}]))];
      for (const ref of this.relationshipRefs(c)) refs.push(ref);
      refs.push(...refsForRows('persons',[activePerson(c.personId)]));
      c.testData=await this.disclosure(refs);
      const decision=decisionMap.get(c.candidateKey);
      c.previouslyDeferred=decision?.decision==='deferred';
      c.canCreateAction=c.testData.status==='verified' && c.testData.containsTestData===false;
      const {sourceRow,sourceTable,extraSources,extraRefs,...publicCandidate}=c;
      active.push(publicCandidate);
    }
    const isTruncated=dueCommitments.length>=101 || relationships.length>=caps.relationships ||
      activityRows.length>=caps.activities || participants.length>=caps.participants || recruits.length>=caps.recruits ||
      recruitFollowups.length>=caps.recruitFollowups || openActions.length>=caps.actions ||
      activityInteractions.length>=caps.activityInteractions || contextItems.length>=caps.context || sorted.length>MAX_CANDIDATES ||
      relationshipTargets.length>=MAX_RELATIONSHIP_REVIEWS || sorted.length>decisionWindow.length || eligible.length>MAX_CANDIDATES;
    return {candidates:active,asOf:nowIso,limit:MAX_CANDIDATES,hasMore:Boolean(isTruncated),
      relationshipReviewLimit:MAX_RELATIONSHIP_REVIEWS,
      disclosure:await this.disclosure([
        ...refsForRows('persons',people),...refsForRows('commitments',dueRows),
        ...refsForRows('relationships',relationships),...refsForRows('activities',activityRows),
        ...refsForRows('activity_participants',participants),...refsForRows('recruit_candidates',recruits),
        ...refsForRows('recruit_followups',recruitFollowups),...refsForRows('actions',activeOpenActions),
        ...refsForRows('interactions',activityInteractions),...refsForRows('context_items',contextItems),
      ])};
  }

  relationshipRefs(candidate) {
    const refs=[];
    for (const value of Object.values(candidate.extraRefs||{})) {
      if (typeof value==='string') {
        const match=/^public\.([a-z_]+)#([1-9]\d*)$/.exec(value);
        if (match) refs.push({table:match[1],id:match[2]});
      } else if (Array.isArray(value)) for (const item of value) {
        const match=/^public\.([a-z_]+)#([1-9]\d*)$/.exec(String(item));
        if (match) refs.push({table:match[1],id:match[2]});
      }
    }
    return refs;
  }

  async decide(input, actorUid) {
    if (typeof actorUid!=='string'||!actorUid.trim()||!plain(input)||
        Object.keys(input).some(key=>!['candidateKey','personId','sourceType','sourceId','decision','snoozeDays','actionId'].includes(key)) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(input.candidateKey||'')) ||
        !SOURCE_TYPES.has(input.sourceType)||!DECISIONS.has(input.decision)) throw new Error('Invalid proactive coach decision');
    const personId=idOf(input.personId), sourceId=idOf(input.sourceId);
    let snoozeDays=null,actionId=null;
    if(input.decision==='deferred') {
      snoozeDays=Number(input.snoozeDays);
      if(!Number.isInteger(snoozeDays)||snoozeDays<1||snoozeDays>30||input.actionId!=null) throw new Error('Invalid proactive coach defer time');
    } else if(input.decision==='rejected') {
      if(input.snoozeDays!=null||input.actionId!=null) throw new Error('Invalid proactive coach rejection');
    } else {
      if(input.snoozeDays!=null) throw new Error('Invalid proactive coach Action decision');
      actionId=idOf(input.actionId);
    }
    const result=await this.rpc('crm_proactive_coach_decision_v1',{
      p_actor_uid:actorUid.trim(),p_candidate_key:input.candidateKey,p_person_id:Number(personId),
      p_source_type:input.sourceType,p_source_id:Number(sourceId),p_decision:input.decision,
      p_snooze_days:snoozeDays,p_action_id:actionId?Number(actionId):null,
    });
    return one(result)||result;
  }
}

module.exports={ProactiveCoachService,candidateKey,MAX_CANDIDATES,MAX_RELATIONSHIP_REVIEWS};
