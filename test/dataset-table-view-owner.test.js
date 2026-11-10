import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {tableViewRequest} from '../src/dataset-table-views.js';
import {emptyTableQuery} from '../src/web/dataset-table-query.js';

test('saved table views move only with their record and preserve a renamed or removed view on return', {timeout:180000},async t=>{
 const fixture=await projectTreeFixture(t),[from,to]=fixture.books,directory=new LabBookDirectory(fixture.registry);
 for(const book of [from,to])await directory.register(book.projectId,book);
 const storage=book=>new LabBookStorage(book.root,book.labBookId,book.key);
 const owner=book=>({projectId:book.projectId,labBookId:book.labBookId,workspaceId:book.namespaceId});
 const a=new ResearchMaterials(storage(from)),b=new ResearchMaterials(storage(to)),recordId=from.before.book.entries[0].id;
 async function move(source,target,oldBook,newBook){
  const row=await source.workspace.catalogue(async store=>store.member(await store.snapshot(),recordId));
  const transfer=new RecordOwnerTransfer(source.workspace,target.workspace,{registry:fixture.registry,sourceOwner:owner(oldBook),targetOwner:owner(newBook)});
  const command={id:randomUUID(),recordId,workspaceId:oldBook.namespaceId,sourceNotebookId:oldBook.labBookId,targetWorkspaceId:newBook.namespaceId,targetNotebookId:newBook.labBookId,expectedStorageRevision:row.revision};
  return transfer.start(command,{signal:t.signal});
 }
 const bytes=Buffer.from('Count\n10\n11\n'),u=await a.startImport({recordId,name:'counts.csv',size:bytes.length});await a.appendImport(u.id,0,[bytes]);
 const ref=await a.dataset({recordId,title:'Counts',artifact:await a.finishImport(u.id)});
 const settings={query:emptyTableQuery(),pinned:[0],hidden:[],columnOffset:0};
 const request=(m,operation,args)=>tableViewRequest(m,'table-view-'+operation,{...args,ref},{signal:t.signal});
 const create=name=>request(a,'save',{id:randomUUID(),previous:null,name,settings});
 const one=await create('Small counts'),two=await create('Old labels');
 assert.equal((await move(a,b,from,to)).phase,'complete');
 await assert.rejects(request(a,'list',{after:null}));
 const listed=await request(b,'list',{after:null});assert.deepEqual(new Set(listed.items.map(v=>v.name)),new Set(['Small counts','Old labels']));
 await request(b,'save',{id:one.id,previous:one.revision,name:'Reviewed counts',settings});
 await request(b,'remove',{id:two.id,previous:two.revision});
 assert.equal((await move(b,a,to,from)).phase,'complete');
 await assert.rejects(request(b,'list',{after:null}));
 assert.deepEqual((await request(a,'list',{after:null})).items.map(v=>v.name),['Reviewed counts']);
 assert.equal((await a.current(ref.id)).revision,ref.revision);
});
