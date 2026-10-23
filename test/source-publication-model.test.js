import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validDraftRecord} from '../src/record-draft-validation.js';
import {sampleNotebook} from '../src/sample.js';
import {validateNotebook} from '../src/model.js';
import {validWritingValue,writingSectionValue} from '../src/web/record-writing-model.js';
import {digest,serialize} from '../src/storage-format.js';

test('source publication permissions accept booleans without changing older writing identities',()=>{
 const book=sampleNotebook(),section={id:randomUUID(),title:'Observation',body:'Retained writing'};book.entries[0].sections=[section];
 assert.ok(section);assert.equal(digest(serialize(writingSectionValue(section))),digest(serialize({title:section.title,body:section.body})));
 for(const share of [false,true]){
  book.notebooks[0].share=share;section.share=share;validateNotebook(book);assert.equal(validDraftRecord(book.entries[0]),true);
  assert.equal(writingSectionValue(section).share,share);assert.equal(validWritingValue(writingSectionValue(section),section.id),true);
 }
 for(const share of [null,'false',0,{},[]]){
  section.share=share;assert.equal(validDraftRecord(book.entries[0]),false);assert.equal(validWritingValue(writingSectionValue(section),section.id),false);assert.throws(()=>validateNotebook(book),{code:'INVALID'});
  section.share=false;book.notebooks[0].share=share;assert.throws(()=>validateNotebook(book),{code:'INVALID'});
 }
 assert.equal(validWritingValue({body:'Private summary',share:false},null),false);
});

test('publication-permission generations preserve every older independent storage requirement',async()=>{
 const {configurationCatalogueFeatures,configurationCatalogueGeneration,catalogueRequiresSourcePublicationControls,catalogueFormat}=await import('../src/catalogue-format.js');
 for(let old=122;old<=217;old++){
  const features=configurationCatalogueFeatures(old),next=configurationCatalogueGeneration({...features,permissions:true});
  assert.equal(next,old+96);assert.deepEqual(configurationCatalogueFeatures(next),{...features,permissions:true});
  assert.equal(configurationCatalogueGeneration(features),old);assert.equal(catalogueRequiresSourcePublicationControls(old),false);assert.equal(catalogueRequiresSourcePublicationControls(next),true);
 }
 for(const value of [121,25165946,218.5,NaN])assert.equal(configurationCatalogueFeatures(value),null);
 await assert.rejects(catalogueFormat({all:async()=>[{version:25165946}]}),{code:'CATALOGUE_DAMAGED'});
});
