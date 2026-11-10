'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const handlers={};let seenCallback;
const guarded=(_name,_main)=>(event,context,cb)=>{seenCallback=cb;return cb?undefined:Promise.resolve({ok:true});};
vm.runInNewContext(fs.readFileSync('cloudfunctions/assistant/index.js','utf8'),{exports:handlers,process:{env:{}},require:id=>id==='./device-runtime'?{protect:guarded}:{},console});
(async()=>{const cb=()=>{};assert.equal((await handlers.main({action:'knowledgeMcpInternal'},{},cb)).ok,true);assert.equal(seenCallback,undefined);
assert.equal((await handlers.main({Type:'Timer',TriggerName:'knowledgeOcrWorker'},{},cb)).ok,true);
assert.equal(handlers.main({__deviceRequest:{action:'meetingPrep',asyncWait:true}},{},cb),undefined);assert.equal(seenCallback,cb);
console.log('PASS: production assistant entry returns promises to GPT and timers and keeps the requested early callback');})().catch(e=>{console.error(e);process.exitCode=1});
