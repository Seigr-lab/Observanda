import {randomUUID} from 'node:crypto';
import {AppError} from '../errors.js';
import {exact,uuid,unique} from '../modules/validation.js';
import {Organizations} from './organizations.js';
import {requireMembership,requireAdministrator,memberOf} from './organization-policy.js';
import {organizationTransaction} from './transaction.js';

const file='.observanda/organizations/content-access.json',limit=4*1024*1024;
const valid=(condition,code='COLLABORATION_INVALID')=>{if(!condition)throw new AppError(code);};
const scope=value=>exact(value,['kind','id'])&&['project','notebook'].includes(value.kind)&&uuid(value.id);
const scopes=value=>Array.isArray(value)&&value.length>0&&value.length<=100&&value.every(scope)&&unique(value.map(s=>s.kind+':'+s.id));
const recipient=value=>exact(value,['kind','id'])&&['member','team'].includes(value.kind)&&uuid(value.id);
export const contentRoles=Object.freeze(['reader','editor']);
function validate(value,workspaceId){
 valid(exact(value,['version','workspaceId','revision','grants'])&&value.version===1&&value.workspaceId===workspaceId&&Number.isSafeInteger(value.revision)&&value.revision>=0&&Array.isArray(value.grants)&&value.grants.length<=2000,'COLLABORATION_DAMAGED');
 valid(unique(value.grants.map(g=>g.id))&&value.grants.every(g=>exact(g,['id','organizationId','scopes','recipient','role','generation','active'])&&uuid(g.id)&&uuid(g.organizationId)&&scopes(g.scopes)&&recipient(g.recipient)&&contentRoles.includes(g.role)&&Number.isSafeInteger(g.generation)&&g.generation>0&&typeof g.active==='boolean'),'COLLABORATION_DAMAGED');
 return value;
}

// Membership alone never grants research access. The unlocked workspace owner
// explicitly assigns scopes; an exchanged file never changes this authority.
export class ContentAccess{
 constructor(workspace){this.workspace=workspace;this.organizations=new Organizations(workspace);}
 async load(){
  const metadata=await this.workspace.catalogue(async store=>(await store.snapshot()).metadata),raw=await this.workspace.readMetadata(file,limit);
  if(raw===null)return {version:1,workspaceId:metadata.id,revision:0,grants:[]};
  try{return validate(JSON.parse(raw),metadata.id);}catch{throw new AppError('COLLABORATION_DAMAGED');}
 }
 async saveLocal(identity,command){
  valid(exact(command,['workspaceId','expectedRevision','id','organizationId','scopes','recipient','role','active'])&&uuid(command.workspaceId)&&Number.isSafeInteger(command.expectedRevision)&&(command.id===null||uuid(command.id))&&uuid(command.organizationId)&&scopes(command.scopes)&&recipient(command.recipient)&&contentRoles.includes(command.role)&&typeof command.active==='boolean');
  return organizationTransaction(this.workspace,async()=>{
   const authority=await this.organizations.load(),actor=this.organizations.principal(authority,identity);
   valid(command.workspaceId===authority.authorityId,'WORKSPACE_CHANGED');requireAdministrator(authority,command.organizationId,actor);
   const state=await this.load();valid(state.revision===command.expectedRevision,'CONFLICT');
   const old=state.grants.find(g=>g.id===command.id);valid(command.id===null||old?.organizationId===command.organizationId,'COLLABORATION_DENIED');
   const {metadata}=await this.workspace.outline();
   if(command.active){
    for(const scope of command.scopes)valid((scope.kind==='project'?metadata.projects:metadata.notebooks).some(item=>item.id===scope.id),'COLLABORATION_SCOPE');
    if(command.recipient.kind==='member')requireMembership(authority,command.organizationId,command.recipient.id);
    else valid(authority.teams.some(team=>team.id===command.recipient.id&&team.organizationId===command.organizationId),'COLLABORATION_DENIED');
   }
   const grant={id:old?.id??randomUUID(),organizationId:command.organizationId,scopes:structuredClone(command.scopes),recipient:command.recipient,role:command.role,generation:(old?.generation??0)+1,active:command.active};
   if(old)state.grants[state.grants.indexOf(old)]=grant;else state.grants.push(grant);
   state.revision++;validate(state,authority.authorityId);await this.workspace.writeMetadata(file,JSON.stringify(state));
   await this.workspace.writeMetadata('.observanda/organizations/content-activity/'+state.revision+'.json',JSON.stringify({revision:state.revision,at:new Date().toISOString(),actor,previous:old??null,grant}));
   return {revision:state.revision,grant};
  });
 }
 async directory(identity){
  return this.workspace.catalogue(async()=>{
   const authority=await this.organizations.load(),actor=this.organizations.principal(authority,identity),state=await this.load(),{metadata}=await this.workspace.outline();
   const organizations=new Set(authority.memberships.filter(m=>m.principalId===actor&&m.active&&m.role==='administrator').map(m=>m.organizationId));
   return {revision:state.revision,grants:state.grants.filter(g=>organizations.has(g.organizationId)),projects:metadata.projects.map(({id,title,parentId})=>({id,title,parentId:parentId??null})),notebooks:metadata.notebooks.map(({id,title,projectId})=>({id,title,projectId}))};
  });
 }
 async authorize({organizationId,principalId,grantId,generation,write=false}){
  const authority=await this.organizations.load();requireMembership(authority,organizationId,principalId);
  const state=await this.load(),grant=state.grants.find(g=>g.id===grantId&&g.organizationId===organizationId&&g.active);
  valid(grant&&(!write||grant.role==='editor')&&(generation===undefined||grant.generation===generation),'COLLABORATION_DENIED');
  const allowed=grant.recipient.kind==='member'?grant.recipient.id===principalId:authority.teams.some(team=>team.id===grant.recipient.id&&team.organizationId===organizationId&&team.members.includes(principalId));
  valid(allowed,'COLLABORATION_DENIED');
  const {metadata}=await this.workspace.outline(),notebookIds=[...new Set(grant.scopes.flatMap(scope=>scopeNotebooks(metadata,scope)))];
  valid(notebookIds.length>0,'COLLABORATION_SCOPE');
  return {grant,notebookIds,authority};
 }
 async recipients(identity,grantId){
  const authority=await this.organizations.load(),actor=this.organizations.principal(authority,identity),state=await this.load(),grant=state.grants.find(g=>g.id===grantId&&g.active);
  valid(!!grant,'COLLABORATION_DENIED');requireAdministrator(authority,grant.organizationId,actor);
  const ids=grant.recipient.kind==='member'?[grant.recipient.id]:authority.teams.find(t=>t.id===grant.recipient.id&&t.organizationId===grant.organizationId)?.members??[];
  return authority.principals.filter(p=>ids.includes(p.id)&&memberOf(authority,grant.organizationId,p.id)).map(p=>({...p,devices:authority.devices.filter(d=>d.principalId===p.id&&d.active).map(d=>d.identity)}));
 }
}

// Project grants cover its current descendant projects and lab books. Removing
// or moving a book out of that tree removes it from the next exchange review.
export function scopeNotebooks(metadata,value){
 if(value.kind==='notebook')return metadata.notebooks.filter(n=>n.id===value.id).map(n=>n.id);
 const projects=new Set([value.id]);if(!metadata.projects.some(p=>p.id===value.id))return [];
 for(let changed=true;changed;){changed=false;for(const project of metadata.projects)if(projects.has(project.parentId)&&!projects.has(project.id)){projects.add(project.id);changed=true;}}
 return metadata.notebooks.filter(n=>projects.has(n.projectId)).map(n=>n.id);
}
