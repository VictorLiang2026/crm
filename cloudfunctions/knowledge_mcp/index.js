'use strict';
const crypto = require('node:crypto');
const http = require('node:http');
const cloudbase = require('@cloudbase/node-sdk');
const ENV = process.env.TCB_ENV;
const APP_KEY = process.env.CRM_KNOWLEDGE_MCP_CLOUDBASE_API_KEY;
const HMAC_KEY = process.env.CRM_KNOWLEDGE_MCP_HMAC_KEY;
const CONSENT_URI = process.env.CRM_KNOWLEDGE_MCP_CONSENT_URI;
const RESOURCE_URL = process.env.CRM_KNOWLEDGE_MCP_RESOURCE_URL;
const ISSUER_ORIGIN = process.env.CRM_KNOWLEDGE_MCP_ISSUER_URL;
const SCOPES = ['knowledge:read','knowledge:gpt:submit'];
const MCP_PATH = '/mcp/knowledge';
const OAUTH_PATH = '/oauth';
const ISSUER_PATH = '/knowledge-mcp';
const ISSUER_URL = (() => { try { return new URL(ISSUER_ORIGIN).origin + ISSUER_PATH; } catch (_) { return ''; } })();
const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const CHATGPT_CUSTOM_REDIRECT = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,80}$/;
const CODEX_LOOPBACK_REDIRECT = /^http:\/\/127\.0\.0\.1(?::([1-9][0-9]{0,4}))?\/callback$/;
function isAllowedRedirectUri(uri) {
  if (uri === CHATGPT_REDIRECT || CHATGPT_CUSTOM_REDIRECT.test(uri)) return true;
  const match = typeof uri === 'string' && uri.match(CODEX_LOOPBACK_REDIRECT);
  if (!match) return false;
  return !match[1] || Number(match[1]) <= 65535;
}
const b64url = value => Buffer.from(value).toString('base64url');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const randomToken = () => b64url(crypto.randomBytes(32));
const fail = (code, status=400) => { throw Object.assign(new Error(code),{code,status}); };
let app;
function appClient() {
  if (!ENV || !APP_KEY) fail('MCP_SERVICE_NOT_CONFIGURED',503);
  if (!app) app = cloudbase.init({env:ENV,accessKey:APP_KEY,timeout:180000});
  return app;
}
function requestInfo(event, context) {
  const http=context?.httpContext||{};
  const url=new URL(http.url||event?.url||'/',`https://${ENV||'localhost'}.example`);
  const method=String(http.httpMethod||event?.httpMethod||'GET').toUpperCase();
  const headers=Object.fromEntries(Object.entries(http.headers||event?.headers||{}).map(([k,v])=>[k.toLowerCase(),Array.isArray(v)?v[0]:String(v)]));
  let body=event?.body??event;
  if(typeof body==='string'&&event?.isBase64Encoded===true){try{body=Buffer.from(body,'base64').toString('utf8');}catch(_){body='';}}
  if(typeof body==='string'){
    const contentType=headers['content-type']||'';
    if(contentType.includes('application/x-www-form-urlencoded')) body=Object.fromEntries(new URLSearchParams(body));
    else { try{body=JSON.parse(body);}catch(_){body={};} }
  }
  if(!body||typeof body!=='object'||Array.isArray(body))body={};
  return {url,method,headers,body};
}
function response(statusCode,body,headers={}) {
  return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Method, Mcp-Name',
    'Access-Control-Max-Age':'600',...headers},body:typeof body==='string'?body:JSON.stringify(body)};
}
function toolAuthError(id,code,scopes){
  const resource=new URL(RESOURCE_URL),metadataUrl=`${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
  const error=code==='INSUFFICIENT_SCOPE'?'insufficient_scope':'invalid_token';
  const challenge=`Bearer resource_metadata="${metadataUrl}", error="${error}", scope="${scopes.join(' ')}"`;
  return response(200,{jsonrpc:'2.0',id,result:{content:[{type:'text',text:'Authentication or additional permission is required.'}],isError:true,
    _meta:{'mcp/www_authenticate':[challenge]}}});
}
async function rpc(operation,data) {
  if(!/^crm-[a-z0-9]+$/.test(ENV||''))fail('MCP_SERVICE_NOT_CONFIGURED',503);
  const value=await invokeAssistant('knowledge-mcp-service',{kind:'oauth',operation,data});
  if(!value?.ok)fail(operation==='access'?'MCP_INVALID_TOKEN':String(value?.error?.code||'MCP_OAUTH_FAILED').replace(/[^A-Z0-9_]/gi,'_').slice(0,80),operation==='access'?401:400);
  return value;
}
function requiredConfig(){
  try {
    const consent=new URL(CONSENT_URI),issuerOrigin=new URL(ISSUER_ORIGIN),issuer=new URL(ISSUER_URL),resource=new URL(RESOURCE_URL);
    if(consent.protocol!=='https:'||consent.pathname!=='/crm/oauth-consent.html'||consent.search||consent.hash||
       issuerOrigin.protocol!=='https:'||issuerOrigin.origin!==ISSUER_ORIGIN||issuer.protocol!=='https:'||issuer.pathname!==ISSUER_PATH||issuer.search||issuer.hash||
       resource.protocol!=='https:'||resource.origin!==issuer.origin||resource.pathname!==MCP_PATH||resource.search||resource.hash||
       !HMAC_KEY||HMAC_KEY.length<32)throw new Error();
  }
  catch(_){fail('MCP_SERVICE_NOT_CONFIGURED',503);}
}
function issuerMetadataPath(){return `/.well-known/oauth-authorization-server${ISSUER_PATH}`;}
function tokenHash(token){if(typeof token!=='string'||token.length<32||token.length>512)fail('INVALID_GRANT',400);return digest(token);}
async function oauthToken(body){
  requiredConfig();
  if(body.client_secret||body.client_assertion||body.client_assertion_type)fail('INVALID_CLIENT',401);
  if(body.grant_type==='authorization_code'){
    if(typeof body.client_id!=='string'||typeof body.redirect_uri!=='string'||body.resource!==RESOURCE_URL||typeof body.code!=='string'||typeof body.code_verifier!=='string'||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier))fail('INVALID_GRANT',400);
    const challenge=b64url(crypto.createHash('sha256').update(body.code_verifier).digest());
    const accessToken=randomToken(),refreshToken=randomToken();
    const grant=await rpc('exchange',{clientId:body.client_id,redirectUri:body.redirect_uri,resource:body.resource,codeHash:tokenHash(body.code),codeChallenge:challenge,
      accessHash:digest(accessToken),refreshHash:digest(refreshToken)});
    return {access_token:accessToken,token_type:'Bearer',expires_in:900,refresh_token:refreshToken,scope:grant.scopes.join(' ')};
  }
  if(body.grant_type==='refresh_token'){
    if(typeof body.client_id!=='string'||body.resource!==RESOURCE_URL||typeof body.refresh_token!=='string')fail('INVALID_GRANT',400);
    const accessToken=randomToken(),refreshToken=randomToken();
    const grant=await rpc('refresh',{clientId:body.client_id,resource:body.resource,refreshHash:tokenHash(body.refresh_token),newAccessHash:digest(accessToken),newRefreshHash:digest(refreshToken)});
    return {access_token:accessToken,token_type:'Bearer',expires_in:900,refresh_token:refreshToken,scope:grant.scopes.join(' ')};
  }
  fail('UNSUPPORTED_GRANT_TYPE',400);
}
async function actorFor(headers,scope){
  const match=(headers.authorization||'').match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/i);
  if(!match)fail('MCP_AUTH_REQUIRED',401);
  const grant=await rpc('access',{accessHash:digest(match[1])});
  if(grant.resource!==RESOURCE_URL)fail('INVALID_AUDIENCE',401);
  if(!Array.isArray(grant.scopes)||!grant.scopes.includes(scope))fail('INSUFFICIENT_SCOPE',403);
  return {actorUid:grant.actorUid,scopes:grant.scopes};
}
async function invokeAssistant(actorUid,input){
  const issuedAt=Date.now(),nonce=b64url(crypto.randomBytes(24));
  const scope='knowledge:mcp';
  const payloadHash=digest(canonicalJson(input));
  const audience='crm-assistant';
  const signature=crypto.createHmac('sha256',HMAC_KEY).update(`${actorUid}\n${scope}\n${audience}\n${issuedAt}\n${nonce}\n${payloadHash}`).digest('hex');
  const result=await appClient().callFunction({name:'assistant',data:{action:'knowledgeMcpInternal',assertion:{actorUid,scope,audience,issuedAt,nonce,payloadHash,signature},input}});
  if(!result?.result)fail('MCP_UPSTREAM_FAILED',502);
  return result.result;
}
function compactList(result){
  const rows=[];
  for(const [table,key] of [['knowledge_items','knowledge'],['playbooks','playbooks']])for(const row of result?.[key]||[]){
    rows.push({table,id:String(row.id),title:String(row.title||row.source||row.scenario||''),
      updatedAt:row.updatedAt||row.updated_at||null,systemOriginalPresent:Boolean((row.content||row.response_logic||'').trim()),
      gptSummaryPresent:Boolean(row.gpt_summary_preview)});
  }
  const coverage=result?.coverage||{};
  const hasMore=coverage.hasMore||{};
  const safeResult={ok:result?.ok===true,rows,coverage,truncated:Object.values(hasMore).some(Boolean),
    note:'Use nextOffsets and hasMore to finish the scan; the final page is only complete when all hasMore values are false.'};
  if(result?.ok!==true){
    const rawCode=result?.error?.code;
    const code=typeof rawCode==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(rawCode)?rawCode:'MCP_OPERATION_FAILED';
    const diagnostic=result?.error?.diagnostic;
    safeResult.error={code,...(diagnostic&&typeof diagnostic==='object'?{
      diagnostic:{
        ...(typeof diagnostic.recognizedTool==='boolean'?{recognizedTool:diagnostic.recognizedTool}:{}),
        ...(typeof diagnostic.toolName==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(diagnostic.toolName)?{toolName:diagnostic.toolName}:{}),
        ...(Number.isSafeInteger(diagnostic.fieldCount)&&diagnostic.fieldCount>=0?{fieldCount:diagnostic.fieldCount}:{}),
      }
    }:{})};
  }
  return safeResult;
}
const TOOLS=[
 {name:'knowledge_records_list',description:'List one bounded page of CRM knowledge records and GPT coverage. Repeat with returned nextOffsets until all hasMore values are false.',securitySchemes:[{type:'oauth2',scopes:['knowledge:read']}],inputSchema:{type:'object',properties:{sourceOffset:{type:'integer',minimum:0},knowledgeOffset:{type:'integer',minimum:0},playbookOffset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},},additionalProperties:false}},
 {name:'knowledge_record_get',description:'Read text fields for one CRM knowledge record selected by exact table and record ID. Returns the stored system original and GPT summary only; it never reads linked files.',securitySchemes:[{type:'oauth2',scopes:['knowledge:read']}],inputSchema:{type:'object',properties:{table:{type:'string',enum:['knowledge_items','playbooks']},id:{type:'string',pattern:'^[1-9][0-9]*$'}},required:['table','id'],additionalProperties:false}},
 {name:'knowledge_generate_gpt_pending',description:'Generate a GPT summary only from stored system original text and save it directly to the exact record ID. Does not read files or images, generate GPT original text, or alter system content.',securitySchemes:[{type:'oauth2',scopes:['knowledge:read','knowledge:gpt:submit']}],inputSchema:{type:'object',properties:{table:{type:'string',enum:['knowledge_items','playbooks']},id:{type:'string',pattern:'^[1-9][0-9]*$'},expectedUpdatedAt:{type:'string',format:'date-time'}},required:['table','id','expectedUpdatedAt'],additionalProperties:false}},
];
async function mcp(req){
  const rpcMsg=req.body;
  if(!rpcMsg||rpcMsg.jsonrpc!=='2.0'||typeof rpcMsg.method!=='string')return response(400,{jsonrpc:'2.0',id:rpcMsg?.id??null,error:{code:-32600,message:'Invalid Request'}});
  const id=rpcMsg.id??null;
  const meta=rpcMsg.params?._meta||{},modern=meta['io.modelcontextprotocol/protocolVersion']==='2026-07-28'||req.headers['mcp-protocol-version']==='2026-07-28';
  if(rpcMsg.method==='server/discover')return response(200,{jsonrpc:'2.0',id,result:{supportedVersions:['2026-07-28'],capabilities:{tools:{listChanged:false}},ttlMs:0,cacheScope:'private'},
    ...(modern?{_meta:{'io.modelcontextprotocol/serverInfo':{name:'crm-knowledge',version:'1.0.0'}}}:{})});
  if(modern){
    if(req.headers['mcp-protocol-version']!=='2026-07-28'||req.headers['mcp-method']!==rpcMsg.method)fail('MCP_PROTOCOL_MISMATCH',400);
    if(rpcMsg.method==='tools/call'&&req.headers['mcp-name']!==rpcMsg.params?.name)fail('MCP_PROTOCOL_MISMATCH',400);
  }
  const {actorUid,scopes}=await actorFor(req.headers,'knowledge:read');
  if(rpcMsg.method==='notifications/initialized')return response(202,'',{'Content-Type':'application/json'});
  if(rpcMsg.method==='initialize'){
    const supported=['2025-11-25','2025-06-18','2025-03-26'];
    const requested=rpcMsg.params?.protocolVersion;
    const protocolVersion=supported.includes(requested)?requested:supported[0];
    return response(200,{jsonrpc:'2.0',id,result:{protocolVersion,capabilities:{tools:{listChanged:false}},serverInfo:{name:'crm-knowledge',version:'1.0.0'}}});
  }
  if(rpcMsg.method==='ping')return response(200,{jsonrpc:'2.0',id,result:{}});
  if(rpcMsg.method==='tools/list')return response(200,{jsonrpc:'2.0',id,result:{tools:TOOLS,...(modern?{ttlMs:0,cacheScope:'private'}:{})},
    ...(modern?{_meta:{'io.modelcontextprotocol/serverInfo':{name:'crm-knowledge',version:'1.0.0'}}}:{})});
  if(rpcMsg.method==='tools/call'){
    const name=rpcMsg.params?.name,args=rpcMsg.params?.arguments||{};
    const tool=TOOLS.find(t=>t.name===name);
    if(!tool)return response(200,{jsonrpc:'2.0',id,error:{code:-32602,message:'Unknown tool'}});
    if(name==='knowledge_generate_gpt_pending'&&!scopes.includes('knowledge:gpt:submit'))return toolAuthError(id,'INSUFFICIENT_SCOPE',['knowledge:read','knowledge:gpt:submit']);
    if(name==='knowledge_records_list'&&Object.entries(args).some(([k,v])=>!['sourceOffset','knowledgeOffset','playbookOffset','limit'].includes(k)||!Number.isSafeInteger(v)||v<0||(k==='limit'&&(v<1||v>100))))fail('INVALID_ARGUMENTS',400);
    if(name==='knowledge_record_get'&&(!['knowledge_items','playbooks'].includes(args.table)||!/^[1-9][0-9]*$/.test(String(args.id))))fail('INVALID_ARGUMENTS',400);
    if(name==='knowledge_generate_gpt_pending'&&(!['knowledge_items','playbooks'].includes(args.table)||!/^[1-9][0-9]*$/.test(String(args.id))||typeof args.expectedUpdatedAt!=='string'))fail('INVALID_ARGUMENTS',400);
    if(name==='knowledge_generation_status'&&!/^[0-9a-f-]{36}$/i.test(String(args.commandId)))fail('INVALID_ARGUMENTS',400);
    const input={tool:name,...args};
    const result=await invokeAssistant(actorUid,input);
    let safeResult=result;
    if(name==='knowledge_records_list')safeResult=compactList(result);
    if(name==='knowledge_record_get'&&result?.record){
      const record=result.record;
      safeResult={ok:result.ok===true,record:{table:record.table,id:String(record.id),title:record.title||'',updatedAt:record.updatedAt,
        systemOriginalText:record.original?.text||'',gptSummary:record.gpt?.summary||null,
        selected:record.selected,version:record.version,lifecycleStatus:record.lifecycleStatus},
        };
    }
    return response(200,{jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(safeResult)}],isError:safeResult?.ok===false},
      ...(modern?{_meta:{'io.modelcontextprotocol/serverInfo':{name:'crm-knowledge',version:'1.0.0'}}}:{})});
  }
  return response(200,{jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
}
async function main(event,context){
  const req=requestInfo(event,context),path=req.url.pathname;
  try{
    if(req.method==='OPTIONS')return response(204,'');
    if(path==='/health')return response(200,{ok:true});
    if(path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/mcp/knowledge'){
      requiredConfig();return response(200,{resource:RESOURCE_URL,authorization_servers:[ISSUER_URL],scopes_supported:SCOPES,bearer_methods_supported:['header']});
    }
    if(path===issuerMetadataPath()){
      requiredConfig();const oauthBase=new URL(ISSUER_URL).origin;
      return response(200,{issuer:ISSUER_URL,authorization_endpoint:`${oauthBase}${OAUTH_PATH}/authorize`,
        token_endpoint:`${oauthBase}${OAUTH_PATH}/token`,revocation_endpoint:`${oauthBase}${OAUTH_PATH}/revoke`,
        registration_endpoint:`${oauthBase}${OAUTH_PATH}/register`,authorization_response_iss_parameter_supported:true,
        response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
        code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:SCOPES});
    }
    if(path===`${OAUTH_PATH}/register`&&req.method==='POST'){
      requiredConfig();
      if(!Array.isArray(req.body.redirect_uris)||req.body.redirect_uris.length!==1||
        !Array.isArray(req.body.grant_types)||req.body.grant_types.length!==2||
        !['authorization_code','refresh_token'].every(value=>req.body.grant_types.includes(value))||
        !Array.isArray(req.body.response_types)||req.body.response_types.length!==1||!req.body.response_types.includes('code')||
        (req.body.token_endpoint_auth_method&&req.body.token_endpoint_auth_method!=='none'))fail('INVALID_CLIENT_METADATA');
      const redirectUri=req.body.redirect_uris[0];
      if(!isAllowedRedirectUri(redirectUri))fail('INVALID_CLIENT_METADATA');
      const clientId=`crmkmcp_${b64url(crypto.randomBytes(18))}`;
      const created=await rpc('register',{clientId,clientName:String(req.body.client_name||'CRM Knowledge MCP').slice(0,100),redirectUris:[redirectUri]});
      if(created.clientId!==clientId||created.redirectUri!==redirectUri)fail('MCP_REGISTRATION_FAILED',502);
      return response(201,{client_id:created.clientId,client_name:'CRM Knowledge MCP',redirect_uris:[created.redirectUri],
        grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',client_id_issued_at:Math.floor(Date.now()/1000)});
    }
    if(path===`${OAUTH_PATH}/authorize`&&req.method==='GET'){
      requiredConfig();
      const clientId=req.url.searchParams.get('client_id'),redirectUri=req.url.searchParams.get('redirect_uri'),resource=req.url.searchParams.get('resource');
      const state=req.url.searchParams.get('state'),challenge=req.url.searchParams.get('code_challenge'),scope=(req.url.searchParams.get('scope')||'').split(/\s+/).filter(Boolean);
      if(!clientId||!redirectUri||resource!==RESOURCE_URL||req.url.searchParams.get('response_type')!=='code'||
         req.url.searchParams.get('code_challenge_method')!=='S256'||!(state&&state.length<=1024)||
         !/^[A-Za-z0-9_-]{43}$/.test(challenge||'')||!scope.includes('knowledge:read')||scope.some(s=>!SCOPES.includes(s))||new Set(scope).size!==scope.length)fail('INVALID_OAUTH_REQUEST');
      await rpc('validate_client',{clientId,redirectUri});
      const redirect=new URL(CONSENT_URI);
      for(const [k,v]of req.url.searchParams)redirect.searchParams.set(k,v);
      redirect.searchParams.set('oauth_issuer',ISSUER_URL);
      return response(302,'',{'Location':redirect.toString()});
    }
    if(path===`${OAUTH_PATH}/token`&&req.method==='POST')return response(200,await oauthToken(req.body));
    if(path===`${OAUTH_PATH}/revoke`&&req.method==='POST'){
      requiredConfig();
      if(typeof req.body.client_id!=='string'||typeof req.body.token!=='string')fail('INVALID_REQUEST');
      await rpc('revoke',{clientId:req.body.client_id,tokenHash:tokenHash(req.body.token)});return response(200,{});
    }
    if(path===MCP_PATH&&req.method==='POST'){
      return await mcp(req);
    }
    const methods={'/health':'GET','/.well-known/oauth-protected-resource':'GET',
      '/.well-known/oauth-protected-resource/mcp/knowledge':'GET',[issuerMetadataPath()]:'GET',
      [`${OAUTH_PATH}/register`]:'POST',[`${OAUTH_PATH}/authorize`]:'GET',[`${OAUTH_PATH}/token`]:'POST',
      [`${OAUTH_PATH}/revoke`]:'POST',[MCP_PATH]:'POST'};
    if(methods[path])return response(405,{error:'METHOD_NOT_ALLOWED'},{Allow:methods[path]});
    return response(404,{error:'Not found'});
  }catch(error){
    const status=error.status||400,code=error.code||'MCP_REQUEST_FAILED';
    const oauthError=code==='MCP_INVALID_GRANT'?'invalid_grant':code==='MCP_SERVICE_NOT_CONFIGURED'?'server_error':
      code==='UNSUPPORTED_GRANT_TYPE'?'unsupported_grant_type':code==='INVALID_CLIENT'||code==='MCP_INVALID_CLIENT'?'invalid_client':'invalid_request';
    let metadataUrl='';try{const resource=new URL(RESOURCE_URL);metadataUrl=`${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;}catch(_){}
    const headers=status===401?{'WWW-Authenticate':`Bearer resource_metadata="${metadataUrl}", error="invalid_token"`}:status===403&&code==='INSUFFICIENT_SCOPE'?
      {'WWW-Authenticate':`Bearer resource_metadata="${metadataUrl}", error="insufficient_scope", scope="knowledge:read knowledge:gpt:submit"`}:{};
    return response(status,{error:path.startsWith(`${OAUTH_PATH}/`)?oauthError:code},headers);
  }
}

function createHttpServer({port=9000}={}) {
  const server=http.createServer((req,res)=>{
    const chunks=[];let size=0,tooLarge=false;
    req.on('data',chunk=>{
      if(tooLarge)return;
      size+=chunk.length;
      if(size>1024*1024){tooLarge=true;chunks.length=0;return;}
      chunks.push(chunk);
    });
    req.on('end',async()=>{
      if(tooLarge){res.writeHead(413,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'REQUEST_TOO_LARGE'}));return;}
      const body=Buffer.concat(chunks).toString('utf8');
      const host=String(req.headers.host||'localhost');
      const url=`https://${host}${req.url||'/'}`;
      try{
        const result=await main({httpMethod:req.method,url,headers:req.headers,body},{httpContext:{url,httpMethod:req.method,headers:req.headers}});
        const status=Number.isInteger(result?.statusCode)?result.statusCode:200;
        res.writeHead(status,result?.headers||{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        res.end(typeof result?.body==='string'?result.body:JSON.stringify(result?.body??{}));
      }catch(_){
        res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        res.end(JSON.stringify({error:'INTERNAL_ERROR'}));
      }
    });
  });
  server.listen(port);
  return server;
}

if(require.main===module)createHttpServer();
exports.main=main;
exports.createHttpServer=createHttpServer;
exports.isAllowedRedirectUri=isAllowedRedirectUri;
