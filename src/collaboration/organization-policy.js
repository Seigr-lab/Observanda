import {AppError} from '../errors.js';

export const membershipRoles=Object.freeze(['administrator','member']);
export const memberOf=(state,organizationId,principalId)=>state.memberships.find(member=>member.organizationId===organizationId&&member.principalId===principalId&&member.active);
export function requireMembership(state,organizationId,principalId){
  const member=memberOf(state,organizationId,principalId);
  if(!member)throw new AppError('COLLABORATION_DENIED');
  return member;
}
export function requireAdministrator(state,organizationId,principalId){
  const member=requireMembership(state,organizationId,principalId);
  if(member.role!=='administrator')throw new AppError('COLLABORATION_DENIED');
  return member;
}
export function keepAdministrator(state,member,next){
  if(member.active&&member.role==='administrator'&&(!next.active||next.role!=='administrator')&&!state.memberships.some(other=>other!==member&&other.organizationId===member.organizationId&&other.active&&other.role==='administrator'))throw new AppError('COLLABORATION_LAST_ADMIN');
}
export function organizationView(state,principalId,now){
  const ids=new Set(state.memberships.filter(m=>m.principalId===principalId&&m.active).map(m=>m.organizationId));
  return state.organizations.filter(org=>ids.has(org.id)).map(org=>{
    const admin=memberOf(state,org.id,principalId).role==='administrator';
    return {...org,role:admin?'administrator':'member',members:state.memberships.filter(m=>m.organizationId===org.id&&(admin||m.active)).map(member=>({...member,name:state.principals.find(p=>p.id===member.principalId).name})),teams:state.teams.filter(team=>team.organizationId===org.id),invitations:admin?state.invitations.filter(i=>i.organizationId===org.id).map(({tokenHash,identity,...invite})=>({...invite,fingerprint:identity.id,status:invite.status==='pending'&&Date.parse(invite.expiresAt)<=now?'expired':invite.status})):[]};
  });
}
