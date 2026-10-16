// Synthetic older query payloads for compatibility tests. New browse summaries
// deliberately omit publication details, so removing fields from them cannot
// construct the older full documents these tests need to exercise.
import assert from 'node:assert/strict';
import {readQueryValue} from '../../src/record-query-storage.js';
import {digest,serialize} from '../../src/storage-format.js';

export async function legacyPublicationQuery(store,row,{missingReferences=false}={}){
 const source={slot:'record-query:'+row.id+':'+row.queryRevision,revision:row.queryRevision};
 const encoded=store.decode('state',source.slot,(await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot)).payload);
 const value=await readQueryValue(store,encoded,source,row,{stored:true,search:true});
 assert.ok(Object.hasOwn(value,'publicationDescriptor'));
 delete value.publicationDescriptor;if(missingReferences)delete value.referenceTargets;
 const {searchText,...summary}=value;void searchText;
 for(const [field,kind,document] of [['queryRevision','record-query',value],['summaryRevision','record-summary',summary]]){
  const revision=digest(serialize(document)),slot=kind+':'+row.id+':'+revision;
  assert.notEqual(revision,row[field]);
  await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,document));
  row[field]=revision;
 }
}
