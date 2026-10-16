import assert from 'node:assert/strict';
import {openCatalogue} from '../src/postgres.js';
import {encrypted} from '../src/encryption.js';
export async function assertPrivateCatalogue(root,...sentinels){
 const db=await openCatalogue(root);
 try{const rows=await db.all('SELECT payload FROM module_entities UNION ALL SELECT payload FROM module_events UNION ALL SELECT payload FROM objects');assert.ok(rows.length);for(const {payload} of rows){assert.ok(encrypted(payload));for(const text of sentinels)assert.equal(payload.includes(Buffer.from(text)),false);}}
 finally{await db.close();}
}
