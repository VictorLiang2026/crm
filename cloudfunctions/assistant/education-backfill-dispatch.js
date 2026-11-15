'use strict';
const {createEducationBackfill,isEducationTimer}=require('./education-backfill-service');

// Called only AFTER the existing private device/login checks in Assistant.
async function dispatchEducationBackfill(event,identity,serviceFactory=createEducationBackfill) {
  try {return await serviceFactory().handle(event,identity);}
  catch(error) {
    const code=/^EDUCATION_[A-Z_]{1,70}$/.test(error.code||'')?error.code:'EDUCATION_REQUEST_FAILED';
    return {ok:false,error:{code}};
  }
}
// This dispatcher must be attached to the top-level trusted timer path, not a user action.
async function dispatchEducationTimer(event,secret=process.env.EDUCATION_BACKFILL_TRIGGER_SECRET,serviceFactory=createEducationBackfill) {
  if(!isEducationTimer(event,secret))return {handled:false};
  return {handled:true,...await serviceFactory().workQueue()};
}
module.exports={dispatchEducationBackfill,dispatchEducationTimer};
