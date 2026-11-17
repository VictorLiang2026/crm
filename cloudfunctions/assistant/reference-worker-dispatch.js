'use strict';
const {timingSafeEqual}=require('node:crypto');
function valid(event,secret){return event?.Type==='Timer'&&event.TriggerName==='referenceOptimizationWorker'&&
 typeof secret==='string'&&secret.length>=32&&typeof event.Message==='string'&&Buffer.byteLength(event.Message)===Buffer.byteLength(secret)&&
 timingSafeEqual(Buffer.from(event.Message),Buffer.from(secret));}
async function dispatch(event,secret=process.env.KNOWLEDGE_OCR_TRIGGER_SECRET){
 if(!valid(event,secret))return {handled:false};
 // Reuse the existing narrowly scoped OCR delegation capability after authenticating
 // this dedicated timer. Its handler can only process the reference queue.
 const run=require('./device-runtime').protect('assistant',()=>require('./knowledge-library-service').handleKnowledgeLibrary(
  {operation:'referenceWorker'},'reference-worker',{internalReferenceWorker:true}));
 return run({Type:'Timer',TriggerName:'knowledgeOcrWorker',Message:secret});
}
module.exports={valid,dispatch};
