import {presentationDefaults} from './web/media-presentation.js';
import {emptyHomepage,websiteDefaults,siteLayoutDefaults} from './web/website-model.js';

// The record renderer lays a record out inside a small rendering book with its
// own page settings. These settings belong to the renderer, not to the
// workspace: websites are made in the website editor and keep their own files.
export function websiteRenderingDefaults(){
 return {...websiteDefaults(),home:emptyHomepage(),design:siteLayoutDefaults(),assets:[],layouts:[],templates:[],typography:{},presentation:presentationDefaults(),palette:{},logoId:null,logoAlt:'',footer:'',navigation:[]};
}
// A book given to the renderer without page settings renders with the defaults.
export function withRenderingWebsite(book){return book.website?book:{...book,website:websiteRenderingDefaults()};}
