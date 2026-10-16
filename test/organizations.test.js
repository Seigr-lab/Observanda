import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {OrganizationIdentity} from '../src/collaboration/identity.js';
import {Organizations} from '../src/collaboration/organizations.js';
import {OrganizationExchange} from '../src/collaboration/organization-exchange.js';
import {copyWorkspace,copyPlan} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {readAccess} from '../src/access.js';

async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-organizations-')),devices=[];
  t.after(async()=>{for(const f of devices)clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5});});
  for(const name of ['author','member','other'])devices.push(await encryptedFixture(path.join(directory,name),sampleNotebook()));
  const identities=devices.map(f=>new OrganizationIdentity(f.deviceStore)),keys=await Promise.all(identities.map(i=>i.public())),service=new Organizations(devices[0].workspace);
  const state=()=>service.load(),run=async(who,operation,payload,options={})=>{
    const s=await state(),command=await identities[who].sign({authorityId:s.authorityId,id:randomUUID(),issuedAt:new Date().toISOString(),expectedRevision:s.revision,operation,payload,...options});return {command,result:await service.execute(command)};
  };
  const create=async(who,name)=>{const s=await state();return (await service.create({workspaceId:s.authorityId,name,administratorName:name+' admin',identity:keys[who],expectedRevision:s.revision})).organization;};
  const invite=async(organizationId,who=1,extra={})=>(await run(0,'invitation.create',{organizationId,identity:keys[who],verifiedFingerprint:keys[who].id,name:'Invited member',role:'member',teamIds:[],expiresAt:new Date(Date.now()+86400000).toISOString(),...extra})).result.invitation;
  const view=async who=>service.summary(await identities[who].sign({kind:'organization.directory',authorityId:(await state()).authorityId,issuedAt:new Date().toISOString()}));
  return {directory,devices,identities,keys,service,state,run,create,invite,view};
}

test('verified enrollment is isolated across organizations; member permissions, removal and replays use current authority',async t=>{
  const f=await fixture(t),a=await f.create(0,'First organization'),b=await f.create(2,'Unrelated organization'),team=randomUUID();
  await f.run(0,'team.save',{organizationId:a.id,id:team,name:'Research',members:[]});
  const invitation=await f.invite(a.id,1,{teamIds:[team]}),payload={invitationId:invitation.id,token:invitation.token};
  await assert.rejects(f.run(2,'invitation.accept',payload),{code:'COLLABORATION_DENIED'});
  await assert.rejects(f.run(1,'invitation.accept',{...payload,token:'A'.repeat(43)}),{code:'COLLABORATION_DENIED'});
  const accepted=await f.run(1,'invitation.accept',payload),principalId=accepted.result.principalId;
  assert.equal((await f.service.execute(accepted.command)).replayed,true);
  await assert.rejects(f.run(1,'invitation.accept',payload),{code:'COLLABORATION_EXPIRED'});
  const view=await f.view(1);assert.equal(view.organizations.length,1);assert.equal(view.organizations[0].id,a.id);assert.deepEqual(view.organizations[0].teams[0].members,[principalId]);assert.equal(view.organizations[0].invitations.length,0);assert.ok(!JSON.stringify(view).includes(b.name));
  await assert.rejects(f.service.summary(f.keys[0]),{code:'COLLABORATION_SIGNATURE'});
  for(const [operation,payload] of [['organization.rename',{organizationId:a.id,name:'Taken over'}],['member.change',{organizationId:a.id,principalId,role:'administrator',active:true}],['team.save',{organizationId:b.id,id:randomUUID(),name:'Foreign',members:[]}]])await assert.rejects(f.run(1,operation,payload),{code:'COLLABORATION_DENIED'});
  await assert.rejects(f.run(0,'team.save',{organizationId:b.id,id:team,name:'Foreign',members:[]}),{code:'COLLABORATION_DENIED'});
  await f.run(0,'member.change',{organizationId:a.id,principalId,role:'member',active:false});
  assert.deepEqual((await f.view(1)).organizations,[]);
  assert.deepEqual((await f.view(0)).organizations[0].teams[0].members,[]);
  await assert.rejects(f.service.execute(accepted.command),{code:'COLLABORATION_DENIED'});
  await assert.rejects(f.run(0,'member.change',{organizationId:a.id,principalId,role:'member',active:true}),{code:'COLLABORATION_INVITE_REQUIRED'});
  const next=await f.invite(a.id);const rejoined=await f.run(1,'invitation.accept',{invitationId:next.id,token:next.token});assert.equal(rejoined.result.principalId,principalId);
});

test('last administrator, stale writes, revoked and expired invitations and forged signatures fail without mutation',async t=>{
  const f=await fixture(t),org=await f.create(0,'Protected organization'),owner=(await f.view(0)).principalId;
  await assert.rejects(f.run(0,'member.change',{organizationId:org.id,principalId:owner,role:'member',active:true}),{code:'COLLABORATION_LAST_ADMIN'});
  const first=await f.invite(org.id),second=await f.invite(org.id);
  await assert.rejects(f.run(1,'invitation.accept',{invitationId:first.id,token:first.token}),{code:'COLLABORATION_EXPIRED'});
  await f.run(0,'invitation.revoke',{organizationId:org.id,id:second.id});
  await assert.rejects(f.run(1,'invitation.accept',{invitationId:second.id,token:second.token}),{code:'COLLABORATION_EXPIRED'});
  const third=await f.invite(org.id),s=await f.state(),command=await f.identities[1].sign({authorityId:s.authorityId,id:randomUUID(),issuedAt:new Date().toISOString(),expectedRevision:s.revision,operation:'invitation.accept',payload:{invitationId:third.id,token:third.token}});
  f.service.clock=()=>Date.now()+2*86400000;
  await assert.rejects(f.service.execute(command),{code:'COLLABORATION_EXPIRED'});f.service.clock=()=>Date.now();
  const forged=structuredClone(command);forged.value.payload.token='B'.repeat(43);await assert.rejects(f.service.execute(forged),{code:'COLLABORATION_SIGNATURE'});
  await assert.rejects(f.run(0,'organization.rename',{organizationId:org.id,name:'Stale'},{expectedRevision:0}),{code:'CONFLICT'});
  assert.deepEqual(await f.state(),s);
});

test('removing an administrator cancels their pending invitations without granting research keys',async t=>{
  const f=await fixture(t),before=await f.devices[0].workspace.read(),keysBefore=await readAccess(f.devices[0].workspace.root),org=await f.create(0,'Governed organization'),invite=await f.invite(org.id,1,{role:'administrator'}),accepted=await f.run(1,'invitation.accept',{invitationId:invite.id,token:invite.token});
  assert.deepEqual(await readAccess(f.devices[0].workspace.root),keysBefore);
  await assert.rejects(new Workspace(f.devices[0].workspace.root,f.devices[1].vault).outline(),{code:'ENCRYPTION_DAMAGED'});
  const pending=(await f.run(1,'invitation.create',{organizationId:org.id,identity:f.keys[2],verifiedFingerprint:f.keys[2].id,name:'Third person',role:'member',teamIds:[],expiresAt:new Date(Date.now()+86400000).toISOString()})).result.invitation;
  await f.run(0,'member.change',{organizationId:org.id,principalId:accepted.result.principalId,role:'member',active:true});
  await assert.rejects(f.run(2,'invitation.accept',{invitationId:pending.id,token:pending.token}),{code:'COLLABORATION_EXPIRED'});
  assert.deepEqual(await f.devices[0].workspace.read(),before);
  for(const folder of ['commands'])for await(const name of f.devices[0].workspace.metadataNames('.observanda/organizations/'+folder)){
    const stored=await f.devices[0].workspace.readMetadata('.observanda/organizations/'+folder+'/'+name,200000);assert.ok(!stored.includes(invite.token));assert.ok(!stored.includes(pending.token));
  }
});

test('a failed receipt write rolls back membership and its audit event in PostgreSQL',async t=>{
  const f=await fixture(t),org=await f.create(0,'Atomic'),invitation=await f.invite(org.id),before=await f.state(),ws=f.devices[0].workspace,write=ws.writeMetadata;
  ws.writeMetadata=async function(file,text){if(file.includes('/commands/'))throw Error('Synthetic receipt write failure');return write.call(this,file,text);};
  try{await assert.rejects(f.run(1,'invitation.accept',{invitationId:invitation.id,token:invitation.token}),/Synthetic/);}finally{ws.writeMetadata=write;}
  assert.deepEqual(await f.state(),before);
  assert.equal(await ws.readMetadata('.observanda/organizations/activity/'+org.id+'/3.json',200000),null);
  assert.equal(JSON.parse(await ws.readMetadata('.observanda/organizations/activity/'+org.id+'/head.json',1000)).count,2);
  await f.run(1,'invitation.accept',{invitationId:invitation.id,token:invitation.token});
});

test('simultaneous invitation redemption has one result and changed command IDs cannot replay another mutation',async t=>{
  const f=await fixture(t),org=await f.create(0,'Concurrent enrollment'),invitation=await f.invite(org.id),state=await f.state();
  const command=await f.identities[1].sign({authorityId:state.authorityId,id:randomUUID(),issuedAt:new Date().toISOString(),expectedRevision:state.revision,operation:'invitation.accept',payload:{invitationId:invitation.id,token:invitation.token}});
  const results=await Promise.all([f.service.execute(command),f.service.execute(command)]);
  assert.equal(results[0].principalId,results[1].principalId);assert.equal(results.filter(r=>r.replayed).length,1);
  assert.equal((await f.state()).memberships.filter(m=>m.principalId===results[0].principalId).length,1);
  const collision=await f.identities[1].sign({...command.value,payload:{...command.value.payload,token:'A'.repeat(43)}});
  await assert.rejects(f.service.execute(collision),{code:'CONFLICT'});
});

test('two installations complete invitation, acceptance and retained confirmation through the app adapter and encrypted backup',async t=>{
  const f=await fixture(t),org=await f.create(0,'File enrollment'),author=new OrganizationExchange(f.devices[0].workspace,f.devices[0].deviceStore),recipient=new OrganizationExchange(f.devices[1].workspace,f.devices[1].deviceStore);
  const created=await author.command('invitation.create',{organizationId:org.id,identity:f.keys[1],verifiedFingerprint:f.keys[1].id,name:'Recipient',role:'member',teamIds:[],expiresAt:new Date(Date.now()+86400000).toISOString()},(await f.state()).revision);
  const recovered=await author.invitation(created.file.value.invitation.id);assert.deepEqual(recovered.file.value,created.file.value);await assert.rejects(new Organizations(f.devices[0].workspace).invitation(created.file.value.invitation.id,f.keys[2]),{code:'COLLABORATION_DENIED'});
  assert.equal((await recipient.inspect(created.file)).invitation.organizationName,org.name);
  await assert.rejects(recipient.accept(created.file,'0'.repeat(64)),{code:'COLLABORATION_VERIFY'});
  const acceptance=await recipient.accept(created.file,f.keys[0].id);
  assert.deepEqual((await recipient.accept(created.file,f.keys[0].id)).file,acceptance.file);
  await f.run(0,'organization.rename',{organizationId:org.id,name:'Renamed during file exchange'});
  const confirmation=await author.receive(acceptance.file);await recipient.receipt(confirmation.file);await recipient.receipt(confirmation.file);
  await assert.rejects(author.invitation(created.file.value.invitation.id),{code:'COLLABORATION_EXPIRED'});
  assert.deepEqual((await author.receive(acceptance.file)).file.value,confirmation.file.value);
  assert.ok((await recipient.enrollments())[0].acceptedAt);
  const copy=await copyWorkspace(await copyPlan(f.devices[1].workspace.root,path.join(f.directory,'backup')),{vault:f.devices[1].vault}),restored=new OrganizationExchange(new Workspace(copy,f.devices[1].vault),f.devices[1].deviceStore);
  assert.deepEqual(await restored.enrollments(),await recipient.enrollments());
  const wrong=await f.identities[2].sign(confirmation.file.value);await assert.rejects(recipient.receipt(wrong),{code:'COLLABORATION_DENIED'});
});

test('membership history is paged within one organization and rechecks current administrator authority',async t=>{
  const f=await fixture(t),org=await f.create(0,'Recorded changes'),other=await f.create(2,'Private unrelated organization'),team=randomUUID(),ws=f.devices[0].workspace;
  const invitation=await f.invite(org.id,1,{role:'administrator'}),accepted=await f.run(1,'invitation.accept',{invitationId:invitation.id,token:invitation.token});
  const query=async(who,before=null,organizationId=org.id)=>f.service.activity(await f.identities[who].sign({kind:'organization.activity',authorityId:(await f.state()).authorityId,organizationId,before,issuedAt:new Date().toISOString()}));
  for(let i=0;i<22;i++)await f.run(0,'team.save',{organizationId:org.id,id:team,name:'Research team '+i,members:i%2?[accepted.result.principalId]:[]});
  const first=await query(1);assert.equal(first.events.length,20);assert.equal(first.total,25);assert.equal(first.events[0].details.name,'Research team 21');assert.deepEqual(first.events[0].memberNames,['Invited member']);
  assert.ok(first.events.every(e=>e.organizationId===org.id));assert.ok(!JSON.stringify(first).includes(other.name));assert.ok(!JSON.stringify(first).includes(invitation.token));
  await f.run(0,'organization.rename',{organizationId:org.id,name:'New name'});
  const tail=await query(1,first.nextBefore);assert.equal(tail.events.length,5);assert.equal(tail.nextBefore,null);assert.equal(new Set([...first.events,...tail.events].map(e=>e.sequence)).size,25);
  await assert.rejects(query(1,null,other.id),{code:'COLLABORATION_DENIED'});
  await assert.rejects(query(1,-1),{code:'COLLABORATION_INVALID'});
  await f.run(0,'member.change',{organizationId:org.id,principalId:accepted.result.principalId,role:'member',active:true});
  await assert.rejects(query(1),{code:'COLLABORATION_DENIED'});
  const latest=await query(0);assert.equal(latest.events[0].details.previousRole,'administrator');assert.equal(latest.events[0].details.role,'member');
  const before=await f.state(),write=ws.writeMetadata;
  ws.writeMetadata=async function(file,value){if(file.endsWith('/head.json'))throw Error('Synthetic activity index failure');return write.call(this,file,value);};
  try{await assert.rejects(f.run(0,'organization.rename',{organizationId:org.id,name:'Must roll back'}),/Synthetic activity/);}finally{ws.writeMetadata=write;}
  assert.deepEqual(await f.state(),before);assert.deepEqual(await query(0),latest);
  const eventPath='.observanda/organizations/activity/'+org.id+'/'+latest.events[0].sequence+'.json';
  await ws.withLock(()=>ws.writeMetadata(eventPath,JSON.stringify({...latest.events[0],organizationId:other.id})));
  await assert.rejects(query(0),{code:'COLLABORATION_DAMAGED'});
});
