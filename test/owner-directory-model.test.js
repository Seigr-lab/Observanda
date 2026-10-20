import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {ownerDirectorySortKey,ownerDirectoryRow,ownerDirectoryKeys,ownerDirectoryMarker,validOwnerDirectoryMarker} from '../src/owner-directory-model.js';
const id=value=>'10000000-0000-4000-8000-'+String(value).padStart(12,'0');
test('native directory keys preserve numeric, case and accent ties without locale collation',()=>{
 const labels=['Field 10','field 2','F\u00edeld 02','Field 1','\u00c6ther','zebra','Z\u00c9BRA','0','000',''];
 const entries=labels.map((label,index)=>({label,id:id(index),key:ownerDirectorySortKey(label,id(index))}));
 assert.deepEqual([...entries].sort((a,b)=>a.key<b.key?-1:1).map(value=>value.label),['','0','000','Field 1','field 2','F\u00edeld 02','Field 10','zebra','Z\u00c9BRA','\u00c6ther']);
 assert.equal(ownerDirectorySortKey('\u00c9COLE 0002',id(1)),ownerDirectorySortKey('ecole 2',id(1)));
 assert.notEqual(ownerDirectorySortKey('ecole 2',id(1)),ownerDirectorySortKey('ecole 2',id(2)));
 assert.ok(ownerDirectorySortKey('x'+('9'.repeat(159)),id(1))<ownerDirectorySortKey('x1'+('0'.repeat(159)),id(1)));
});
test('portable project rows and collision policies remain deterministic after owner relocation',()=>{
 const first=path.resolve('directory-source'),second=path.resolve('directory-target'),entry={projectId:id(1),namespaceId:id(2),vaultId:id(3),parentId:null,root:path.join(first,'Project 2'),summary:{title:'Project 2',description:'',kind:'Project',templateName:null}};
 const saved=ownerDirectoryRow('projects','active',entry,first);assert.deepEqual(saved.entry.root,{relative:'Project 2'});
 assert.equal(ownerDirectoryRow('projects','active',saved.entry,second,{stored:true}).entry.root,path.join(second,'Project 2'));
 assert.equal(ownerDirectoryKeys('projects',saved).location,'relative:Project 2');
 const book=ownerDirectoryRow('books','active',{labBookId:id(4),namespaceId:id(5),vaultId:id(6),directory:'Field Book'},first);
 assert.equal(ownerDirectoryKeys('books',book,{namePolicy:'folded'}).location,'field book');assert.equal(ownerDirectoryKeys('books',book,{namePolicy:'exact'}).location,'Field Book');
 assert.throws(()=>ownerDirectoryRow('projects','active',{...saved.entry,root:{relative:'../outside'}},second,{stored:true}),{code:'FORMAT'});
 assert.throws(()=>ownerDirectoryRow('books','active',{...book.entry,directory:'.observanda'},first),{code:'FORMAT'});
});
test('upgrade markers bind only the correct owner, directory kind and retained original receipt',()=>{
 const marker=ownerDirectoryMarker('projects',id(1),'a'.repeat(64));assert.equal(marker.version,8);assert.equal(validOwnerDirectoryMarker(marker,'projects',id(1)),true);
 assert.equal(validOwnerDirectoryMarker(marker,'projects',id(2)),false);assert.equal(validOwnerDirectoryMarker(marker,'books',id(1)),false);
 assert.equal(validOwnerDirectoryMarker({...marker,projects:[]},'projects',id(1)),false);
 assert.equal(validOwnerDirectoryMarker({...marker,ownerDirectory:{...marker.ownerDirectory,receipt:'new'}},'projects',id(1)),false);
});
