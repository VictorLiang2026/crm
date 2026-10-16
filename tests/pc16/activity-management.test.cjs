'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('PC16 keeps the legacy activity/task actions while adding parent and version guards for Console writes',()=>{
  const activity=fs.readFileSync(path.join(__dirname,'../../cloudfunctions/activities/index.js'),'utf8');
  const tasks=fs.readFileSync(path.join(__dirname,'../../cloudfunctions/activity_tasks/index.js'),'utf8');
  const page=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/console/pages/activities.js'),'utf8');
  const writes=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/console/activities-write.js'),'utf8');
  for(const action of ["case 'create'", "case 'update'", "case 'remove'"])assert.ok(activity.includes(action),action);
  for(const action of ["case 'previewRemove'", "case 'removeConsole'", "case 'updateConsole'"])assert.ok(activity.includes(action),action);
  for(const action of ["case 'create'", "case 'update'", "case 'complete'", "case 'skip'", "case 'remove'"])assert.ok(tasks.includes(action),action);
  for(const action of ["case 'updateConsole'", "case 'transitionConsole'", "case 'removeConsole'"])assert.ok(tasks.includes(action),action);
  assert.match(activity,/activity changed; reload the impact preview/);
  assert.match(activity,/participants changed; reload the impact preview/);
  assert.match(tasks,/\.eq\('activity_id', activityId\)\.eq\('updated_at', expectedUpdatedAt\)/);
  assert.match(page,/location\.hash = '#\/activity\/customer'/,'daily report links to the existing report page');
  assert.match(writes,/related_type: 'none'/);
  assert.match(writes,/source: 'manual'/);
  assert.match(writes,/participantsSoftDeleted/);
});
