import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from '../browser/encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {OrganizationExchange} from '../../src/collaboration/organization-exchange.js';
import {ResearchExchange} from '../../src/collaboration/research-exchange.js';

export async function collaborationFixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-collaboration-')),vaults=[];
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
