import {grams,referenceTerm} from '../src/record-search-terms.js';
// An independent statement of a record's complete search vocabulary, built
// from the product's own gram and reference spellings.
const allGrams=text=>new Set([1,2,3].flatMap(width=>[...grams(text,width)]));
export const documentTerms=document=>new Set([...allGrams(document.searchText),...(document.referenceTargets??[]).map(referenceTerm)]);
