import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {linkCheck,linksValid} from '../src/modules/validation.js';
import {workspaceSnapshotRequest} from '../src/workspace-read-admission.js';
import {projectModuleRequest} from '../src/project-module-requests.js';
import {projectRequest} from '../src/project-application.js';
const reference=()=>({workspaceId:randomUUID(),type:'record',id:randomUUID()});
test('new foreign references require an explicit capability while retained references remain editable',async()=>{
 const book={id:randomUUID(),projects:[],notebooks:[]},ref=reference(),tx={book,hasRecord:()=>false,has:()=>false};
 await assert.rejects(linkCheck(tx,[ref]),{code:'MODULE_REFERENCE'});
 await linkCheck(tx,[ref],[ref]);await linkCheck(tx,[],[ref]);
 const checked=[];await linkCheck({...tx,externalReference:async value=>{checked.push(value);return true;}},[ref]);assert.deepEqual(checked,[ref]);
 await assert.rejects(linkCheck({...tx,externalReference:async()=>false},[ref]),{code:'MODULE_REFERENCE'});
 await assert.rejects(linkCheck({...tx,externalReference:async()=>{throw Object.assign(Error('revoked'),{code:'ACCESS_LOCKED'});}},[ref]),{code:'ACCESS_LOCKED'});
 await linkCheck({...tx,externalReference:async()=>true},[{...ref,workspaceId:book.id}]);
 await assert.rejects(linkCheck({...tx,hasRecord:()=>true,externalReference:async()=>{throw Object.assign(Error('authoritative target locked'),{code:'ACCESS_LOCKED'});}},[{...ref,workspaceId:book.id}]),{code:'ACCESS_LOCKED'});
 await assert.rejects(linkCheck({...tx,externalReference:async()=>true},[{...ref,workspaceId:book.id,type:'calendar'}]),{code:'MODULE_REFERENCE'});
});
test('reference discovery and resolution are snapshot readers in every owner route',()=>{
 const projectId=randomUUID(),bookId=randomUUID();
 for(const method of ['owners','query','labels','resolve','incoming']){
  const route='/api/modules/references/'+method;assert.equal(workspaceSnapshotRequest('POST',route),true);assert.equal(projectModuleRequest(route).write,false);
  for(const prefix of ['/api/projects/'+projectId,'/api/projects/'+projectId+'/lab-books/'+bookId])assert.equal(projectRequest(prefix+route.slice(4),'POST').write,false);
 }
 assert.equal(workspaceSnapshotRequest('POST','/api/modules/command'),false);
});

test('reference uniqueness follows namespace, type and identity independently of property order',async()=>{
 const ref=reference(),reordered={id:ref.id,type:ref.type,workspaceId:ref.workspaceId};
 assert.equal(linksValid([ref,reordered]),false);
 await assert.rejects(linkCheck({book:{id:ref.workspaceId}},[ref,reordered],[ref]),{code:'MODULE_INVALID'});
 assert.equal(linksValid([ref,{...ref,workspaceId:randomUUID()}]),true);
 assert.equal(linksValid([ref,{...ref,type:'calculation'}]),true);
 assert.equal(linksValid([ref,{...ref,id:randomUUID()}]),true);
});
