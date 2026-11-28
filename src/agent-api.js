// The agent API: a stable, documented contract for programs on this computer,
// from any provider. Each operation's JSON Schema validates its input and is
// published in the OpenAPI description, so the description is always what the
// server accepts. Operations translate into the app's own commands, which still
// perform every check; this layer never writes storage itself.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {recordBrowse} from './web/record-query.js';
import {RECORD_TYPES,STATUSES} from './web/record-types.js';
import {RELATION_TYPES} from './web/record-model.js';
import {WORKFLOW_ROLES,workflowRole} from './web/record-workflow.js';
import {markdownRichText,richTextForAgents,agentRichText} from './agent-markdown.js';
import {AGENT_APP_GUIDE} from './agent-app-guide.js';

export const AGENT_API_VERSION='1.0.0';
const UUID='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
const id={type:'string',pattern:UUID},nullableId={type:['string','null'],pattern:UUID};
const cursor={type:['string','null'],maxLength:4096,description:'Opaque cursor from the previous page, or null for the first page.'};
const limit=max=>({type:'integer',minimum:1,maximum:max,description:'Items per page, at most '+max+'.'});
const markdown={type:'string',maxLength:60000,description:'Text in a small Markdown: # to ### headings, paragraphs, - and 1. lists, > quotes, ``` code blocks, **bold**, *italic*, `code` and [label](https://...) links. HTML is kept as text.'};
const date={type:['string','null'],pattern:'^\\d{4}-\\d{2}-\\d{2}$',description:'The day the work happened (YYYY-MM-DD), or null when unknown.'};
const sectionInput={type:'object',additionalProperties:false,required:['title'],properties:{id:{...id,description:'Keep an existing section by its id; omit for a new section.'},title:{type:'string',minLength:1,maxLength:160},text:markdown}};
const recordFields={
 type:{type:'string',enum:RECORD_TYPES.map(type=>type.id)},
 title:{type:'string',minLength:1,maxLength:180},
 status:{type:'string',enum:[...STATUSES]},
 tags:{type:'array',maxItems:64,items:{type:'string',minLength:1,maxLength:40}},
 occurredOn:date,text:markdown,
 sections:{type:'array',maxItems:200,items:sectionInput,description:'The full list of sections, in order. Sections left out are removed.'}
};
const book={projectId:id,labBookId:id};
const OVERVIEW_LAB_BOOKS=50;
const recordOutput={type:'object',properties:{
 id,revision:{type:'string',description:'Pass this as expectedRevision when you update the record.'},type:{type:'string'},title:{type:'string'},status:{type:'string'},tags:{type:'array',items:{type:'string'}},
 occurredOn:{type:['string','object']},text:{type:'string',description:'The record text as plain text.'},
 sections:{type:'array',items:{type:'object',properties:{id,title:{type:'string'},text:{type:'string'}}}},
 links:{type:'array',items:{type:'object',properties:{id,type:{type:'string'},role:{type:['string','null']},label:{type:'string'},recordId:id,sameLabBook:{type:'boolean'}}}},createdAt:{type:'string'},updatedAt:{type:'string'}}};
const written={type:'object',properties:{id,revision:{type:'string'},title:{type:'string'}}};

export const AGENT_OPERATIONS=Object.freeze([
 {name:'me',method:'GET',access:'read',summary:'Describe this key: its name, workspace, scope, access and expiry.',output:{type:'object'}},
 {name:'projects/list',method:'POST',access:'read',summary:'List the projects this key can reach, one page at a time.',
  input:{type:'object',additionalProperties:false,properties:{parentId:{...nullableId,description:'List the projects inside this project; null lists the top level.'},cursor,limit:limit(50)}},
  output:{type:'object',properties:{projects:{type:'array',items:{type:'object',properties:{projectId:id,parentId:nullableId,title:{type:'string'},description:{type:'string'},kind:{type:'string'}}}},nextCursor:cursor}}},
 {name:'workspace/overview',method:'POST',access:'read',summary:'List the projects this key can reach, each with its lab books and their record counts, a page of projects at a time.',
  description:'Each project lists up to '+OVERVIEW_LAB_BOOKS+' lab books; when it has more, labBooksCursor is set: pass it as cursor to lab-books/list for the rest. recordCount is null when a lab book cannot be read now, for example while it is locked with its own password; labBooks is null when the project itself cannot be read now.',
  input:{type:'object',additionalProperties:false,properties:{cursor,limit:limit(20)}},
  output:{type:'object',properties:{projects:{type:'array',items:{type:'object',properties:{projectId:id,parentId:nullableId,title:{type:'string'},kind:{type:['string','null']},
   labBooks:{type:['array','null'],items:{type:'object',properties:{labBookId:id,title:{type:'string'},recordCount:{type:['integer','null']}}}},labBooksCursor:cursor}}},nextCursor:cursor}}},
 {name:'lab-books/list',method:'POST',access:'read',summary:'List the lab books of a project.',
  input:{type:'object',additionalProperties:false,required:['projectId'],properties:{projectId:id,cursor,limit:limit(50)}},
  output:{type:'object',properties:{labBooks:{type:'array',items:{type:'object',properties:{labBookId:id,title:{type:'string'}}}},nextCursor:cursor}}},
 {name:'lab-books/create',method:'POST',access:'write',summary:'Create a lab book in a project. It opens with the same access as the rest of the workspace; no password is involved.',
  input:{type:'object',additionalProperties:false,required:['projectId','title'],properties:{projectId:id,title:{type:'string',minLength:1,maxLength:120,description:'The lab book name; it is also its folder name, so it must be unique in the project.'}}},
  output:{type:'object',properties:{labBookId:id,title:{type:'string'}}}},
 {name:'records/list',method:'POST',access:'read',summary:'List the records of a lab book, optionally matching search text.',
  input:{type:'object',additionalProperties:false,required:['projectId','labBookId'],properties:{...book,search:{type:'string',maxLength:512},cursor,limit:limit(100)}},
  output:{type:'object',properties:{records:{type:'array',items:{type:'object'}},nextCursor:cursor,total:{type:'integer'}}}},
 {name:'records/get',method:'POST',access:'read',summary:'Read one record, with its revision.',
  input:{type:'object',additionalProperties:false,required:['projectId','labBookId','recordId'],properties:{...book,recordId:id}},output:recordOutput},
 {name:'records/create',method:'POST',access:'write',summary:'Create a record in a lab book.',
  input:{type:'object',additionalProperties:false,required:['projectId','labBookId','record'],properties:{...book,record:{type:'object',additionalProperties:false,required:['type','title'],properties:recordFields}}},
  output:{type:'object',properties:{id,revision:{type:'string'},title:{type:'string'}}}},
 {name:'records/update',method:'POST',access:'write',summary:'Change a record. Only the fields you send change; expectedRevision must be the revision you last read.',
  input:{type:'object',additionalProperties:false,required:['projectId','labBookId','recordId','expectedRevision','changes'],properties:{...book,recordId:id,expectedRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},changes:{type:'object',additionalProperties:false,minProperties:1,properties:recordFields}}},
  output:{type:'object',properties:{id,revision:{type:'string'},title:{type:'string'}}}},
 {name:'records/link',method:'POST',access:'write',summary:'Link a record to another record, in the same lab book or another lab book of the same project.',
  input:{type:'object',additionalProperties:false,required:['projectId','labBookId','recordId','expectedRevision','link'],properties:{...book,recordId:id,expectedRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},
   link:{type:'object',additionalProperties:false,required:['recordId'],properties:{type:{type:'string',minLength:1,maxLength:80,description:'How the records relate, for example: '+RELATION_TYPES.join(', ')+'. Defaults to Related to, or to the name of its role.'},role:{type:'string',enum:WORKFLOW_ROLES.map(role=>role.id),description:'A workflow role, as in the app: run-of links a run to its investigation (one per run; a new one replaces it), follows-run links a run to the run before it, uses-method and compares point at the current saved revision of the target.'},recordId:{...id,description:'The record to link to.'},labBookId:{...id,description:'Its lab book, when it is not this one. It must be in the same project.'}}}}},
  output:{type:'object',properties:{id,revision:{type:'string'},title:{type:'string'},linkId:id}}},
 {name:'records/unlink',method:'POST',access:'write',summary:'Remove a link from a record.',
  input:{type:'object',additionalProperties:false,required:['projectId','labBookId','recordId','expectedRevision','linkId'],properties:{...book,recordId:id,expectedRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},linkId:id}},
  output:written},
 {name:'files/attach',method:'POST',access:'write',activity:null,summary:'Bring files from a folder on this computer into a record. Observanda checks and copies them in the background; then call files/apply.',
  description:'The folder must be outside the workspace. Each path is relative to it, with forward slashes. The files are hashed now and checked again before they are copied; a file that changes stops the attachment.',
  input:{type:'object',additionalProperties:false,required:['projectId','labBookId','recordId','expectedRevision','source','paths','title'],properties:{...book,recordId:id,expectedRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},
   source:{type:'string',minLength:1,maxLength:4096,description:'Absolute path of the folder holding the files.'},paths:{type:'array',minItems:1,maxItems:1000,items:{type:'string',minLength:1,maxLength:1024}},
   title:{type:'string',minLength:1,maxLength:300,description:'What these files are, as shown on the record.'},purpose:{type:'string',enum:['evidence','preparation','analysis'],description:'Defaults to evidence.'},
   method:{type:'string',maxLength:3000},tool:{type:'string',maxLength:200},toolVersion:{type:'string',maxLength:200},sourceRevision:{type:'string',maxLength:500,description:'For example the commit the files came from.'}}},
  output:{type:'object',properties:{id,title:{type:'string'},proposalId:id,pin:{type:'string'},state:{type:'string'}}}},
 {name:'files/status',method:'POST',access:'read',summary:'See how an attachment is progressing: staging, prepared (ready for files/apply), applying or completed.',
  input:{type:'object',additionalProperties:false,required:['projectId','labBookId','recordId','proposalId'],properties:{...book,recordId:id,proposalId:id}},
  output:{type:'object',properties:{id,proposalId:id,pin:{type:'string'},state:{type:'string'},files:{type:'array'},job:{type:['object','null']},completed:{type:'boolean'}}}},
 {name:'files/apply',method:'POST',access:'write',activity:'files/attach',summary:'Add prepared files to the record. Call it once files/status reports prepared.',
  input:{type:'object',additionalProperties:false,required:['projectId','labBookId','recordId','proposalId','pin'],properties:{...book,recordId:id,proposalId:id,pin:{type:'string',pattern:'^[a-f0-9]{64}$'}}},
  output:{type:'object',properties:{id,title:{type:'string'},proposalId:id,state:{type:'string'}}}}
]);
const byName=new Map(AGENT_OPERATIONS.map(operation=>[operation.name,operation]));

// The subset of JSON Schema used above, checked exactly as published.
function check(schema,value,at='input'){
 const fail=()=>{throw new AppError('INVALID',[{field:at}]);};
 const types=[].concat(schema.type??[]);
 if(types.length&&!types.some(type=>type==='null'?value===null:type==='integer'?Number.isSafeInteger(value):type==='array'?Array.isArray(value):type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):typeof value===type))fail();
 if(value===null)return;
 if(schema.enum&&!schema.enum.includes(value))fail();
 if(typeof value==='string'){if(value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)||schema.pattern&&!new RegExp(schema.pattern).test(value))fail();}
 if(typeof value==='number'&&(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))fail();
 if(Array.isArray(value)){if(value.length>(schema.maxItems??Infinity))fail();value.forEach((item,index)=>check(schema.items,item,at+'['+index+']'));}
 if(types.includes('object')&&schema.properties){
  if(schema.additionalProperties===false&&Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key)))fail();
  if((schema.required??[]).some(key=>!Object.hasOwn(value,key))||Object.keys(value).length<(schema.minProperties??0))fail();
  for(const [key,property] of Object.entries(schema.properties))if(Object.hasOwn(value,key))check(property,value[key],at+'.'+key);
 }
}

export function agentRoute(method,pathname){
 if(pathname==='/api/v1/openapi.json')return method==='GET'?{description:true}:null;
 const match=/^\/api\/v1\/agent\/([a-z-]+(?:\/[a-z-]+)?)$/.exec(pathname),operation=match&&byName.get(match[1]);
 return operation&&operation.method===method?{operation}:null;
}
const forbidden=()=>{throw new AppError('AGENT_KEY_SCOPE');};
function inScope(key,{projectId=null,labBookId=null}){
 if(key.scope.kind==='workspace')return true;
 if(projectId!==key.scope.projectId)return false;
 return key.scope.kind==='project'||labBookId===null||labBookId===key.scope.labBookId;
}
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function decode(value){if(value==null)return null;try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{throw new AppError('INVALID',[{field:'input.cursor'}]);}}
const dateValue=value=>value===null?{kind:'unknown'}:value;
const dateOutput=value=>typeof value==='string'?value:value?.kind==='unknown'?null:value;

// Every project the key reaches, with its lab books and record counts. A count is
// the lab book's own revision read (no record is loaded); a book that cannot be
// read now, such as one locked with its own password, has a null count.
async function overview(input,{key,run}){
 const page=decode(input.cursor)??{offset:0},size=input.limit??10;if(!Number.isSafeInteger(page.offset)||page.offset<0)throw new AppError('INVALID',[{field:'input.cursor'}]);
 const projectEntry=project=>({projectId:project.projectId,parentId:project.parentId??null,title:project.summary?.title??'',kind:project.summary?.kind??null});
 let projects,nextCursor=null;
 if(key.scope.kind==='workspace'){
  const value=await run('/api/projects/list',{offset:page.offset,limit:size,revision:null});
  projects=value.projects.map(projectEntry);
  nextCursor=page.offset+value.projects.length<value.total?encode({offset:page.offset+value.projects.length}):null;
 }else{
  // A project or lab book key reaches one project: find it, whatever its place in the list.
  projects=[];
  for(let offset=0;page.offset===0;){
   const value=await run('/api/projects/list',{offset,limit:100,revision:null}),found=value.projects.find(project=>project.projectId===key.scope.projectId);
   if(found){projects=[projectEntry(found)];break;}
   offset+=value.projects.length;if(!value.projects.length||offset>=value.total)break;
  }
 }
 const unreadable=error=>{if(['SERVER_CLOSING','WORKSPACE_CHANGED'].includes(error.code))throw error;return null;};
 const recordCount=async(projectId,item)=>{
  try{const value=await run('/api/projects/'+projectId+'/lab-books/'+item.labBookId+'/workspace/read/version',{workspaceId:item.namespaceId});return Number.isSafeInteger(value?.recordCount)?value.recordCount:null;}
  catch(error){return unreadable(error);}
 };
 // A lab book key reaches one lab book: its project's list is read until it is found.
 const books=async projectId=>{
  if(key.scope.kind!=='lab-book')return run('/api/projects/'+projectId+'/lab-books/list',{after:null,limit:OVERVIEW_LAB_BOOKS,revision:null});
  for(let after=null;;){
   const value=await run('/api/projects/'+projectId+'/lab-books/list',{after,limit:100,revision:null}),found=value.items.filter(item=>item.labBookId===key.scope.labBookId);
   if(found.length||!value.next)return {items:found,next:null};after=value.next;
  }
 };
 for(const project of projects){
  const value=await books(project.projectId).catch(unreadable),labBooks=[];
  if(!value){Object.assign(project,{labBooks:null,labBooksCursor:null});continue;}
  for(const item of value.items.filter(item=>inScope(key,{projectId:project.projectId,labBookId:item.labBookId})))labBooks.push({labBookId:item.labBookId,title:item.directory,recordCount:await recordCount(project.projectId,item)});
  Object.assign(project,{labBooks,labBooksCursor:value.next??null});
 }
 return {projects,nextCursor};
}

// run(route,data) executes one of the app's own commands through the owner's
// session; the server enforces the key's read or write access on each command.
export async function runAgentOperation(operation,input,{key,run,now=()=>new Date()}){
 if(operation.access==='write'&&key.access!=='write')forbidden();
 if(operation.input)check(operation.input,input??{});else if(input!==undefined&&input!==null)throw new AppError('INVALID');
 if(operation.name==='me')return {name:key.name,workspaceId:key.workspaceId,scope:key.scope,access:key.access,expiresAt:key.expiresAt,apiVersion:AGENT_API_VERSION};
 if(!inScope(key,{projectId:input.projectId??(operation.name==='projects/list'?key.scope.projectId??null:null),labBookId:input.labBookId??null})&&!['projects/list','workspace/overview'].includes(operation.name))forbidden();
 if(operation.name==='projects/list'){
  const page=decode(input.cursor)??{offset:0},size=input.limit??50;if(!Number.isSafeInteger(page.offset)||page.offset<0)throw new AppError('INVALID',[{field:'input.cursor'}]);
  const value=await run('/api/projects/list',{parentId:input.parentId??null,offset:page.offset,limit:size,revision:null});
  const projects=value.projects.filter(project=>inScope(key,{projectId:project.projectId})).map(project=>({projectId:project.projectId,parentId:project.parentId,title:project.summary.title,description:project.summary.description,kind:project.summary.kind}));
  return {projects,nextCursor:page.offset+value.projects.length<value.total?encode({offset:page.offset+value.projects.length}):null};
 }
 if(operation.name==='workspace/overview')return overview(input,{key,run});
 if(operation.name==='lab-books/list'){
  const value=await run('/api/projects/'+input.projectId+'/lab-books/list',{after:input.cursor??null,limit:input.limit??50,revision:null});
  return {labBooks:value.items.filter(item=>inScope(key,{projectId:input.projectId,labBookId:item.labBookId})).map(item=>({labBookId:item.labBookId,title:item.directory})),nextCursor:value.next??null};
 }
 if(operation.name==='lab-books/create'){
  // A key for one lab book cannot add lab books to its project.
  if(key.scope.kind==='lab-book')forbidden();
  const labBookId=randomUUID(),result=await run('/api/projects/'+input.projectId+'/lab-books/create',{id:randomUUID(),book:{id:labBookId,title:input.title,projectId:input.projectId},username:'',password:''});
  return {labBookId:result?.book?.labBookId??labBookId,title:input.title};
 }
 const prefix='/api/projects/'+input.projectId+'/lab-books/'+input.labBookId;
 const start=await run(prefix+'/workspace/read/start',{}),workspaceId=start.metadata.id;
 const read=async recordId=>{
  const value=await run(prefix+'/workspace/read/selection',{workspaceId,ids:[recordId]}),record=value.book?.entries?.find(entry=>entry.id===recordId);
  if(!record)throw new AppError('NOT_FOUND');return {record,revision:value.recordRevisions[recordId]};
 };
 if(operation.name==='records/list'){
  const value=await run(prefix+'/research/records/query',{workspaceId,query:{projectId:null,notebookId:null,filter:'all',search:input.search??'',browse:recordBrowse()},cursor:input.cursor??null,limit:input.limit??25});
  return {records:value.records.map(item=>({id:item.id,type:item.type,title:item.title,status:item.status,updatedAt:item.updatedAt})),nextCursor:value.nextCursor??null,total:value.total};
 }
 if(operation.name==='records/get'){
  const {record,revision}=await read(input.recordId);
  return {id:record.id,revision,type:record.type,title:record.title,status:record.status,tags:record.tags,occurredOn:dateOutput(record.occurredOn),text:richTextForAgents(record.body),
   sections:record.sections.map(section=>({id:section.id,title:section.title,text:richTextForAgents(section.body)})),
   links:record.relations.filter(link=>link.target.kind==='record').map(link=>({id:link.id,type:link.type,role:link.role??null,label:link.label,recordId:link.target.id,sameLabBook:link.target.workspaceId===workspaceId})),createdAt:record.createdAt,updatedAt:record.updatedAt};
 }
 const sections=(values,existing=[])=>values.map(section=>{
  if(section.id&&!existing.some(item=>item.id===section.id))throw new AppError('INVALID',[{field:'sections'}]);
  // A section sent back as it was read keeps its stored text, figures and tables included.
  const stored=section.id?existing.find(item=>item.id===section.id).body:undefined;
  return {id:section.id??randomUUID(),title:section.title,body:agentRichText(section.text??'',stored)};
 });
 const apply=(record,fields)=>{
  const next={...record};
  for(const key of ['type','title','status','tags'])if(Object.hasOwn(fields,key))next[key]=fields[key];
  if(Object.hasOwn(fields,'occurredOn'))next.occurredOn=dateValue(fields.occurredOn);
  if(Object.hasOwn(fields,'text'))next.body=agentRichText(fields.text,record.body);
  if(Object.hasOwn(fields,'sections'))next.sections=sections(fields.sections,record.sections);
  return next;
 };
 const save=async(recordId,expectedRevision,record)=>{
  // A receipt, not the saved workspace: the record is read back on its own below,
  // and a workspace of any size can be written.
  await run(prefix+'/research/records/save',{workspaceId,changes:[{id:recordId,expectedRevision,record}],receipt:true});
  const saved=await read(recordId);return {id:recordId,revision:saved.revision,title:saved.record.title};
 };
 const at=now().toISOString();
 if(operation.name==='records/create'){
  const recordId=randomUUID();
  const record=apply({id:recordId,notebookId:input.labBookId,type:'note',title:'',body:markdownRichText(''),contributors:[],relations:[],tags:[],occurredOn:{kind:'unknown'},createdAt:at,updatedAt:at,share:false,figures:[],status:'draft',sections:[],attachments:[]},input.record);
  return save(recordId,null,record);
 }
 const intake=(action,data)=>run(prefix+'/v1/intake/'+action,{version:1,...data});
 const progress=value=>({id:value.recordId,proposalId:value.id,pin:value.pin,state:value.state,files:value.files.map(({path,size,sha256})=>({path,size,sha256})),job:value.job??null,completed:!!value.receipt});
 if(operation.name==='files/attach'){
  const proposalId=randomUUID();
  const built=await intake('builder-review',{id:proposalId,workspaceId,recordId:input.recordId,expectedRevision:input.expectedRevision,source:input.source,paths:input.paths,purpose:input.purpose??'evidence',title:input.title,
   method:input.method??'',tool:input.tool??'',toolVersion:input.toolVersion??'',sourceRevision:input.sourceRevision??'',profile:null,adapter:null});
  const staged=await intake('stage',{source:input.source,workspaceId,recordId:input.recordId,id:proposalId,expectedPin:built.preview.pin,authoredManifest:built.manifest,proof:built.proof});
  return {id:input.recordId,title:built.targetTitle,proposalId,pin:built.preview.pin,state:staged.state};
 }
 if(operation.name==='files/status')return progress(await intake('status',{workspaceId,recordId:input.recordId,id:input.proposalId}));
 if(operation.name==='files/apply'){
  const applied=await intake('apply',{workspaceId,recordId:input.recordId,id:input.proposalId,expectedPin:input.pin});
  return {id:input.recordId,title:(await read(input.recordId)).record.title,proposalId:input.proposalId,state:applied.state};
 }
 if(operation.name==='records/link'){
  const {record,revision}=await read(input.recordId);if(revision!==input.expectedRevision)throw new AppError('RECORD_CHANGED');
  // The target's lab book must be one this key reaches, in the same project.
  const targetBook=input.link.labBookId??input.labBookId;if(!inScope(key,{projectId:input.projectId,labBookId:targetBook}))forbidden();
  const targetPrefix='/api/projects/'+input.projectId+'/lab-books/'+targetBook,targetWorkspace=targetBook===input.labBookId?workspaceId:(await run(targetPrefix+'/workspace/read/start',{})).metadata.id;
  const selected=await run(targetPrefix+'/workspace/read/selection',{workspaceId:targetWorkspace,ids:[input.link.recordId]}),target=selected.book?.entries?.find(entry=>entry.id===input.link.recordId);
  if(!target)throw new AppError('NOT_FOUND');
  // Workflow roles follow the app's rules: a run belongs to one investigation,
  // and exact roles point at the current saved revision of the target.
  const role=input.link.role?workflowRole(input.link.role):null;
  if(role&&(target.id===record.id||(role.id==='run-of'||role.id==='follows-run')&&record.type!=='run'||role.id==='run-of'&&target.type==='run'))throw new AppError('INVALID',[{field:'input.link.role'}]);
  const reference={workspaceId:targetWorkspace,kind:'record',id:target.id,...(role?.exact?{revision:selected.recordRevisions[target.id]}:{})};
  const linkId=randomUUID(),kept=role?.id==='run-of'?record.relations.filter(link=>link.role!=='run-of'):record.relations;
  const relations=[...kept,{id:linkId,type:input.link.type??(role?role.label:'Related to'),...(role?{role:role.id}:{}),target:reference,label:target.title}];
  return {...await save(record.id,revision,{...record,relations,updatedAt:at}),linkId};
 }
 if(operation.name==='records/unlink'){
  const {record,revision}=await read(input.recordId);if(revision!==input.expectedRevision)throw new AppError('RECORD_CHANGED');
  if(!record.relations.some(link=>link.id===input.linkId))throw new AppError('NOT_FOUND');
  return save(record.id,revision,{...record,relations:record.relations.filter(link=>link.id!==input.linkId),updatedAt:at});
 }
 if(operation.name==='records/update'){
  const {record,revision}=await read(input.recordId);
  if(revision!==input.expectedRevision)throw new AppError('RECORD_CHANGED');
  return save(record.id,revision,{...apply(record,input.changes),updatedAt:at});
 }
 throw new AppError('NOT_FOUND');
}

// OpenAPI 3.1, served by the installed app, so an agent learns this build's API.
export function agentOpenApi(origin){
 const error={description:'Refused. The body has a stable code, a message and details.',content:{'application/json':{schema:{type:'object',properties:{code:{type:'string'},message:{type:'string'},details:{type:'array'}}}}}};
 const paths={};
 for(const operation of AGENT_OPERATIONS){
  paths['/api/v1/agent/'+operation.name]={[operation.method.toLowerCase()]:{
   operationId:operation.name.replace(/[-/](.)/g,(_,c)=>c.toUpperCase()),summary:operation.summary,
   description:(operation.description?operation.description+' ':'')+(operation.access==='write'?'Needs a key with read and write access.':'Any key may call this within its scope.'),
   security:[{agentKey:[]}],
   ...(operation.input?{requestBody:{required:true,content:{'application/json':{schema:operation.input}}}}:{}),
   responses:{200:{description:'Done.',content:{'application/json':{schema:operation.output}}},422:error,401:error,403:error,404:error,409:error,423:error}
  }};
 }
 const command={name:'command',in:'path',required:true,schema:{type:'string'},description:'The app command, without /api/: for example projects/<projectId>/lab-books/<labBookId>/research/records/values/save, website-files/save or pdf/list.'};
 // The guide sits with the method its commands use, and whole at the top of the description,
 // so no method shows an empty guide.
 const guide=method=>AGENT_APP_GUIDE.filter(step=>step.method===method.toUpperCase());
 const appCommand=method=>({operationId:'appCommand'+method,summary:'Run one of the app\'s own commands, as the owner\'s screens do.',
  description:'Lab book data: projects/... commands (a project or lab book key reaches only its own project or lab book), and for workspace keys the workspace\'s own lab book: workspace/read/..., research/... and GET notebook. Websites: website-files/..., website-record-updates/check|apply and website-analysis/check (workspace keys). PDFs: pdf/... (workspace keys). Reading: GET dashboard. '+
   'The body, the reply and every check are those of the app itself; a read key may run only commands that read. Passwords, keys, devices, preferences and workspace storage are not reachable. Changes are listed under the key\'s name in Preferences, Agents. '+(guide(method).length?'x-observanda-guide lists the main commands with example bodies.':'The main commands, with example bodies, are listed under x-observanda-guide at the top of this description and with the POST method.'),
  security:[{agentKey:[]}],parameters:[command],...(method==='Post'?{requestBody:{required:false,content:{'application/json':{schema:{type:'object'}},'application/octet-stream':{schema:{type:'string',format:'binary'}}}}}:{}),
  responses:{200:{description:'The app\'s own reply.'},422:error,401:error,403:error,404:error,409:error,423:error},
  ...(guide(method).length?{'x-observanda-guide':guide(method)}:{})});
 paths['/api/v1/agent/app/{command}']={get:appCommand('Get'),post:appCommand('Post')};
 return {openapi:'3.1.0',
  info:{title:'Observanda agent API',version:AGENT_API_VERSION,description:'Use Observanda from programs on this computer. The workspace owner creates a key in Observanda (Preferences, Agents); send it as a bearer token. A key works only while its workspace, and the project or lab book it reaches, is unlocked in the app. Every change goes through the same checks as a change made in the app. x-observanda-guide lists the main app commands with example bodies.','x-observanda-guide':AGENT_APP_GUIDE},
  servers:[{url:origin}],
  components:{securitySchemes:{agentKey:{type:'http',scheme:'bearer',description:'An Observanda agent key (obsk_...).'}}},
  paths};
}
