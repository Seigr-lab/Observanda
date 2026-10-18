import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unsavedChanges} from '../src/web/unsaved-changes.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,options={}){
 const buttons=new Map(),alert={hidden:true,textContent:''};
 const dialog={open:false,setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},
  set innerHTML(value){this.markup=value;buttons.clear();for(const [,choice] of value.matchAll(/data-choice="([^" ]+)"/g))buttons.set(choice,{dataset:{choice},disabled:false,focus(){}});},
  querySelectorAll:()=>[...buttons.values()],querySelector:selector=>selector==='[role="alert"]'?alert:buttons.get('stay')};
 const previous=globalThis.document;globalThis.document={createElement:()=>dialog,body:{append(){}}};t.after(()=>{globalThis.document=previous;});
 const state={labels:[],busy:false,navigations:[],messages:[],writes:[],preparations:[]};
 const guard=unsavedChanges({esc:value=>value,defaultScope:'navigation',changes:scope=>({labels:[...state.labels],forms:[scope],canSave:true}),busy:()=>state.busy,notify:message=>state.messages.push(message),
  flush:options.flush,prepare:scope=>{state.preparations.push(scope);return options.prepare?.(scope);},
  save:async(...args)=>{state.writes.push('save');return options.save?.(...args);},discard:async(...args)=>{state.writes.push('discard');return options.discard?.(...args);}});
 const choose=choice=>{const button=buttons.get(choice);assert.ok(button);assert.equal(button.disabled,false);return dialog.onclick({target:{closest:()=>button}});};
 const escape=()=>dialog.oncancel({preventDefault(){}});
 const run=(name='next',options)=>guard.run(()=>state.navigations.push(name),options);
 return {state,guard,dialog,buttons,alert,choose,escape,run};
}

test('a nondurable draft offers a decision immediately without awaiting its queued checkpoint',async t=>{
 const checkpoint=deferred(),f=fixture(t,{prepare:()=>checkpoint.promise});f.state.labels=['Module edits'];
 const leaving=f.run();assert.equal(f.dialog.open,true);assert.deepEqual(f.state.preparations,[]);assert.equal(f.guard.isActive(),true);
 await f.choose('stay');assert.equal(await leaving,false);assert.deepEqual(f.state.navigations,[]);assert.deepEqual(f.state.writes,[]);
 checkpoint.resolve();await turn();assert.equal(f.dialog.open,false);assert.deepEqual(f.state.navigations,[]);
});

test('a durable draft prepares its return token without applying it or opening a decision',async t=>{
 const checkpoint=deferred(),f=fixture(t,{prepare:()=>checkpoint.promise}),leaving=f.run();
 assert.equal(f.dialog.open,false);assert.equal(f.guard.canLeaveImmediately(),false);assert.deepEqual(f.state.preparations,['navigation']);
 checkpoint.resolve();assert.equal(await leaving,true);assert.deepEqual(f.state.navigations,['next']);assert.deepEqual(f.state.writes,[]);assert.equal(f.dialog.open,false);
});

test('edits made during safe preparation still require a decision',async t=>{
 const checkpoint=deferred(),f=fixture(t,{prepare:()=>checkpoint.promise}),leaving=f.run('next',{scope:'all'});
 f.state.labels=['Newer edit'];checkpoint.resolve();await turn();assert.equal(f.dialog.open,true);assert.deepEqual(f.state.preparations,['all']);
 await f.choose('stay');assert.equal(await leaving,false);assert.deepEqual(f.state.navigations,[]);
});

test('a failed current preparation retains the draft and reports its original error',async t=>{
 const checkpoint=deferred(),f=fixture(t,{prepare:()=>checkpoint.promise}),leaving=f.run(),failure=Error('Checkpoint unavailable');
 const rejected=assert.rejects(leaving,error=>error===failure);f.state.labels=['Retained input'];checkpoint.reject(failure);await rejected;
 assert.equal(f.dialog.open,false);assert.equal(f.guard.canLeaveImmediately(),false);assert.deepEqual(f.state.navigations,[]);assert.deepEqual(f.state.writes,[]);
});

for(const outcome of ['success','failure'])test(`a newer decision supersedes an older preparation ${outcome}`,async t=>{
 const checkpoint=deferred(),f=fixture(t,{prepare:()=>checkpoint.promise}),older=f.run('old');
 f.state.labels=['Newer edit'];const newer=f.run('new');assert.equal(f.dialog.open,true);assert.deepEqual(f.state.preparations,['navigation']);
 await f.choose('stay');assert.equal(await newer,false);
 if(outcome==='success')checkpoint.resolve();else checkpoint.reject(Error('Obsolete checkpoint error'));
 assert.equal(await older,false);assert.equal(f.dialog.open,false);assert.deepEqual(f.state.navigations,[]);assert.deepEqual(f.state.messages,[]);
});

for(const choice of ['save','discard'])for(const exit of ['stay','escape'])test(`pending ${choice} remains cancellable with ${exit} and cannot navigate on its late reply`,async t=>{
 const write=deferred(),f=fixture(t,{[choice]:()=>write.promise});f.state.labels=['Module edits'];const first=f.run('old'),operation=f.choose(choice);await turn();
 assert.equal(f.buttons.get('stay').disabled,false);assert.equal(f.buttons.get('save').disabled,true);
 if(exit==='escape')f.escape();else await f.choose('stay');assert.equal(await first,false);
 const second=f.run('new');assert.equal(f.dialog.open,true);assert.equal(f.buttons.get('discard').disabled,true);
 write.resolve();await operation;await turn();assert.equal(f.dialog.open,true);assert.equal(f.buttons.get('save').disabled,false);assert.deepEqual(f.state.navigations,[]);assert.deepEqual(f.state.writes,[choice]);
 await f.choose('stay');assert.equal(await second,false);assert.deepEqual(f.state.messages,[]);
});

test('a new busy operation cannot be bypassed by completed preparation',async t=>{
 const checkpoint=deferred(),f=fixture(t,{prepare:()=>checkpoint.promise}),leaving=f.run();f.state.busy=true;checkpoint.resolve();
 assert.equal(await leaving,false);assert.equal(f.dialog.open,false);assert.equal(f.state.messages.length,1);assert.deepEqual(f.state.navigations,[]);
});


test('automatic changes save before navigation without a manual confirmation',async t=>{
 const write=deferred(),f=fixture(t,{flush:()=>write.promise});f.state.labels=['Automatic edits'];const leaving=f.run();
 assert.equal(f.dialog.open,false);assert.equal(f.guard.canLeaveImmediately(),false);assert.deepEqual(f.state.navigations,[]);
 f.state.labels=[];write.resolve();assert.equal(await leaving,true);assert.deepEqual(f.state.navigations,['next']);assert.equal(f.dialog.open,false);
});

test('a failed automatic save keeps the current screen and its unsaved input',async t=>{
 const write=deferred(),f=fixture(t,{flush:()=>write.promise});f.state.labels=['Automatic edits'];const leaving=f.run(),failure=Error('Save unavailable');
 const rejected=assert.rejects(leaving,error=>error===failure);write.reject(failure);await rejected;
 assert.equal(f.dialog.open,false);assert.equal(f.guard.canLeaveImmediately(),false);assert.deepEqual(f.state.navigations,[]);assert.deepEqual(f.state.labels,['Automatic edits']);
});

test('only the latest navigation runs after a shared automatic save',async t=>{
 const write=deferred(),f=fixture(t,{flush:()=>write.promise});f.state.labels=['Automatic edits'];const older=f.run('old'),newer=f.run('new');
 f.state.labels=[];write.resolve();assert.equal(await older,false);assert.equal(await newer,true);assert.deepEqual(f.state.navigations,['new']);
});
