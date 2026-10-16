import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {AppError} from '../errors.js';
import {exact,uuid,text,instant,unique} from '../modules/validation.js';
import {validatePublicDevice} from '../security/device-store.js';
import {identityHash,verifyOrganizationCommand} from './identity.js';
import {membershipRoles,memberOf,requireMembership,requireAdministrator,keepAdministrator,organizationView} from './organization-policy.js';
import {authorityLocation,authorityLimit,emptyAuthority,validateAuthority,requireOrganization as valid,organizationLabel as label,byId} from './organization-state.js';
import {organizationTransaction} from './transaction.js';
import {appendOrganizationActivity,organizationActivity} from './organization-audit.js';

const hash=token=>createHash('sha256').update(token).digest('hex');
export class Organizations {
  constructor(workspace,{clock=()=>Date.now()}={}){this.workspace=workspace;this.clock=clock;}
  async load(){
    const authorityId=await this.workspace.catalogue(async store=>(await store.snapshot()).metadata.id),raw=await this.workspace.readMetadata(authorityLocation,authorityLimit);
    if(!raw)return emptyAuthority(authorityId);
    try{return validateAuthority(JSON.parse(raw),authorityId);}catch{throw new AppError('COLLABORATION_DAMAGED');}
  }
  async persist(state,event){
    for(const key of ['principals','devices','organizations','memberships','teams','invitations'])valid(state[key].length<=2000,'LIMIT');
    state.revision++;validateAuthority(state,state.authorityId);
    const raw=JSON.stringify(state);valid(Buffer.byteLength(raw)<=authorityLimit,'LIMIT');
    await this.workspace.writeMetadata(authorityLocation,raw);
    const saved={...event,authorityId:state.authorityId,revision:state.revision,at:new Date(this.clock()).toISOString()};
    await appendOrganizationActivity(this.workspace,saved);
  }
  principal(state,identity){
    const device=state.devices.find(d=>d.active&&d.identity.id===identity.id);
    valid(!!device&&identityHash(device.identity)===identityHash(identity),'COLLABORATION_DENIED');return device.principalId;
  }
  // Only the unlocked local workspace owner can bootstrap an organization.
  // Remote signed commands cannot call this method or authorize content access.
  async create({workspaceId,name,administratorName,identity,expectedRevision}){
    validatePublicDevice(identity);valid(label(name)&&label(administratorName));
    return organizationTransaction(this.workspace,async()=>{
      const state=await this.load();valid(workspaceId===state.authorityId,'WORKSPACE_CHANGED');valid(expectedRevision===state.revision,'CONFLICT');
      let device=state.devices.find(d=>d.identity.id===identity.id);valid(!device||device.active,'COLLABORATION_DENIED');
      if(!device){const principal={id:randomUUID(),name:administratorName};state.principals.push(principal);device={principalId:principal.id,identity,active:true};state.devices.push(device);}
      const org={id:randomUUID(),name};state.organizations.push(org);state.memberships.push({organizationId:org.id,principalId:device.principalId,role:'administrator',active:true});
      await this.persist(state,{operation:'organization.create',actor:device.principalId,organizationId:org.id,details:{name,principalId:device.principalId}});return {organization:org,revision:state.revision};
    });
  }
  async summary(command){
    const query=verifyOrganizationCommand(command);
    valid(exact(query,['kind','authorityId','issuedAt'])&&query.kind==='organization.directory'&&uuid(query.authorityId)&&instant(query.issuedAt));
    valid(Math.abs(this.clock()-Date.parse(query.issuedAt))<=300000,'COLLABORATION_EXPIRED');
    return this.workspace.catalogue(async()=>{
      const state=await this.load();valid(query.authorityId===state.authorityId,'COLLABORATION_DENIED');
      const device=state.devices.find(d=>d.active&&d.identity.id===command.identity.id);
      return {authorityId:state.authorityId,revision:state.revision,principalId:device?.principalId??null,organizations:device?organizationView(state,device.principalId,this.clock()):[]};
    });
  }
  async execute(command){
    const value=verifyOrganizationCommand(command);
    valid(exact(value,['authorityId','id','issuedAt','expectedRevision','operation','payload'])&&uuid(value.authorityId)&&uuid(value.id)&&instant(value.issuedAt)&&Number.isSafeInteger(value.expectedRevision)&&value.expectedRevision>=0&&text(value.operation,80,true)&&value.payload&&typeof value.payload==='object'&&!Array.isArray(value.payload));
    const age=this.clock()-Date.parse(value.issuedAt);
    valid(age>=-300000&&age<=(value.operation==='invitation.accept'?7*86400000:300000),'COLLABORATION_EXPIRED');
    return organizationTransaction(this.workspace,async()=>{
      const state=await this.load();valid(value.authorityId===state.authorityId,'COLLABORATION_DENIED');
      const receiptPath='.observanda/organizations/commands/'+value.id+'.json',prior=await this.workspace.readMetadata(receiptPath,200000),digest=identityHash(command);
      // Replays re-check current authority, including removal since acceptance.
      if(prior){const receipt=JSON.parse(prior);valid(receipt.hash===digest,'CONFLICT');const actor=this.principal(state,command.identity);requireMembership(state,receipt.organizationId,actor);if(receipt.administrator)requireAdministrator(state,receipt.organizationId,actor);return {...receipt.result,replayed:true};}
      // An offline acceptance is bound to one exact invitation, not unrelated
      // directory edits performed while the recipient was reading it.
      if(value.operation!=='invitation.accept')valid(value.expectedRevision===state.revision,'CONFLICT');
      const p=value.payload;let actor,result,organizationId,details,administrator=true;
      if(value.operation==='invitation.accept'){
        valid(exact(p,['invitationId','token'])&&uuid(p.invitationId)&&typeof p.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(p.token));
        const invite=byId(state.invitations,p.invitationId);valid(!!invite&&invite.status==='pending'&&Date.parse(invite.expiresAt)>this.clock(),'COLLABORATION_EXPIRED');
        valid(invite.identity.id===command.identity.id&&identityHash(invite.identity)===identityHash(command.identity)&&timingSafeEqual(Buffer.from(invite.tokenHash,'hex'),Buffer.from(hash(p.token),'hex')),'COLLABORATION_DENIED');
        requireAdministrator(state,invite.organizationId,invite.createdBy);
        let device=state.devices.find(d=>d.identity.id===command.identity.id);valid(!device||device.active,'COLLABORATION_DENIED');
        if(!device){const principal={id:randomUUID(),name:invite.name};state.principals.push(principal);device={principalId:principal.id,identity:command.identity,active:true};state.devices.push(device);}
        actor=device.principalId;organizationId=invite.organizationId;administrator=false;
        let member=state.memberships.find(m=>m.organizationId===organizationId&&m.principalId===actor);valid(!member?.active,'COLLABORATION_ALREADY_MEMBER');
        if(member)Object.assign(member,{role:invite.role,active:true});else state.memberships.push({organizationId,principalId:actor,role:invite.role,active:true});
        for(const id of invite.teamIds){const team=byId(state.teams,id);if(!team.members.includes(actor))team.members.push(actor);}
        Object.assign(invite,{status:'accepted',principalId:actor});result={principalId:actor,organizationId,acceptedAt:new Date(this.clock()).toISOString()};details={invitationId:invite.id,principalId:actor,role:invite.role,teamIds:[...invite.teamIds]};
      }else{
        actor=this.principal(state,command.identity);organizationId=p.organizationId;valid(uuid(organizationId));requireAdministrator(state,organizationId,actor);
        if(value.operation==='organization.rename'){
          valid(exact(p,['organizationId','name'])&&label(p.name));details={previousName:byId(state.organizations,organizationId).name,name:p.name};byId(state.organizations,organizationId).name=p.name;result={saved:true};
        }else if(value.operation==='team.save'){
          valid(exact(p,['organizationId','id','name','members'])&&uuid(p.id)&&label(p.name)&&Array.isArray(p.members)&&unique(p.members)&&p.members.every(id=>memberOf(state,organizationId,id)));
          const team=byId(state.teams,p.id);valid(!team||team.organizationId===organizationId,'COLLABORATION_DENIED');details={teamId:p.id,name:p.name,previousMembers:team?[...team.members]:[],members:[...p.members]};if(team)Object.assign(team,{name:p.name,members:p.members});else state.teams.push({...p});result={id:p.id};
        }else if(value.operation==='team.remove'){
          valid(exact(p,['organizationId','id'])&&uuid(p.id));const team=byId(state.teams,p.id);valid(team?.organizationId===organizationId,'COLLABORATION_DENIED');details={teamId:p.id,name:team.name,members:[...team.members]};state.teams=state.teams.filter(t=>t.id!==p.id);for(const invite of state.invitations)invite.teamIds=invite.teamIds.filter(id=>id!==p.id);result={removed:true};
        }else if(value.operation==='invitation.create'){
          valid(exact(p,['organizationId','identity','verifiedFingerprint','name','role','teamIds','expiresAt'])&&label(p.name)&&membershipRoles.includes(p.role)&&Array.isArray(p.teamIds)&&p.teamIds.length<=50&&unique(p.teamIds)&&p.teamIds.every(id=>state.teams.some(t=>t.id===id&&t.organizationId===organizationId))&&instant(p.expiresAt)&&Date.parse(p.expiresAt)>this.clock()&&Date.parse(p.expiresAt)<=this.clock()+7*86400000);
          validatePublicDevice(p.identity);valid(p.verifiedFingerprint===p.identity.id,'COLLABORATION_VERIFY');
          const device=state.devices.find(d=>d.identity.id===p.identity.id);valid(!device||device.active,'COLLABORATION_DENIED');valid(!device||!memberOf(state,organizationId,device.principalId),'COLLABORATION_ALREADY_MEMBER');
          for(const old of state.invitations)if(old.organizationId===organizationId&&old.identity.id===p.identity.id&&old.status==='pending')old.status='revoked';
          const token=randomBytes(32).toString('base64url'),id=randomUUID();
          state.invitations.push({id,organizationId,identity:p.identity,name:p.name,role:p.role,teamIds:p.teamIds,expiresAt:p.expiresAt,tokenHash:hash(token),status:'pending',createdBy:actor,principalId:null});
          details={invitationId:id,recipient:p.identity.id,name:p.name,role:p.role,teamIds:[...p.teamIds],expiresAt:p.expiresAt};
          result={invitation:{format:'observanda-organization-invitation-v1',authorityId:state.authorityId,id,organizationId,organizationName:byId(state.organizations,organizationId).name,recipient:p.identity.id,role:p.role,teams:p.teamIds.map(id=>({id,name:byId(state.teams,id).name})),expiresAt:p.expiresAt,token}};
        }else if(value.operation==='invitation.revoke'){
          valid(exact(p,['organizationId','id'])&&uuid(p.id));const invite=byId(state.invitations,p.id);valid(invite?.organizationId===organizationId,'COLLABORATION_DENIED');valid(invite.status!=='accepted','COLLABORATION_ALREADY_MEMBER');details={invitationId:p.id,name:invite.name,recipient:invite.identity.id};invite.status='revoked';result={revoked:true};
        }else if(value.operation==='member.change'){
          valid(exact(p,['organizationId','principalId','role','active'])&&uuid(p.principalId)&&membershipRoles.includes(p.role)&&typeof p.active==='boolean');
          const member=state.memberships.find(m=>m.organizationId===organizationId&&m.principalId===p.principalId);valid(!!member,'COLLABORATION_DENIED');valid(member.active||!p.active,'COLLABORATION_INVITE_REQUIRED');keepAdministrator(state,member,p);details={principalId:p.principalId,previousRole:member.role,previousActive:member.active,role:p.role,active:p.active};Object.assign(member,{role:p.role,active:p.active});
          if(!p.active)for(const team of state.teams.filter(t=>t.organizationId===organizationId))team.members=team.members.filter(id=>id!==p.principalId);
          if(!p.active||p.role!=='administrator')for(const invite of state.invitations)if(invite.organizationId===organizationId&&invite.createdBy===p.principalId&&invite.status==='pending')invite.status='revoked';
          result={saved:true};
        }else throw new AppError('COLLABORATION_INVALID');
      }
      await this.persist(state,{operation:value.operation,actor,organizationId,commandId:value.id,details});result.revision=state.revision;
      // The public directory and command receipts expose no enrollment token.
      // A separate encrypted outbox permits a current administrator to recover
      // a lost invitation download while that invitation is still pending.
      if(result.invitation)await this.workspace.writeMetadata('.observanda/organizations/invitation-outbox/'+result.invitation.id+'.json',JSON.stringify(result.invitation));
      const retained=result.invitation?{invitationId:result.invitation.id,revision:state.revision,downloadAvailable:false}:result;
      await this.workspace.writeMetadata(receiptPath,JSON.stringify({hash:digest,organizationId,administrator,result:retained}));return result;
    });
  }
  async invitation(id,identity){
    valid(uuid(id));return this.workspace.catalogue(async()=>{
      const state=await this.load(),invite=byId(state.invitations,id);valid(invite,'NOT_FOUND');requireAdministrator(state,invite.organizationId,this.principal(state,identity));
      valid(invite.status==='pending'&&Date.parse(invite.expiresAt)>this.clock(),'COLLABORATION_EXPIRED');requireAdministrator(state,invite.organizationId,invite.createdBy);
      const raw=await this.workspace.readMetadata('.observanda/organizations/invitation-outbox/'+id+'.json',20000);valid(raw,'NOT_FOUND');const value=JSON.parse(raw);
      valid(value.id===id&&value.authorityId===state.authorityId&&value.organizationId===invite.organizationId&&hash(value.token)===invite.tokenHash,'COLLABORATION_DAMAGED');return value;
    });
  }
  async activity(command){
    const query=verifyOrganizationCommand(command);
    valid(exact(query,['kind','authorityId','organizationId','before','issuedAt'])&&query.kind==='organization.activity'&&uuid(query.authorityId)&&uuid(query.organizationId)&&instant(query.issuedAt));
    valid(Math.abs(this.clock()-Date.parse(query.issuedAt))<=300000,'COLLABORATION_EXPIRED');
    return this.workspace.catalogue(async()=>{
      const state=await this.load();valid(query.authorityId===state.authorityId,'COLLABORATION_DENIED');
      requireAdministrator(state,query.organizationId,this.principal(state,command.identity));
      const page=await organizationActivity(this.workspace,query.organizationId,query.before);
      const names=ids=>ids.map(id=>byId(state.principals,id)?.name??id);
      return {...page,events:page.events.map(event=>({...event,actorName:byId(state.principals,event.actor)?.name??event.actor,subjectName:byId(state.principals,event.details.principalId)?.name??event.details.name??null,memberNames:names(event.details.members??[]),previousMemberNames:names(event.details.previousMembers??[])}))};
    });
  }
}
