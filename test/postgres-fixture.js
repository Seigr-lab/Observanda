import assert from 'node:assert/strict';
import {openCatalogue} from '../src/postgres.js';
import {encrypted} from '../src/encryption.js';
import {projectDomainSchema,projectDomainSchemas} from '../src/project-domain-schema.js';
// Module data lives in each module domain's own schema; the workspace schema keeps the rest.
export async function assertPrivateCatalogue(root,...sentinels){
 const db=await openCatalogue(root);
 try{
  const rows=[];
  for(const domain of [null,...await projectDomainSchemas(db)]){const schema=domain?'"'+projectDomainSchema(db.id,domain)+'".':'';rows.push(...await db.all('SELECT payload FROM '+schema+'module_entities UNION ALL SELECT payload FROM '+schema+'module_events UNION ALL SELECT payload FROM '+schema+'objects'));}
  assert.ok(rows.length);for(const {payload} of rows){assert.ok(encrypted(payload));for(const text of sentinels)assert.equal(payload.includes(Buffer.from(text)),false);}
 }finally{await db.close();}
}
