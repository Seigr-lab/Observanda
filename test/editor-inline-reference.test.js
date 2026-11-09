import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EditorState,TextSelection} from 'prosemirror-state';
import {history,undo,redo} from 'prosemirror-history';
import {schema} from '../src/editor/schema.js';
import {inlineLinkTransaction} from '../src/editor/inline-link-transaction.js';
import {pdfNoteCall,pdfNoteLocations} from '../src/web/pdf-notes-model.js';

test('rich-text transactions insert a reference at the caret and preserve surrounding text and history',()=>{
 const doc=schema.nodeFromJSON({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Compare  here.',marks:[{type:'strong'}]}]}]});
 let state=EditorState.create({schema,doc,plugins:[history()],selection:TextSelection.create(doc,9)});
 const href='#pdf-reference-v1:'+randomUUID()+':'+randomUUID()+':figure:'+randomUUID();
 const dispatch=tr=>{state=state.apply(tr);};
 dispatch(inlineLinkTransaction(state,{href,label:'Figure: sample'}));assert.equal(state.doc.textContent,'Compare Figure: sample here.');
 const inserted=state.doc.firstChild.child(1);assert.equal(schema.marks.link.isInSet(inserted.marks).attrs.href,href);assert.ok(schema.marks.strong.isInSet(inserted.marks));
 dispatch(state.tr.insertText(' locally'));assert.equal(schema.marks.link.isInSet(state.doc.firstChild.lastChild.marks),undefined);
 assert.ok(undo(state,dispatch));assert.ok(redo(state,dispatch));assert.match(state.doc.textContent,/Figure: sample locally/);
 assert.equal(inlineLinkTransaction(state,{href:'javascript:alert(1)',label:'Invalid'}),null);
});

test('note transactions annotate selected prose, relocate a single marker, and remove it without deleting user text',()=>{
 const doc=schema.nodeFromJSON({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Keep the first sentence.'}]},{type:'paragraph',content:[{type:'text',text:'Last paragraph.'}]}]});
 const noteId=randomUUID(),call={href:pdfNoteCall(noteId),label:'†'};
 let state=EditorState.create({schema,doc,selection:TextSelection.create(doc,1,5)});
 state=state.apply(inlineLinkTransaction(state,call,'insert'));
 assert.equal(state.doc.firstChild.textContent,'Keep† the first sentence.');assert.deepEqual(pdfNoteLocations(state.doc.toJSON()).get(noteId),{block:0,ordinal:0,ambiguous:false});
 state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,1,state.doc.content.size-1)));
 state=state.apply(inlineLinkTransaction(state,call,'move'));assert.equal(state.doc.firstChild.textContent,'Keep the first sentence.');assert.equal(state.doc.lastChild.textContent,'Last paragraph.†');
 assert.deepEqual(pdfNoteLocations(state.doc.toJSON()).get(noteId),{block:1,ordinal:0,ambiguous:false});
 state=state.apply(inlineLinkTransaction(state,call,'remove'));assert.ok(state.doc.eq(doc));
});
