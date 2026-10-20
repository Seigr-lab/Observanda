import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NativePortabilityCollection} from '../src/portability-collection.js';
import {validNativeRelocation,validNativeRelocationOwner} from '../src/native-relocation-owners.js';
const hash='a'.repeat(64),identity={dev:'1',ino:'2'};
const owner=()=>({kind:'project',relative:'',projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),parentId:null,summary:null,bookRevision:hash,identity,accessHash:hash,descriptorHash:hash,sourceId:randomUUID()});
const ref=count=>{const value=new NativePortabilityCollection(null,randomUUID()).empty();value.count=count;if(count)value.roots.order={count,height:1,hash,first:'0',last:String(count)};return value;};
test('native relocation admits bounded roots beyond former aggregate counts without admitting mixed recovery namespaces',()=>{
 const value={ownerDirectoryVersion:2,owners:ref(50002),ownerKeys:ref(50001),projectRegistryRevision:hash,phase:'prepared'};assert.equal(validNativeRelocation(value),true);assert.ok(JSON.stringify(value).length<4096);
 for(const edit of [v=>v.ownerKeys.id=v.owners.id,v=>v.ownerKeys.count--,v=>v.ownerDirectoryVersion=1,v=>v.projectRegistryRevision='bad',v=>v.keysReleased=true,v=>v.copied=false]){const invalid=structuredClone(value);edit(invalid);assert.equal(validNativeRelocation(invalid),false);}
 assert.equal(validNativeRelocation({...value,phase:'complete',keysReleased:true}),true);assert.equal(validNativeRelocation({...value,phase:'preparing',owners:ref(0),ownerKeys:ref(0)}),true);
});
test('relocation owner rows reject path, identity, summary and incomplete destination proofs',()=>{
 const value=owner();assert.equal(validNativeRelocationOwner(value),true);const book={...value,kind:'lab-book',relative:'Literal Book',labBookId:randomUUID()};for(const key of ['parentId','summary','bookRevision'])delete book[key];assert.equal(validNativeRelocationOwner(book),true);
 const proof={max:0,count:1,digest:hash},complete={...value,destinationId:randomUUID(),destinationIdentity:identity,retention:{snapshots:proof,module_events:proof}};assert.equal(validNativeRelocationOwner(complete),true);
 for(const edit of [v=>v.relative='../outside',v=>v.relative='parent//child',v=>v.relative='.observanda/child',v=>v.relative='C:/outside',v=>v.relative='child\\book',v=>v.identity={dev:'1',ino:'bad'},v=>v.projectId='bad',v=>v.bookRevision='',v=>v.summary={title:'bad'},v=>v.key='credential',v=>v.destinationId=v.sourceId,v=>v.destinationIdentity=identity]){const invalid=structuredClone(value);edit(invalid);assert.equal(validNativeRelocationOwner(invalid),false);}
 assert.equal(validNativeRelocationOwner({...complete,retention:{}}),false);assert.equal(validNativeRelocationOwner({...book,relative:'a/'.repeat(128)+'b'}),false);
});
