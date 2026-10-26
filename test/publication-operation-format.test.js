import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationCatalogueGeneration,configurationCatalogueFeatures,catalogueFormat,restoreConfigurationCatalogueFormat,requirePublicationOperations,requireWeightedFit,catalogueRequiresPublicationOperations,catalogueRequiresWeightedFit,CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';
import {publicationOperationMetadata,assertPublicationOperationFormat} from '../src/publication-operation-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false},olderMaximum=422212465066105;
function database(version=122){return {version,all:async function(){return [{version:this.version}];},get:async()=>null,run:async function(sql,...values){if(sql.startsWith('UPDATE catalogue_format'))this.version=values[0];}};}
test('durable publication generations preserve independent capabilities and refuse unknown or missing admission',async()=>{
 for(const owners of [0,1,2])for(const website of [0,3])for(const prior of [base,{...base,publication:true,transfers:true,permissions:true,sourceSelections:true},{...base,weightedFit:true}]){
  const db=database(configurationCatalogueGeneration({...prior,owners,website,weightedFit:false}));if(prior.weightedFit)await requireWeightedFit(db);const original=db.version;await requirePublicationOperations(db);
  assert.ok(db.version>olderMaximum);assert.deepEqual(configurationCatalogueFeatures(db.version),{...configurationCatalogueFeatures(original),publicationOperations:true});assert.equal(catalogueRequiresWeightedFit(db.version),prior.weightedFit===true);
  const reopened=database();await restoreConfigurationCatalogueFormat(reopened,db.version);assert.equal(reopened.version,db.version);
  await requireWeightedFit(db);assert.equal(catalogueRequiresPublicationOperations(db.version),true);assert.equal(catalogueRequiresWeightedFit(db.version),true);
  await assertPublicationOperationFormat({catalogue:fn=>fn({db})});await assert.rejects(assertPublicationOperationFormat({catalogue:fn=>fn({db:database(original)})}),{code:'CATALOGUE_DAMAGED'});
 }
 assert.equal(configurationCatalogueGeneration(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)),CATALOGUE_MAX_GENERATION);
 await assert.rejects(catalogueFormat(database(CATALOGUE_MAX_GENERATION+1)),{code:'CATALOGUE_DAMAGED'});
 for(const publicationOperations of [null,1,'true',{}])assert.throws(()=>configurationCatalogueGeneration({...base,publicationOperations}),{code:'INVALID'});
});
test('durable requests and named-site receipts carry admission without changing prior job formats',()=>{
 const path='.observanda/jobs/id.json';assert.equal(publicationOperationMetadata(path,{type:'publication.prepare',input:{request:{}}}),true);assert.equal(publicationOperationMetadata(path,{type:'publication.analysis-review'}),true);assert.equal(publicationOperationMetadata(path,{type:'publication.prepare',input:{revision:'old'}}),false);
 assert.equal(publicationOperationMetadata('.observanda/publication-analysis-operations/hash.json',{}),true);assert.equal(publicationOperationMetadata('.observanda/websites/12345678-1234-1234-1234-123456789012/publication-analysis-operations/hash.json',{}),true);assert.equal(publicationOperationMetadata('.observanda/other/id.json',{}),false);
});
