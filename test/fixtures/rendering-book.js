import {sampleNotebook} from '../../src/sample.js';
import {websiteDefaults} from '../../src/web/website-model.js';
import {withRenderingWebsite} from '../../src/publication-rendering-book.js';

// A book handed straight to the record renderer, with the renderer's own page
// settings and its homepage turned on. Workspaces never store these settings,
// so a test that also stores the book stores it without them.
export function renderingBook(book=sampleNotebook()){
 const rendering=withRenderingWebsite(book);
 if(!book.website)rendering.website={...rendering.website,home:websiteDefaults().home};
 return rendering;
}
export const renderingSample=()=>renderingBook(sampleNotebook());
