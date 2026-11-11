import test from 'node:test';
import assert from 'node:assert/strict';
import {rebasePageHistory} from '../src/web/website-history-rebase.js';
import {presentationValues} from '../src/web/website-placement-presentation.js';

test('a presentation step restores exactly the presentation it replaced',()=>{
 assert.deepEqual(presentationValues({format:'full',choice:'',hidden:['tags','details'],layout:'split',cover:'',date:false}),{presentation:'full',hidden:['details','tags'],layout:'split'});
 assert.deepEqual(presentationValues({format:'card',choice:'body',hidden:[],layout:'article',cover:'media:x',date:true}),{presentation:'card',choice:'body',cover:'media:x',date:true});
 assert.deepEqual(presentationValues({format:'card',choice:'title',cover:'',date:false}),{presentation:'card',choice:'title',cover:null,date:false});
 assert.deepEqual(presentationValues({format:'section',choice:'section:a'}),{presentation:'section',choice:'section:a'});
});

test('page history keeps presentation steps in place when it adopts a saved page',()=>{
 const page=html=>({html:'<!doctype html><html><head></head><body><main>'+html+'</main></body></html>',css:'',sourceStamp:'s'});
 const step={presentation:{sourceId:'a'.repeat(64),ordinal:0,before:{presentation:'full',hidden:[],layout:'article'},after:{presentation:'card',choice:'title',cover:null,date:false}},html:'',css:'',sourceStamp:'s'};
 const from=page('<p>One</p><p>Two</p>'),next=page('<p>One</p><p>Two</p><p>Saved</p>');
 // Rebasing authored pages needs a browser; a presentation step needs none.
 const {entries,skipped}=rebasePageHistory([step,step],from,next);
 assert.deepEqual(entries,[step,step]);assert.equal(skipped,0);
});
