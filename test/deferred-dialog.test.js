import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deferredDialog} from '../src/web/deferred-dialog.js';

test('deferred dialogs coalesce loading and preserve synchronous delegation after creation',async()=>{
 let loads=0,creates=0,resolve;
 const ui=deferredDialog({context:()=>1,changed:()=>Error('Changed'),load:()=>{loads++;return new Promise(done=>{resolve=done;});}});
 assert.equal(ui.current(),null);assert.equal(ui.loading(),false);assert.equal(loads,0);
 const a=ui.invoke('read',1),b=ui.invoke('read',2);
 await Promise.resolve();
 assert.equal(ui.loading(),true);assert.equal(loads,1);
 resolve(()=>{creates++;return {read:value=>value*2};});
 assert.deepEqual(await Promise.all([a,b]),[2,4]);assert.equal(creates,1);assert.equal(ui.loading(),false);
 assert.equal(ui.current().read(3),6);assert.equal(await ui.invoke('read',4),8);assert.equal(loads,1);
});

test('deferred dialogs refuse an old owner or route and allow a new action after loading',async()=>{
 let owner='one',resolve,creates=0,calls=0;
 const create=()=>{creates++;return {save:()=>{calls++;return owner;}};};
 const ui=deferredDialog({context:()=>owner,changed:()=>Error('Changed'),load:()=>new Promise(done=>{resolve=done;})});
 const old=ui.invoke('save');owner='two';const current=ui.invoke('save');await Promise.resolve();resolve(create);
 await assert.rejects(old,/Changed/);assert.equal(await current,'two');assert.equal(creates,1);assert.equal(calls,1);
});

test('failed dialog loading can be retried without retaining a partial instance',async()=>{
 let calls=0;
 const ui=deferredDialog({context:()=>1,changed:()=>Error('Changed'),load:()=>{if(!calls++)throw Error('Unavailable chunk');return ()=>({open:()=>true});}});
 await assert.rejects(ui.invoke('open'),/Unavailable chunk/);assert.equal(ui.current(),null);assert.equal(ui.loading(),false);
 assert.equal(await ui.invoke('open'),true);assert.equal(calls,2);
});
