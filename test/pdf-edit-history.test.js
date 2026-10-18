import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfEditHistory,pdfEditHistoryShortcut} from '../src/web/pdf-edit-history.js';
function fixture({limit=50}={}){
 let selected={header:{id:'document'},revision:'a'},head='a',next=0,flush=async()=>{},reopen=async value=>{selected={header:{id:value.id},revision:value.revision};};
 const calls=[],receipts=new Map();let lost=false;
 const history=pdfEditHistory({limit,getDocument:()=>selected,flush:()=>flush(),uuid:()=>String(++next),restore:async command=>{calls.push(structuredClone(command));if(receipts.has(command.commandId))return receipts.get(command.commandId);assert.equal(command.expectedRevision,head,'CONFLICT');head=command.operation.revision;const result={revision:head};receipts.set(command.commandId,result);if(lost){lost=false;throw Error('Response lost');}return result;},reopen:value=>reopen(value)});history.observe(selected);
 return {history,calls,get selected(){return selected;},get head(){return head;},save(revision){const before=selected.revision;head=revision;history.record({id:selected.header.id,expectedRevision:before},{revision});selected.revision=revision;},external(revision){head=revision;},flush(value){flush=value;},reopen(value){reopen=value;},loseResponse(){lost=true;},open(id,revision){selected={header:{id},revision};history.observe(selected);}};
}
test('document undo flushes saved work and restores revisions without duplicate entries',async()=>{
 const f=fixture();f.save('b');f.flush(async()=>{f.flush(async()=>{});f.save('c');});
 assert.equal(await f.history.run('undo'),true);assert.equal(f.head,'b');assert.equal(f.history.state().undo,1);assert.equal(f.history.state().redo,1);
 await f.history.run('undo');assert.equal(f.head,'a');await f.history.run('redo');assert.equal(f.head,'b');await f.history.run('redo');assert.equal(f.head,'c');
 // Manual history restoration is an ordinary saved change and is undoable.
 f.save('a');await f.history.run('undo');assert.equal(f.head,'c');
});
test('conflicts preserve the selected editor, history and another writer revision',async()=>{
 const f=fixture();f.save('b');f.external('other');const before=f.history.state();await assert.rejects(f.history.run('undo'),/CONFLICT/);
 assert.equal(f.head,'other');assert.equal(f.selected.revision,'b');assert.equal(f.history.state().undo,before.undo);assert.equal(f.history.state().redo,0);
 f.open('document','other');assert.equal(f.history.state().canUndo,false);
});
test('lost restore response retries its exact command and failed reload never repeats undo',async()=>{
 const f=fixture();f.save('b');f.save('c');f.loseResponse();await assert.rejects(f.history.run('undo'),/Response lost/);assert.equal(f.head,'b');assert.equal(f.selected.revision,'c');
 let fail=true;f.reopen(async value=>{if(fail){fail=false;throw Error('Reload interrupted');}f.open(value.id,value.revision);});
 await assert.rejects(f.history.run('undo'),/Reload interrupted/);assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.history.state().undo,1);
 await f.history.run('undo');assert.equal(f.calls.length,2);assert.equal(f.selected.revision,'b');assert.equal(f.history.state().redo,1);
});
test('revision stacks are bounded, exact replays are ignored and another document clears them',async()=>{
 const f=fixture({limit:2});f.save('b');f.save('c');f.save('d');f.history.record({id:'document',expectedRevision:'c'},{revision:'d'});assert.equal(f.history.state().undo,2);
 await f.history.run('undo');f.save('e');assert.equal(f.history.state().redo,0);f.open('another','x');assert.equal(f.history.state().undo,0);assert.equal(await f.history.run('undo'),false);
});
test('document shortcuts leave native inputs, rich text and composed input to their own undo',()=>{
 const event={key:'z',ctrlKey:true,target:{closest:()=>null}};assert.equal(pdfEditHistoryShortcut(event),'undo');assert.equal(pdfEditHistoryShortcut({...event,shiftKey:true}),'redo');assert.equal(pdfEditHistoryShortcut({...event,key:'y'}),'redo');
 for(const extra of [{isComposing:true},{defaultPrevented:true},{repeat:true},{altKey:true},{target:{closest:()=>({})}},{composedPath:()=>[{isContentEditable:true}]}])assert.equal(pdfEditHistoryShortcut({...event,...extra}),null);
});

test('an old document restore response cannot update a newly opened document',async()=>{
 let release,entered;const waiting=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);let selected={header:{id:'old'},revision:'a'},reopens=0;
 const history=pdfEditHistory({getDocument:()=>selected,flush:async()=>{},uuid:()=> 'restore',restore:async()=>{entered();await hold;return {revision:'a'};},reopen:async()=>{reopens++;}});
 history.observe(selected);history.record({id:'old',expectedRevision:'a'},{revision:'b'});selected.revision='b';const operation=history.run('undo');await waiting;selected={header:{id:'new'},revision:'x'};history.observe(selected);release();assert.equal(await operation,false);assert.equal(reopens,0);assert.equal(history.state().undo,0);assert.equal(history.state().redo,0);
});
