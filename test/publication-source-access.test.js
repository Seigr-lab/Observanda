import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PublicationSourceAccess} from '../src/publication-source-access.js';

test('deployment access is isolated by job and cannot be borrowed after close',async()=>{
 const access=new PublicationSourceAccess(),a=randomUUID(),b=randomUUID(),first=async()=>({owner:'first'}),second=async()=>({owner:'second'});
 const revoke=access.bind(a,first);access.bind(b,second);access.bind(a,second);revoke();
 assert.deepEqual(await access.take(a)(),{owner:'second'});assert.equal(access.take(a),undefined);assert.deepEqual(await access.take(b)(),{owner:'second'});
 access.bind(a,first);access.clear();assert.equal(access.take(a),undefined);assert.throws(()=>access.bind(a,undefined),{code:'ACCESS_LOCKED'});
});
