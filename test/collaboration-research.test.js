import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {OrganizationExchange} from '../src/collaboration/organization-exchange.js';
import {ResearchExchange} from '../src/collaboration/research-exchange.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {selectedMetadata,validateSelection} from '../src/collaboration/selection.js';
import {ChangeReview} from '../src/collaboration/change-review.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {contentBuffer} from '../src/file-content.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {writeExchange,exchangeDeclaration} from '../src/collaboration/exchange-stream.js';
import {ExchangeParts} from '../src/collaboration/exchange-parts.js';
import {diskCapacity} from '../src/disk-capacity.js';
import {MediaStore} from '../src/media.js';
import {MediaImports} from '../src/media-imports.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {setTimeout as delay} from 'node:timers/promises';
import {blankAnalysisMethod,blankAnalysisSource} from '../src/web/analysis-model.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-shared-research-')),vaults=[];
 t.after(async()=>{vaults.forEach(clearVault);await rm(directory,{recursive:true,force:true,maxRetries:5});});
 const book=sampleNotebook(),hidden=randomUUID();book.notebooks.push({id:hidden,projectId:book.projects[0].id,title:'Unrelated private book'});book.entries[2].notebookId=hidden;
 const author=await encryptedFixture(path.join(directory,'author'),book),member=await encryptedFixture(path.join(directory,'member'),sampleNotebook());vaults.push(author.vault,member.vault);
 const a=new OrganizationExchange(author.workspace,author.deviceStore),b=new OrganizationExchange(member.workspace,member.deviceStore),sa=new ResearchExchange(author.workspace,author.deviceStore),sb=new ResearchExchange(member.workspace,member.deviceStore);
 const org=(await a.organizations.create({workspaceId:book.id,name:'Shared research',administratorName:'Owner',expectedRevision:0,identity:await a.identity.public()})).organization;
 const state=()=>a.organizations.load(),contact=await sb.contact();
 const invitation=await a.command('invitation.create',{organizationId:org.id,identity:contact.identity,verifiedFingerprint:contact.identity.id,name:'Researcher',role:'member',teamIds:[],expiresAt:new Date(Date.now()+86400000).toISOString()},(await state()).revision);
 const acceptance=await b.accept(invitation.file,(await a.identity.public()).id),receipt=await a.receive(acceptance.file);await b.receipt(receipt.file);
 const principalId=(await state()).devices.find(d=>d.identity.id===contact.identity.id).principalId;
 const grant=await sa.access.saveLocal(await a.identity.public(),{workspaceId:book.id,expectedRevision:0,id:null,organizationId:org.id,scopes:[{kind:'notebook',id:book.notebooks[0].id}],recipient:{kind:'member',id:principalId},role:'editor',active:true});
 return {directory,vaults,book,author,member,a,b,sa,sb,org,contact,grant:grant.grant,principalId,state};
}

test('incoming research packages preserve free disk space and discard rejected staging',async t=>{
 const f=await fixture(t),prepared=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),bytes=await Array.fromAsync(await f.sa.outgoing(prepared.id));
 const probe=t.mock.method(diskCapacity,'probe',async()=>({id:'synthetic-full-volume',available:BigInt(256*1024*1024-1)}));
 try{await assert.rejects(f.sb.receive(bytes),{code:'STORAGE_FULL'});}finally{probe.mock.restore();}
 assert.deepEqual(await f.member.workspace.listMetadata('.observanda/collaboration/staging'),[]);
 assert.deepEqual(await readdir(path.join(f.member.workspace.root,'.observanda/collaboration/staging')),[]);
 const accepted=await f.sb.receive(bytes);assert.equal(accepted.notebooks.length,1);
});

test('encrypted selected books open with independent keys and retain editable records without unrelated content',async t=>{
 const f=await fixture(t),prepared=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),incoming=await f.sb.receive(await f.sa.outgoing(prepared.id));
 assert.equal(incoming.notebooks.length,1);assert.equal(incoming.role,'editor');
 const again=await f.sb.receive(await f.sa.outgoing(prepared.id));assert.equal(again.id,incoming.id);assert.equal(again.replayed,true);
 assert.deepEqual(await f.member.workspace.listMetadata('.observanda/collaboration/staging'),[incoming.id]);assert.deepEqual(await readdir(path.join(f.member.workspace.root,'.observanda/collaboration/staging')),[incoming.id]);
 const destination=path.join(f.directory,'shared-copy');await f.sb.acceptCopy(incoming.id,destination);
 const access=await readAccess(destination),vault=await verifyAccess(access,'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);
 const ws=new Workspace(destination,vault),read=await ws.read();assert.equal(read.book.id,f.book.id);assert.equal(read.book.entries.length,2);assert.equal(read.book.notebooks.length,1);
 assert.ok(!JSON.stringify(read).includes('Unrelated private'));assert.notEqual(vault.id,f.author.vault.id);
 await assert.rejects(new Workspace(f.author.workspace.root,vault).outline(),{code:'ENCRYPTION_DAMAGED'});
 const record=read.book.entries[0];await new ResearchRecords(ws,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Collaborator observation'}}]});
 const returning=new ResearchExchange(ws,f.member.deviceStore),changes=await returning.prepareChanges(),review=await f.sa.receive(await returning.outgoing(changes.id));assert.equal(review.kind,'changes');
 assert.equal((await f.author.workspace.read()).book.entries[0].title,f.book.entries[0].title);
 const reviewer=new ChangeReview(f.sa),proposal=await reviewer.review(review.id);assert.equal(proposal.rows.length,1);assert.equal(proposal.rows[0].conflict,false);
 const current=(await f.author.workspace.read()).book.entries.find(r=>r.id===record.id);await new ResearchRecords(f.author.workspace,{}).save({workspaceId:f.book.id,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Owner concurrent observation'}}]});
 await assert.rejects(reviewer.apply({reviewId:proposal.id,choices:[{id:current.id,choice:'incoming'}]}),{code:'RECORD_CHANGED'});
 const conflict=await reviewer.review(review.id);assert.equal(conflict.rows[0].conflict,true);assert.equal((await reviewer.record(conflict.id,current.id,'incoming')).title,'Collaborator observation');assert.equal((await reviewer.record(conflict.id,current.id,'current')).title,'Owner concurrent observation');
 const command={reviewId:conflict.id,choices:[{id:current.id,choice:'incoming'}]},receipt=await reviewer.apply(command);assert.deepEqual(receipt.accepted,[current.id]);assert.equal((await reviewer.apply(command)).replayed,true);
 assert.equal((await f.author.workspace.read()).book.entries.find(r=>r.id===record.id).title,'Collaborator observation');assert.equal((await f.author.workspace.read()).book.entries.find(r=>r.id===f.book.entries[2].id).notebookId,f.book.notebooks[1].id);
});

test('scope projection is canonical and revoked grants reject both downloads and returned research',async t=>{
 const f=await fixture(t),metadata=selectedMetadata((await f.author.workspace.outline()).metadata,[f.book.notebooks[0].id]),prepared=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact});
 const parts=(await import('../src/collaboration/exchange-parts.js')).ExchangeParts,p=new parts(f.author.workspace,prepared.id);await p.open();const selection=await p.value('description','selection');assert.deepEqual(validateSelection(selection).metadata,metadata);
 await f.sa.access.saveLocal(await f.a.identity.public(),{workspaceId:f.book.id,expectedRevision:1,active:false,scopes:f.grant.scopes,organizationId:f.org.id,id:f.grant.id,recipient:f.grant.recipient,role:'editor'});
 await assert.rejects(f.sa.outgoing(prepared.id),{code:'COLLABORATION_DENIED'});
});

test('successive owner editions update the same workspace, preserve local edits and reject older files',async t=>{
 const f=await fixture(t),first=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),incoming=await f.sb.receive(await f.sa.outgoing(first.id)),destination=path.join(f.directory,'continuing-copy');await f.sb.acceptCopy(incoming.id,destination);
 const vault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const ws=new Workspace(destination,vault),member=new ResearchExchange(ws,f.member.deviceStore),reviewer=new ChangeReview(member),recordId=f.book.entries[0].id;
 const edit=async(workspace,id,title)=>{const record=(await workspace.read()).book.entries.find(r=>r.id===id);await new ResearchRecords(workspace,{}).save({workspaceId:f.book.id,changes:[{id,expectedRevision:recordRevision(record),record:{...record,title}}]});};
 await edit(ws,recordId,'Local observation still in progress');await edit(f.author.workspace,recordId,'Owner independent observation');
 const second=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),arrived=await member.receive(await f.sa.outgoing(second.id)),review=await reviewer.review(arrived.id);assert.equal(review.kind,'offer');assert.equal(review.rows[0].conflict,true);
 const command={reviewId:review.id,choices:[{id:recordId,choice:'current'}]},receipt=await reviewer.apply(command);assert.deepEqual(receipt.kept,[recordId]);assert.equal((await reviewer.apply(command)).replayed,true);assert.equal((await ws.read()).book.entries.find(r=>r.id===recordId).title,'Local observation still in progress');assert.equal((await member.working()).selection.id,second.id);
 assert.deepEqual((await reviewer.review(arrived.id)).receipt,receipt);
 const old=await member.receive(await f.sa.outgoing(first.id));await assert.rejects(reviewer.review(old.id),{code:'STALE'});
 const returned=await member.prepareChanges(),received=await f.sa.receive(await member.outgoing(returned.id)),ownerReview=new ChangeReview(f.sa),proposal=await ownerReview.review(received.id);assert.equal(proposal.rows.length,1);assert.equal(proposal.rows[0].conflict,false);await ownerReview.apply({reviewId:proposal.id,choices:[{id:recordId,choice:'incoming'}]});
 const third=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),latest=await member.receive(await f.sa.outgoing(third.id)),ack=await reviewer.review(latest.id);assert.equal(ack.rows[0].conflict,false);await reviewer.apply({reviewId:ack.id,choices:ack.rows.map(r=>({id:r.id,choice:'incoming'}))});
 // A further unchanged edition must still advance the base, including readers.
 const fourth=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),unchanged=await member.receive(await f.sa.outgoing(fourth.id)),empty=await reviewer.review(unchanged.id);assert.equal(empty.rows.length,0);await reviewer.apply({reviewId:empty.id,choices:[]});assert.equal((await member.working()).selection.id,fourth.id);
 const backup=await copyWorkspace(await copyPlan(destination,path.join(f.directory,'continuing-backup')),{vault}),restored=new ResearchExchange(new Workspace(backup,vault),f.member.deviceStore);assert.deepEqual(await restored.working(),await member.working());
});

test('scope updates add books and retain declined removals as local research outside future returns',async t=>{
 const f=await fixture(t),offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),incoming=await f.sb.receive(await f.sa.outgoing(offer.id)),destination=path.join(f.directory,'scope-copy');await f.sb.acceptCopy(incoming.id,destination);
 const vault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const ws=new Workspace(destination,vault),member=new ResearchExchange(ws,f.member.deviceStore),reviewer=new ChangeReview(member);
 const updateGrant=async(scopes,revision)=>f.sa.access.saveLocal(await f.a.identity.public(),{workspaceId:f.book.id,expectedRevision:revision,id:f.grant.id,organizationId:f.org.id,scopes,recipient:f.grant.recipient,role:'editor',active:true});
 await updateGrant(f.book.notebooks.map(n=>({kind:'notebook',id:n.id})),1);
 const second=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),addition=await member.receive(await f.sa.outgoing(second.id)),addReview=await reviewer.review(addition.id);assert.equal(addReview.rows.length,1);assert.equal(addReview.rows[0].kind,'added');assert.equal(addReview.structure.books.length,1);await reviewer.apply({reviewId:addReview.id,choices:[{id:addReview.rows[0].id,choice:'incoming'}]});assert.equal((await ws.read()).book.notebooks.length,2);
 await updateGrant([{kind:'notebook',id:f.book.notebooks[1].id}],2);
 const third=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),removal=await member.receive(await f.sa.outgoing(third.id)),removeReview=await reviewer.review(removal.id);assert.equal(removeReview.rows.length,2);await reviewer.apply({reviewId:removeReview.id,choices:removeReview.rows.map(r=>({id:r.id,choice:'current'}))});assert.equal((await ws.read()).book.entries.length,3);assert.equal((await member.working()).selection.metadata.notebooks.length,1);
 const changes=await member.prepareChanges(),returned=await f.sa.receive(await member.outgoing(changes.id)),ownerReview=await new ChangeReview(f.sa).review(returned.id);assert.equal(ownerReview.rows.length,0);
});

test('team changes and removed members revoke outstanding returns; unrelated organizations cannot use a grant',async t=>{
 const f=await fixture(t),teamId=randomUUID();await f.a.command('team.save',{organizationId:f.org.id,id:teamId,name:'Field team',members:[f.principalId]},(await f.state()).revision);
 const command={workspaceId:f.book.id,expectedRevision:1,id:f.grant.id,organizationId:f.org.id,scopes:f.grant.scopes,recipient:{kind:'team',id:teamId},role:'editor',active:true};await f.sa.access.saveLocal(await f.a.identity.public(),command);
 const offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact});
 await f.a.command('team.save',{organizationId:f.org.id,id:teamId,name:'Field team',members:[]},(await f.state()).revision);await assert.rejects(f.sa.outgoing(offer.id),{code:'COLLABORATION_DENIED'});
 await f.a.command('team.save',{organizationId:f.org.id,id:teamId,name:'Field team',members:[f.principalId]},(await f.state()).revision);
 const incoming=await f.sb.receive(await f.sa.outgoing(offer.id)),destination=path.join(f.directory,'revoked-copy');await f.sb.acceptCopy(incoming.id,destination);
 const access=await readAccess(destination),vault=await verifyAccess(access,'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const sender=new ResearchExchange(new Workspace(destination,vault),f.member.deviceStore),prepared=await sender.prepareChanges(),bytes=await Array.fromAsync(await sender.outgoing(prepared.id));
 await f.a.command('member.change',{organizationId:f.org.id,principalId:f.principalId,role:'member',active:false},(await f.state()).revision);
 const receive=ExchangeParts.prototype.receive;let staged=0;
 ExchangeParts.prototype.receive=function(...args){staged++;return receive.apply(this,args);};
 try{await assert.rejects(f.sa.receive(bytes),{code:'COLLABORATION_DENIED'});assert.equal(staged,0,'Revoked senders must be rejected before staging any entry');}finally{ExchangeParts.prototype.receive=receive;}
 const outsider=await encryptedFixture(path.join(f.directory,'outsider'),sampleNotebook());f.vaults.push(outsider.vault);const other=new ResearchExchange(outsider.workspace,outsider.deviceStore),identity=await other.identity.signer.public();await f.a.organizations.create({workspaceId:f.book.id,name:'Other organization',administratorName:'Other owner',identity,expectedRevision:(await f.state()).revision});
 await assert.rejects(f.sa.prepareOffer({grantId:f.grant.id,contact:await other.contact()}),{code:'COLLABORATION_DENIED'});
});

test('reader grants cannot prepare returned edits and native backup retains the exact shared base',async t=>{
 const f=await fixture(t);await f.sa.access.saveLocal(await f.a.identity.public(),{workspaceId:f.book.id,expectedRevision:1,id:f.grant.id,organizationId:f.org.id,scopes:f.grant.scopes,recipient:f.grant.recipient,role:'reader',active:true});
 const offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),incoming=await f.sb.receive(await f.sa.outgoing(offer.id)),destination=path.join(f.directory,'read-copy');await f.sb.acceptCopy(incoming.id,destination);
 const access=await readAccess(destination),vault=await verifyAccess(access,'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const ws=new Workspace(destination,vault),sender=new ResearchExchange(ws,f.member.deviceStore);await assert.rejects(sender.prepareChanges(),{code:'COLLABORATION_DENIED'});
 const restored=await copyWorkspace(await copyPlan(destination,path.join(f.directory,'restored')),{vault}),after=new ResearchExchange(new Workspace(restored,vault),f.member.deviceStore);assert.deepEqual(await after.working(),await sender.working());await assert.rejects(after.prepareChanges(),{code:'COLLABORATION_DENIED'});
});

test('a signed collaborator file cannot replace access files or introduce records outside the offered books',async t=>{
 const f=await fixture(t),offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),source=new ExchangeParts(f.author.workspace,offer.id);await source.open();
 const selection=await source.value('description','selection'),id=randomUUID(),changed={...selection,kind:'changes',id,baseId:selection.id};
 async function* entries(extra){for await(const item of source.entries())yield item.kind==='description'?{kind:'description',name:'selection',content:JSON.stringify(changed)}:item;yield extra;}
 const encoded=async extra=>writeExchange(f.sb.identity,selection.owner,entries(extra),{id,declaration:await exchangeDeclaration(entries(extra),changed)});
 await assert.rejects(f.sa.receive(await encoded({kind:'original',name:'.observanda/access.json',content:'not allowed'})),{code:'COLLABORATION_PACKAGE'});
 const foreign={...f.book.entries[2],id:randomUUID()},before=await f.author.workspace.read(),received=await f.sa.receive(await encoded({kind:'record',name:foreign.id,content:JSON.stringify(foreign)}));
 await assert.rejects(new ChangeReview(f.sa).review(received.id),{code:'COLLABORATION_PACKAGE'});assert.deepEqual(await f.author.workspace.read(),before);
});

test('returned evidence preserves exact bytes and dataset values and is independently reviewable before acceptance',async t=>{
 const f=await fixture(t),materials=new ResearchMaterials(f.author.workspace),recordId=f.book.entries[0].id,bytes=Buffer.from('counter,reading\n9007199254740993,0.000000000000003\n9007199254740994,0.000000000000007\n');
 const upload=async(owner,recordId,name,bytes)=>{const session=await owner.startImport({recordId,name,size:bytes.length,provenance:'Synthetic instrument capture'});await owner.appendImport(session.id,0,[bytes]);return owner.finishImport(session.id);};
 const artifact=await upload(materials,recordId,'capture.csv',bytes),column=(name,representation)=>({name,representation,radix:10,unit:'',missing:[],time:{kind:'none',reference:'',resolution:'',uncertainty:''}}),dataset=await materials.dataset({recordId,title:'Exact observations',artifact,columns:[column('counter','integer'),column('reading','decimal')]});
 const aggregated=await materials.dataset({recordId,title:'Retained grouped readings',aggregation:{version:1,source:dataset,keys:[0],values:[{column:1,operation:'median',name:'Median'}],missing:'skip',note:''}});
 const source=blankAnalysisSource(dataset);source.columns.value=0;
 const comparisonCommand={recordId,title:'Exact retained comparison',tool:'Synthetic comparison',version:'1',method:{...blankAnalysisMethod(),unavailable:'No external implementation in this synthetic fixture.',uncertainty:'Not measured.',limitations:'Synthetic qualification only.'},comparison:{version:1,sources:[source],ordering:'source',expected:null}},comparison=await materials.comparisons.save(comparisonCommand);
 const offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),incoming=await f.sb.receive(await f.sa.outgoing(offer.id)),destination=path.join(f.directory,'evidence-copy');await f.sb.acceptCopy(incoming.id,destination);
 const access=await readAccess(destination),vault=await verifyAccess(access,'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const ws=new Workspace(destination,vault),copied=new ResearchMaterials(ws);
 assert.deepEqual(await contentBuffer((await copied.artifact(artifact)).content),bytes);assert.deepEqual(await Array.fromAsync(copied.iterateDataset(dataset)),await Array.fromAsync(materials.iterateDataset(dataset)));
 const selected={ref:aggregated,selector:{kind:'cell',page:0,row:1,column:1}};
 assert.deepEqual((await copied.measurements.inspect(selected)).aggregation,(await materials.measurements.inspect(selected)).aggregation);
 for(const view of ['groups','distribution','transitions','all'])assert.deepEqual(await copied.comparisons.page({ref:comparison,view}),await materials.comparisons.page({ref:comparison,view}));
 const revised=await copied.comparisons.save({...comparisonCommand,id:comparison.id,expectedRevision:comparison.revision,title:'Reviewed comparison'});
 const newBytes=Buffer.from('Returned observations\n'),added=await upload(copied,recordId,'returned.txt',newBytes),sender=new ResearchExchange(ws,f.member.deviceStore),changes=await sender.prepareChanges(),returned=await f.sa.receive(await sender.outgoing(changes.id)),reviewer=new ChangeReview(f.sa),review=await reviewer.review(returned.id);
 assert.equal(review.rows.length,1);assert.equal(review.rows[0].conflict,false);assert.equal(review.rows[0].baseRevision,review.rows[0].incomingRevision,'Evidence-only edits must still appear for review');
 const shown=await reviewer.materials(review.id,recordId,'incoming');assert.ok(shown.some(m=>m.id===added.id&&m.name==='returned.txt'&&m.size===newBytes.length));
 assert.deepEqual(await contentBuffer((await reviewer.file(review.id,recordId,'incoming','artifact',added.id)).content),newBytes);
 await assert.rejects(reviewer.file(review.id,f.book.entries[2].id,'incoming','artifact',added.id),{code:'COLLABORATION_PACKAGE'});
 await reviewer.apply({reviewId:review.id,choices:[{id:recordId,choice:'incoming'}]});assert.deepEqual(await contentBuffer((await materials.artifact(added)).content),newBytes);
 for(const ref of [comparison,revised]){
  assert.deepEqual(await materials.comparisons.page({ref,view:'distribution'}),await copied.comparisons.page({ref,view:'distribution'}));
  const doc=await materials.read(ref);await materials.comparisons.verify({recordId:doc.recordId,title:doc.title,...doc.content},doc.content.summary);
 }
});

test('linked historical methods require their book grant and remain exact after deletion',async t=>{
 const f=await fixture(t),method=f.book.entries[2],revision=recordRevision(method),run=f.book.entries[0],service=new ResearchRecords(f.author.workspace,{});
 await service.save({workspaceId:f.book.id,changes:[{id:run.id,expectedRevision:recordRevision(run),record:{...run,relations:[{id:randomUUID(),type:'Method',role:'uses-method',label:method.title,target:{workspaceId:f.book.id,kind:'record',id:method.id,revision}}]}}]});
 await assert.rejects(f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),{code:'COLLABORATION_DEPENDENCY'});
 await f.sa.access.saveLocal(await f.a.identity.public(),{workspaceId:f.book.id,expectedRevision:1,id:f.grant.id,organizationId:f.org.id,scopes:f.book.notebooks.map(n=>({kind:'notebook',id:n.id})),recipient:f.grant.recipient,role:'editor',active:true});
 await service.remove({workspaceId:f.book.id,recordId:method.id,expectedRevision:revision});
 const offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),incoming=await f.sb.receive(await f.sa.outgoing(offer.id)),destination=path.join(f.directory,'exact-method');await f.sb.acceptCopy(incoming.id,destination);
 const vault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const ws=new Workspace(destination,vault);assert.deepEqual(await new ResearchMaterials(ws).read({kind:'record',id:method.id,revision}),method);assert.ok(!(await ws.read()).book.entries.some(r=>r.id===method.id));
});

test('converted media and permitted custom fonts travel with their selected record',async t=>{
 const f=await fixture(t),ws=f.author.workspace,media=new MediaStore(ws.root,ws.vault),imports=new MediaImports(ws),jobs=workspaceJobs(ws),bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="teal"/></svg>');
 const upload=await imports.start({name:'inspection.svg',size:bytes.length,kind:'image'});await imports.receive(upload.id,[bytes]);await jobs.queue.enqueue({id:upload.id,type:'media.prepare',scope:f.book.id,input:{importId:upload.id,size:bytes.length}});jobs.worker.start();
 try{let done;for(let i=0;i<400;i++){done=await jobs.queue.read(upload.id);if(['completed','failed','cancelled'].includes(done.state))break;await delay(25);}assert.equal(done.state,'completed');}finally{await jobs.worker.stop();}
 const fonts=new WorkspaceFonts(ws),fontBytes=await readFile(new URL('../src/fonts/dm-sans.ttf',import.meta.url)),font=await fonts.import(fontBytes),original=f.book.entries[0],record={...original,body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Illustrated field inspection',marks:[{type:'font_family',attrs:{font:font.id}}]}]}]},attachments:[{id:upload.id,kind:'image',caption:'Inspection figure',alt:'Teal circle',share:false,transcript:''}]};
 await new ResearchRecords(ws,media).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(original),record}]});
 await assert.rejects(f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),{code:'FONT_EMBED'});await fonts.update(font.id,{embed:true,hidden:false});
 const offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),received=await f.sb.receive(await f.sa.outgoing(offer.id)),destination=path.join(f.directory,'illustrated-copy');await f.sb.acceptCopy(received.id,destination);
 const vault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const copy=new Workspace(destination,vault);assert.deepEqual(await contentBuffer((await new MediaImports(copy).original(upload.id)).content),bytes);assert.deepEqual((await new MediaStore(copy.root,copy.vault).get(upload.id)).bytes,(await media.get(upload.id)).bytes);assert.deepEqual((await new WorkspaceFonts(copy).get(font.id)).bytes,fontBytes);
 const prior=(await copy.read()).book.entries.find(r=>r.id===record.id);await new ResearchRecords(copy,new MediaStore(copy.root,copy.vault)).save({workspaceId:f.book.id,changes:[{id:prior.id,expectedRevision:recordRevision(prior),record:{...prior,title:'Reviewed illustrated observation'}}]});
 const sender=new ResearchExchange(copy,f.member.deviceStore),changes=await sender.prepareChanges(),returned=await f.sa.receive(await sender.outgoing(changes.id)),reviewer=new ChangeReview(f.sa),review=await reviewer.review(returned.id);assert.equal((await reviewer.fonts(review.id,record.id,'incoming'))[0].id,font.id);assert.deepEqual((await reviewer.file(review.id,record.id,'incoming','font',font.id)).content,fontBytes);await assert.rejects(reviewer.file(review.id,record.id,'incoming','font','custom-'+'0'.repeat(64)),{code:'NOT_FOUND'});
 assert.deepEqual(await contentBuffer((await reviewer.file(review.id,record.id,'incoming','media',upload.id)).content),(await media.get(upload.id)).bytes);
});

test('interrupted receives leave no staged plaintext; accepted additions and deletions share a rollback-safe receipt',async t=>{
 const f=await fixture(t),offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),packet=await Array.fromAsync(await f.sa.outgoing(offer.id));
 async function* interrupted(){yield* packet.slice(0,Math.floor(packet.length/2));throw new DOMException('Stopped','AbortError');}
 await assert.rejects(f.sb.receive(interrupted()),{name:'AbortError'});assert.deepEqual(await readdir(path.join(f.member.workspace.root,'.observanda/collaboration/staging')),[]);assert.deepEqual(await f.member.workspace.listMetadata('.observanda/collaboration/staging'),[]);
 const received=await f.sb.receive(packet),destination=path.join(f.directory,'rollback-copy');await f.sb.acceptCopy(received.id,destination);const vault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const ws=new Workspace(destination,vault),service=new ResearchRecords(ws,{}),book=(await ws.read()).book,removed=book.entries[1],added={...book.entries[0],id:randomUUID(),title:'New collaborator record',share:true,sections:[],figures:[],attachments:[],relations:[]};
 await service.remove({workspaceId:book.id,recordId:removed.id,expectedRevision:recordRevision(removed)});await service.save({workspaceId:book.id,changes:[{id:added.id,expectedRevision:null,record:added}]});
 const sender=new ResearchExchange(ws,f.member.deviceStore),changes=await sender.prepareChanges(),incoming=await f.sa.receive(await sender.outgoing(changes.id)),reviewer=new ChangeReview(f.sa),review=await reviewer.review(incoming.id),command={reviewId:review.id,choices:review.rows.map(r=>({id:r.id,choice:'incoming'}))};assert.deepEqual(review.rows.map(r=>r.kind).sort(),['added','removed']);
 const before=await f.author.workspace.read(),write=f.author.workspace.writeMetadata.bind(f.author.workspace);f.author.workspace.writeMetadata=async(name,value)=>{if(name.startsWith('.observanda/collaboration/receipts/'))throw Error('Synthetic receipt failure');return write(name,value);};
 try{await assert.rejects(reviewer.apply(command),/Synthetic receipt failure/);}finally{f.author.workspace.writeMetadata=write;}
 assert.deepEqual(await f.author.workspace.read(),before);await reviewer.apply(command);const after=(await f.author.workspace.read()).book;assert.equal(after.entries.find(r=>r.id===added.id).share,false);assert.ok(!after.entries.some(r=>r.id===removed.id));
 const staged=new ExchangeParts(f.author.workspace,incoming.id);await staged.open();const item=await staged.descriptor('description','selection'),file=staged.content(item).file,ciphertext=await readFile(file),damaged=Buffer.from(ciphertext);damaged[damaged.length-1]^=1;await writeFile(file,damaged);
 try{await assert.rejects(copyWorkspace(await copyPlan(f.author.workspace.root,path.join(f.directory,'damaged-backup')),{vault:f.author.vault}),{code:'ENCRYPTION_DAMAGED'});}finally{await writeFile(file,ciphertext);}
 const head=await staged.open(),forged=structuredClone(head);forged.attestation.value.manifestHash='0'.repeat(64);await f.author.workspace.withLock(()=>f.author.workspace.writeMetadata(staged.prefix+'/head.json',JSON.stringify(forged)));
 try{await assert.rejects(copyWorkspace(await copyPlan(f.author.workspace.root,path.join(f.directory,'forged-backup')),{vault:f.author.vault}),{code:'COLLABORATION_SIGNATURE'});}finally{await f.author.workspace.withLock(()=>f.author.workspace.writeMetadata(staged.prefix+'/head.json',JSON.stringify(head)));}
});
