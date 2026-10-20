import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicationFragments} from '../src/publication-edition-fragments.js';

const text=async stream=>(await Array.fromAsync(stream)).join('');
test('fragment templates preserve exact literals, repeated tokens and independent overrides',async()=>{
 const fragments=new PublicationFragments(),first=fragments.add(async function*(){yield 'first';}),second=fragments.add(async function*(){yield 'second';}),unknown=fragments.prefix+'999-->',html='before'+first+'middle'+second+first+unknown+'after';
 const compiled=fragments.compile(html);assert.equal(fragments.compile(html),compiled);
 assert.equal(await text(fragments.expand(html)),'beforefirstmiddlesecondfirst'+unknown+'after');
 assert.equal(await text(fragments.expand(html,new Map([[second,async function*(){yield 'selected';}]]))),'beforefirstmiddleselectedfirst'+unknown+'after');
 assert.equal(await text(fragments.expand('literal '+fragments.prefix)),'literal '+fragments.prefix);
 assert.equal(await text(fragments.expand('')),'');
 const future=fragments.prefix+fragments.parts.size+'-->';assert.equal(await text(fragments.expand(future)),future);
 assert.equal(fragments.add(async function*(){yield 'registered later';}),future);
 assert.equal(await text(fragments.expand(future)),'registered later');
});
