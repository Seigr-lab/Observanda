import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {upgradeNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';

// A lab book made from its project's template keeps a reference to its record
// types. Catalogue results carry that admitted reference; a document from
// anywhere else must still carry its complete configuration.
test('catalogue results keep configuration references that other documents may not carry',()=>{
 const book=sampleNotebook(),notebook=book.notebooks[0],root='a'.repeat(64);
 notebook.configuration={format:'observanda-configuration',version:1,owner:{workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'},root,index:{version:1,source:root,root:null}};
 const result=upgradeNotebook(book,{configurationReferences:true});
 assert.equal(result.notebooks[0].configuration.root,root);
 assert.throws(()=>upgradeNotebook(book),{code:'INVALID'});
 // A reference bound to another lab book is never accepted.
 const foreign=structuredClone(book);foreign.notebooks[0].configuration.owner.notebookId=foreign.notebooks[1]?.id??randomUUID();
 assert.throws(()=>upgradeNotebook(foreign,{configurationReferences:true}),{code:'INVALID'});
});
