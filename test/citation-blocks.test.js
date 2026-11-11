import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validBookBlock,renderBookBlock,citationDefaults} from '../src/web/book-blocks.js';
import {normalizeCitationIdentifier,validISBN,validISSN,parseCitationIdentifiers,citationIdentifierURL,citationIdentifierText} from '../src/web/citation-identifiers.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const v1=()=>({type:'book_citation',attrs:{version:1,id:randomUUID(),title:'On electrical measurement',authors:'Doe, J.',issued:'2nd edition, 1911',locator:'p. 12',url:''}});
const v2=extra=>({type:'book_citation',attrs:{...v1().attrs,version:2,...citationDefaults(),date:{kind:'year',value:'1911',estimated:true},publisher:'Example Press',archive:'County archive, box 4',identifiers:[{kind:'doi',value:'10.1000/182'},{kind:'isbn',value:'9780306406157'}],...extra}});

test('identifiers are checked by their own rules and stored in one spelling',()=>{
 assert.ok(validISBN('978-0-306-40615-7'));assert.ok(validISBN('0-306-40615-2'));assert.ok(validISBN('080442957X'));
 for(const bad of ['978-0-306-40615-8','0-306-40615-3','12345'])assert.equal(validISBN(bad),false,bad);
 assert.ok(validISSN('0317-8471'));assert.ok(validISSN('2049-3630'));assert.equal(validISSN('0317-8472'),false);
 assert.equal(normalizeCitationIdentifier('doi','https://doi.org/10.1000/182'),'10.1000/182');assert.equal(normalizeCitationIdentifier('doi','doi: 10.1000/182'),'10.1000/182');
 assert.equal(normalizeCitationIdentifier('doi','11.1000/182'),null);assert.equal(normalizeCitationIdentifier('isbn','978 0 306 40615 7'),'9780306406157');
 assert.equal(normalizeCitationIdentifier('issn','03178471'),'0317-8471');assert.equal(normalizeCitationIdentifier('arxiv','arXiv:2101.00001v2'),'2101.00001v2');
 const parsed=parseCitationIdentifiers('doi: 10.1000/182\nisbn: 978-0-306-40615-8\n\nother: Parish register 1850-1870');
 assert.deepEqual(parsed,{identifiers:[{kind:'doi',value:'10.1000/182'},{kind:'other',value:'Parish register 1850-1870'}],invalid:['isbn: 978-0-306-40615-8']});
 assert.equal(citationIdentifierText(parsed.identifiers),'doi: 10.1000/182\nother: Parish register 1850-1870');
 assert.equal(citationIdentifierURL({kind:'doi',value:'10.1000/a b'}),'https://doi.org/10.1000/a%20b');assert.equal(citationIdentifierURL({kind:'isbn',value:'9780306406157'}),'');
});

test('free-text citations stay valid; structured citations validate dates and identifiers',()=>{
 const old=v1();assert.ok(validBookBlock(old));
 assert.ok(validBookBlock({...old,attrs:{...old.attrs,...citationDefaults()}}),'An editor may add the defaults to a version-1 citation');
 assert.equal(validBookBlock({...old,attrs:{...old.attrs,...citationDefaults(),publisher:'X'}}),false,'Version-1 citations carry no structured details');
 assert.ok(validBookBlock(v2()));
 for(const bad of [{date:{kind:'year',value:'19x1',estimated:false}},{identifiers:[{kind:'isbn',value:'9780306406158'}]},{identifiers:[{kind:'doi',value:'10.1000/182'},{kind:'doi',value:'10.1000/182'}]},{publisher:'x'.repeat(501)},{version:3}])
  assert.equal(validBookBlock(v2(bad)),false,JSON.stringify(bad));
 assert.ok(validBookBlock(v2({date:null,identifiers:[]})));
 assert.equal(validBookBlock({type:'book_table',attrs:{version:2,id:randomUUID(),title:'T',headers:['a'],rows:[['1']]}}),false,'Only citations have a version 2');
});

test('both citation versions render readably with identifiers that can be followed',()=>{
 const old=renderBookBlock(v1(),{esc});assert.match(old,/Doe, J\.\. <cite>On electrical measurement<\/cite> · 2nd edition, 1911 · p\. 12/);
 const html=renderBookBlock(v2({authors:'Doe, J.\nRoe, R.'}),{esc});
 for(const part of ['Doe, J.; Roe, R.','Example Press','County archive, box 4','<a href="https://doi.org/10.1000/182" rel="noopener noreferrer">DOI 10.1000/182</a>','ISBN 9780306406157','1911'])assert.ok(html.includes(part),part);
});
