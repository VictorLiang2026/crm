'use strict';
const {createSkillRegistry}=require('./skill-registry');
const string=maxLength=>({type:'string',minLength:1,maxLength});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const section=object({start:{type:'integer',minimum:0},end:{type:'integer',minimum:0},title:string(160),kind:{enum:['wording','objection']}});
module.exports=createSkillRegistry([
 {name:'reference_optimize',version:'1.0.0',capability:'coaching',contextRecipe:{required:['reference','guardrails'],optional:[],limits:{}},
  inputSchema:object({jobId:string(36)}),outputSchema:object({title:string(160),content:string(4000),note:string(2000)}),confirmationLevel:'review',timeoutClass:'standard'},
 {name:'reference_parse',version:'1.0.0',capability:'structured_extraction',contextRecipe:{required:['paragraphs','guardrails'],optional:[],limits:{paragraphs:120}},
  inputSchema:object({jobId:string(36),chunk:{type:'integer',minimum:0}}),
  outputSchema:object({sections:{type:'array',maxItems:120,items:section},omitted:{type:'array',maxItems:120,items:object({index:{type:'integer',minimum:0},reason:string(200)})}}),confirmationLevel:'review',timeoutClass:'standard'},
]);
