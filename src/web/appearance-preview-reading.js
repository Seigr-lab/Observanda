import {enhancePublicBook} from './public-book.js';
import {matchesPublicRecord} from './public-browse-query.js';
import {enhancePublicFeeds} from './public-feeds.js';
import {enhancePublicPopups} from './public-popups.js';
import {enhancePublicGalleries} from './public-gallery.js';

// The host wires the trusted reading controls. Preview frames keep scripts
// disabled, including authored or imported content. Never remove the sandbox.
export function enhanceAppearanceReading(frame){
 const view=frame.contentWindow;if(!view||view.location.origin!==location.origin)return;
 enhancePublicBook(view.document,view.location,view.history,view.sessionStorage,view,matchesPublicRecord);
 enhancePublicFeeds(view.document,view,(url,options)=>fetch(url,options),{history:false});
 enhancePublicPopups(view.document);enhancePublicGalleries(view.document);
 for(const controls of view.document.querySelectorAll('fieldset[data-preview-controls]'))controls.replaceWith(...controls.childNodes);
 view.document.documentElement.dataset.appearanceReadingReady='';
 view.document.body.inert=false;
}
