import {test} from 'node:test';
import assert from 'node:assert/strict';
import {insertWebsiteSource} from '../src/website-file-html.js';

test('newly placed entries appear inside the editable page and ahead of its footer',()=>{
 const input='<html><body><main><h1>Results</h1></main><footer>Copyright</footer></body></html>';
 const output=insertWebsiteSource(input,{id:'a'.repeat(64),revision:'b'.repeat(64),html:'<p>Observation</p>'});
 assert.match(output,/<h1>Results<\/h1><section[^>]+><p>Observation<\/p><\/section><\/main><footer>/);
});
