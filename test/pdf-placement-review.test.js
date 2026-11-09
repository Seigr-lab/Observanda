import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reconcilePdfPlacements} from '../src/web/pdf-placement-review.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfSetPaginationRule} from '../src/web/pdf-pagination-model.js';
import {pdfCompositionDefaults} from '../src/web/pdf-composition-model.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';

const doc = (...texts) => ({type:'doc',content:texts.map(text=>({type:'paragraph',content:[{type:'text',text}]}))});
const base = () => ({id:randomUUID(),title:'Methods',content:doc('Alpha','Bravo','Charlie'),start:null,layout:null});
const edited = (section,...texts) => reconcilePdfPlacements(section,{...section,content:doc(...texts)});

test('review targets composing boxes, keep-with-next boundaries and both sides of note and image placements', async () => {
  const section=base(), layout=pdfLayoutPreset(), header={id:randomUUID(),version:1,name:'Report',language:'en',direction:'ltr',layout};
  const composed={...section,composition:pdfCompositionDefaults(section,layout)};
  const swapped=edited(composed,'Bravo','Alpha','Charlie');
  assert.equal(swapped.placementReview,true);
  await assert.rejects(compilePdfDocument(header,[swapped]),{code:'PDF_PLACEMENT_REVIEW'});
  const rule={...section,pagination:pdfSetPaginationRule(section,0,{keepWithNext:true})};
  assert.equal(edited(rule,'Alpha','Different','Charlie').placementReview,true);
  assert.equal(edited(rule,'Alpha','Bravo','Independent edit').placementReview,undefined);
  const note={...section,notes:[{id:randomUUID(),kind:'footnote',block:1,content:'Reference to Alpha'}]};
  const image={...section,images:[{id:randomUUID(),position:{block:1}}]};
  for(const original of [note,image]){
    for(const changed of [['First','Alpha','Bravo','Charlie'],['Bravo','Charlie'],['Al','pha','Bravo','Charlie'],['AlphaBravo','Charlie'],['Alpha','Replacement','Charlie']]) {
      assert.equal(edited(original,...changed).placementReview,true);
    }
    const unresolved=edited(original,'Bravo','Alpha','Charlie');
    const {placementReview,...stripped}=unresolved;
    assert.equal(reconcilePdfPlacements(unresolved,stripped).placementReview,true);
    assert.equal(edited(original,'Alpha','Bravo','Updated elsewhere').placementReview,undefined);
    assert.equal(reconcilePdfPlacements(unresolved,{...section,content:unresolved.content}).placementReview,undefined);
  }
  assert.equal(edited(section,'Bravo','Alpha','Charlie').placementReview,undefined);
  const repeated={...note,content:doc('Caption','Caption','Final')};
  assert.equal(edited(repeated,'Caption','Caption','Caption','Final').placementReview,true);
  assert.equal((await compilePdfDocument(header,[composed])).sections,1);
});
