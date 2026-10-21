'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMain}=require('../../cloudfunctions/assistant');

test('Action and Opportunity interpretation project transport metadata but reject forged business input',async()=>{
  const calls=[];
  const main=createMain(async()=>({uid:'fixture-actor',isAnonymous:false}),undefined,undefined,
    undefined,undefined,
    async event=>{calls.push(['actionInterpret',event]);return {ok:true,status:'needs_clarification'};},
    async event=>{calls.push(['actionTargets',event]);return {ok:true,status:'targets_available'};},
    async event=>{calls.push(['opportunityInterpret',event]);return {ok:true,status:'needs_clarification'};},
    async(event,uid)=>{calls.push(['opportunityTargets',event,uid]);return {ok:true,status:'targets_available'};});
  const transport={requestId:'cloud-runtime-fixture',cloudbaseContext:{runtime:true}};
  assert.equal((await main({action:'actionCommandInterpret',query:'update fictional Action',language:'en',...transport})).ok,true);
  assert.equal((await main({action:'actionCommandTargets',personMention:'Fictional Alex',selectedPersonId:'7',...transport})).ok,true);
  assert.equal((await main({action:'opportunityCommandInterpret',query:'edit fictional Opportunity',language:'en',...transport})).ok,true);
  assert.equal((await main({action:'opportunityCommandTargets',personMention:'Fictional Alex',selectedPersonId:'7',...transport})).ok,true);
  assert.deepEqual(calls,[
    ['actionInterpret',{query:'update fictional Action',language:'en'}],
    ['actionTargets',{personMention:'Fictional Alex',selectedPersonId:'7'}],
    ['opportunityInterpret',{query:'edit fictional Opportunity',language:'en'}],
    ['opportunityTargets',{personMention:'Fictional Alex',selectedPersonId:'7'},'fixture-actor'],
  ]);
  for(const event of [
    {action:'actionCommandInterpret',query:'update',actorUid:'forged'},
    {action:'actionCommandTargets',personMention:'Alex',selectedPersonId:'7',candidateId:9},
    {action:'opportunityCommandInterpret',query:'edit',commandId:'forged'},
    {action:'opportunityCommandTargets',personMention:'Alex',selectedPersonId:'7',previewHash:'forged'},
  ])assert.equal((await main(event)).error.code,'INVALID_INPUT');
  assert.equal(calls.length,4);
});

test('command stages project transport metadata and reject cross-stage business fields',async()=>{
  const actionCalls=[],opportunityCalls=[];
  const main=createMain(async()=>({uid:'fixture-actor',isAnonymous:false}),undefined,
    async(event,uid)=>{actionCalls.push([event,uid]);return {ok:true,status:'planned'};},
    undefined,undefined,undefined,undefined,undefined,undefined,
    async(event,uid)=>{opportunityCalls.push([event,uid]);return {ok:true,status:'planned'};});
  const transport={requestId:'cloud-runtime-fixture',cloudbaseContext:{runtime:true}};
  const action={operation:'update',resource:'actions',personId:'7',targetActionId:'18',changes:{title:'【系统测试·勿联系】虚构标题'}};
  const opportunity={operation:'edit',resource:'opportunities',personId:'7',opportunityId:'10',changes:{nextAction:'【系统测试·勿联系】虚构下一步'}};
  assert.equal((await main({action:'command',stage:'plan',command:action,...transport})).ok,true);
  assert.deepEqual(actionCalls[0],[{action:'command',stage:'plan',command:action},'fixture-actor']);
  assert.equal((await main({action:'opportunityCommand',stage:'plan',command:opportunity,
    idempotencyKey:'11111111-1111-4111-8111-111111111111',...transport})).ok,true);
  assert.deepEqual(opportunityCalls[0],[{action:'opportunityCommand',stage:'plan',command:opportunity,
    idempotencyKey:'11111111-1111-4111-8111-111111111111'},'fixture-actor']);
  assert.equal((await main({action:'opportunityCommand',stage:'confirm',commandId:'11111111-1111-4111-8111-111111111111',
    previewHash:'0123456789abcdef0123456789abcdef',...transport})).ok,true);
  assert.deepEqual(opportunityCalls[1][0],{action:'opportunityCommand',stage:'confirm',
    commandId:'11111111-1111-4111-8111-111111111111',previewHash:'0123456789abcdef0123456789abcdef'});
  assert.equal((await main({action:'command',stage:'plan',command:action,previewHash:'forged'})).error.code,'INVALID_COMMAND');
  assert.equal((await main({action:'opportunityCommand',stage:'plan',command:opportunity,
    idempotencyKey:'11111111-1111-4111-8111-111111111111',confirmed:true})).error.code,'INVALID_COMMAND');
  assert.equal((await main({action:'opportunityCommand',stage:'execute',
    commandId:'11111111-1111-4111-8111-111111111111',previewHash:'forged'})).error.code,'INVALID_COMMAND');
  assert.equal(actionCalls.length,1);assert.equal(opportunityCalls.length,2);
});
