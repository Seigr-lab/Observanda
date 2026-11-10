import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationErrorView} from '../src/web/publication-error-view.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const error={code:'PUBLICATION_LINKS',message:'Two links need review.',details:[{path:'old/index.html',reason:'generatedPath'}]};

test('a publication issue names its dialog only when the dialog asks for it',()=>{
 const dialog=publicationErrorView(error,esc,{titleId:'dialog-title'}),inline=publicationErrorView(error,esc);
 assert.match(dialog,/^<section role="alert"><h2 id="dialog-title">[^<]+<\/h2>/);
 assert.match(inline,/^<section role="alert"><h2>[^<]+<\/h2>/);
 assert.equal(publicationErrorView({code:'OTHER'},esc,{titleId:'dialog-title'}),null);
});
