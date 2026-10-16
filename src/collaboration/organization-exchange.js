import {randomUUID} from 'node:crypto';
import {exact,uuid,instant,unique} from '../modules/validation.js';
import {OrganizationIdentity,verifyOrganizationCommand,identityHash} from './identity.js';
import {Organizations} from './organizations.js';
import {requireOrganization as valid,organizationLabel} from './organization-state.js';

// The local adapter signs only explicit administration actions. Invitation
// files contain enrollment information, never workspace or research keys.
export class OrganizationExchange {
  constructor(workspace,device){this.workspace=workspace;this.identity=new OrganizationIdentity(device);this.organizations=new Organizations(workspace);}
  async state(){
    const {metadata}=await this.workspace.outline(),query=await this.identity.sign({kind:'organization.directory',authorityId:metadata.id,issuedAt:new Date().toISOString()});
    return {...await this.organizations.summary(query),identity:await this.identity.public()};
  }
  async command(operation,payload,expectedRevision){
    const {metadata}=await this.workspace.outline();
    const signed=await this.identity.sign({authorityId:metadata.id,id:randomUUID(),issuedAt:new Date().toISOString(),expectedRevision,operation,payload});
    const result=await this.organizations.execute(signed);
    if(result.invitation)result.file=await this.identity.sign({kind:'organization.invitation',invitation:result.invitation});
    return result;
  }
  async activity(organizationId,before=null){
    const {metadata}=await this.workspace.outline();
    return this.organizations.activity(await this.identity.sign({kind:'organization.activity',authorityId:metadata.id,organizationId,before,issuedAt:new Date().toISOString()}));
  }
  async invitation(id){return {file:await this.identity.sign({kind:'organization.invitation',invitation:await this.organizations.invitation(id,await this.identity.public())})};}
  async inspect(file){
    const value=verifyOrganizationCommand(file),i=value.invitation;
    valid(exact(value,['kind','invitation'])&&value.kind==='organization.invitation'&&exact(i,['format','authorityId','id','organizationId','organizationName','recipient','role','teams','expiresAt','token'])&&i.format==='observanda-organization-invitation-v1'&&uuid(i.authorityId)&&uuid(i.id)&&uuid(i.organizationId)&&organizationLabel(i.organizationName)&&['member','administrator'].includes(i.role)&&Array.isArray(i.teams)&&i.teams.length<=50&&unique(i.teams.map(t=>t.id))&&i.teams.every(t=>exact(t,['id','name'])&&uuid(t.id)&&organizationLabel(t.name))&&instant(i.expiresAt)&&typeof i.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(i.token));
    valid(i.recipient===(await this.identity.public()).id,'COLLABORATION_DENIED');valid(Date.parse(i.expiresAt)>Date.now(),'COLLABORATION_EXPIRED');
    return {invitation:i,inviterFingerprint:file.identity.id};
  }
  async accept(file,verifiedFingerprint){
    const {invitation,inviterFingerprint}=await this.inspect(file);valid(verifiedFingerprint===inviterFingerprint,'COLLABORATION_VERIFY');
    return this.workspace.withLock(async()=>{
      const path='.observanda/organizations/enrollments/'+invitation.id+'.json',prior=await this.workspace.readMetadata(path,20000),invitationHash=identityHash(file.value);
      if(prior){const enrollment=JSON.parse(prior);valid(enrollment.invitationHash===invitationHash&&enrollment.authorityFingerprint===inviterFingerprint&&enrollment.recipient===invitation.recipient,'COLLABORATION_DENIED');return {file:enrollment.command,replayed:true};}
      const command=await this.identity.sign({authorityId:invitation.authorityId,id:randomUUID(),issuedAt:new Date().toISOString(),expectedRevision:0,operation:'invitation.accept',payload:{invitationId:invitation.id,token:invitation.token}});
      // The recipient's encrypted outbox retains the exact signed response so
      // a lost download or acknowledgement can be retried without a new claim.
      await this.workspace.writeMetadata(path,JSON.stringify({invitationId:invitation.id,organizationId:invitation.organizationId,organizationName:invitation.organizationName,authorityId:invitation.authorityId,authorityFingerprint:inviterFingerprint,recipient:invitation.recipient,role:invitation.role,invitationHash,command,commandHash:identityHash(command),acceptedAt:null}));return {file:command};
    });
  }
  async receive(command){
    const value=verifyOrganizationCommand(command);valid(value.operation==='invitation.accept');
    const result=await this.organizations.execute(command),{metadata}=await this.workspace.outline();
    return {file:await this.identity.sign({kind:'organization.accepted',authorityId:metadata.id,organizationId:result.organizationId,invitationId:value.payload.invitationId,principalId:result.principalId,recipient:command.identity.id,commandHash:identityHash(command),acceptedAt:result.acceptedAt})};
  }
  async receipt(file){
    const value=verifyOrganizationCommand(file);valid(exact(value,['kind','authorityId','organizationId','invitationId','principalId','recipient','commandHash','acceptedAt'])&&value.kind==='organization.accepted'&&uuid(value.invitationId)&&uuid(value.principalId)&&instant(value.acceptedAt));
    return this.workspace.withLock(async()=>{
      const path='.observanda/organizations/enrollments/'+value.invitationId+'.json',raw=await this.workspace.readMetadata(path,20000);valid(!!raw,'COLLABORATION_DENIED');const enrollment=JSON.parse(raw);
      valid(enrollment.authorityFingerprint===file.identity.id&&enrollment.authorityId===value.authorityId&&enrollment.organizationId===value.organizationId&&enrollment.recipient===value.recipient&&value.recipient===(await this.identity.public()).id&&enrollment.commandHash===value.commandHash,'COLLABORATION_DENIED');
      if(!enrollment.acceptedAt)await this.workspace.writeMetadata(path,JSON.stringify({...enrollment,principalId:value.principalId,acceptedAt:value.acceptedAt}));return {saved:true};
    });
  }
  async enrollments(){
    const identity=await this.identity.public(),items=[];
    for await(const name of this.workspace.metadataNames('.observanda/organizations/enrollments')){
      const raw=await this.workspace.readMetadata('.observanda/organizations/enrollments/'+name,20000),v=JSON.parse(raw);
      if(v.recipient===identity.id)items.push({organizationName:v.organizationName,role:v.role,acceptedAt:v.acceptedAt});
    }
    return items;
  }
}
