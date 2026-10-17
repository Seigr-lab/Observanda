import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {publicProjection} from '../src/publication-projection.js';
import {buildPublication,renderPublication} from '../src/publication.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {newElement} from '../src/web/composition-tree.js';

test('selected browse rendering retains the same footer and excludes authored-page sidebars',()=>{
 const book=upgradeNotebook(sampleNotebook());
 for(const kind of ['footer','header','sidebar']){
  const region=createRegion(book.website,kind,'Shared '+kind,{makeId:randomUUID});
  region.sections=[{...newElement('text',randomUUID),body:'Authored '+kind+' content'}];
  assignRegion(book.website,'*',kind,region.id);
 }
 const expected=buildPublication(book),context=publicProjection(book,{publicationTarget:'browse',entryDestinations:book.entries.filter(record=>record.share),publicationCounts:{total:book.entries.filter(record=>record.share).length,notebooks:{}}}),actual=renderPublication(context);
 assert.deepEqual(context.website.regions.map(region=>region.kind),['footer']);
 assert.equal(actual.files.get('browse.html'),expected.files.get('browse.html'));
 assert.ok(actual.files.get('browse.html').includes('Authored footer content'));
 assert.ok(!actual.files.get('browse.html').includes('Authored sidebar content'));
});
