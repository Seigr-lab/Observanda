import {AppError} from '../errors.js';
import {exact,uuid,text,instant,unique} from '../modules/validation.js';
import {validatePublicDevice} from '../security/device-store.js';
import {membershipRoles,memberOf} from './organization-policy.js';

export const authorityLocation='.observanda/organizations/authority.json',authorityLimit=8*1024*1024;
export const requireOrganization=(condition,code='COLLABORATION_INVALID')=>{if(!condition)throw new AppError(code);};
export const organizationLabel=value=>text(value,160,true)&&value===value.trim();
export const byId=(values,id)=>values.find(value=>value.id===id);
export const emptyAuthority=authorityId=>({version:1,authorityId,revision:0,principals:[],devices:[],organizations:[],memberships:[],teams:[],invitations:[]});
export function validateAuthority(state,authorityId){
  const valid=condition=>requireOrganization(condition,'COLLABORATION_DAMAGED');
  valid(exact(state,['version','authorityId','revision','principals','devices','organizations','memberships','teams','invitations'])&&state.version===1&&state.authorityId===authorityId&&Number.isSafeInteger(state.revision)&&state.revision>=0);
  for(const key of ['principals','devices','organizations','memberships','teams','invitations'])valid(Array.isArray(state[key])&&state[key].length<=2000);
  valid(unique(state.principals.map(p=>p.id))&&state.principals.every(p=>exact(p,['id','name'])&&uuid(p.id)&&organizationLabel(p.name)));
  valid(unique(state.devices.map(d=>d.identity?.id))&&state.devices.every(d=>exact(d,['principalId','identity','active'])&&byId(state.principals,d.principalId)&&typeof d.active==='boolean'&&validatePublicDevice(d.identity)));
  valid(unique(state.organizations.map(o=>o.id))&&state.organizations.every(o=>exact(o,['id','name'])&&uuid(o.id)&&organizationLabel(o.name)));
  valid(unique(state.memberships.map(m=>m.organizationId+'/'+m.principalId))&&state.memberships.every(m=>exact(m,['organizationId','principalId','role','active'])&&byId(state.organizations,m.organizationId)&&byId(state.principals,m.principalId)&&membershipRoles.includes(m.role)&&typeof m.active==='boolean'));
  valid(state.organizations.every(o=>state.memberships.some(m=>m.organizationId===o.id&&m.active&&m.role==='administrator')));
  valid(unique(state.teams.map(t=>t.id))&&state.teams.every(t=>exact(t,['id','organizationId','name','members'])&&uuid(t.id)&&byId(state.organizations,t.organizationId)&&organizationLabel(t.name)&&Array.isArray(t.members)&&unique(t.members)&&t.members.every(id=>memberOf(state,t.organizationId,id))));
  valid(unique(state.invitations.map(i=>i.id))&&state.invitations.every(i=>exact(i,['id','organizationId','identity','name','role','teamIds','expiresAt','tokenHash','status','createdBy','principalId'])&&uuid(i.id)&&byId(state.organizations,i.organizationId)&&validatePublicDevice(i.identity)&&organizationLabel(i.name)&&membershipRoles.includes(i.role)&&Array.isArray(i.teamIds)&&unique(i.teamIds)&&i.teamIds.every(id=>state.teams.some(t=>t.id===id&&t.organizationId===i.organizationId))&&instant(i.expiresAt)&&/^[a-f0-9]{64}$/.test(i.tokenHash)&&['pending','accepted','revoked'].includes(i.status)&&byId(state.principals,i.createdBy)&&(i.principalId===null||!!byId(state.principals,i.principalId))));
  return state;
}
