import {presentationDefaults} from './web/media-presentation.js';
import {upgradeNotebook,currentWorkspaceMetadata} from './model.js';
import {emptyHomepage,websiteDefaults,siteLayoutDefaults} from './web/website-model.js';

// The record renderer lays a record out inside a small rendering book with its
// own page settings. These settings belong to the renderer, not to the
// workspace: websites are made in the website editor and keep their own files.
export function websiteRenderingDefaults(){
 return {...websiteDefaults(),home:emptyHomepage(),design:siteLayoutDefaults(),assets:[],layouts:[],templates:[],typography:{},presentation:presentationDefaults(),palette:{},logoId:null,logoAlt:'',footer:'',navigation:[]};
}
// A book given to the renderer without page settings renders with the defaults.
export function withRenderingWebsite(book){return {...book,website:book.website??websiteRenderingDefaults(),pages:book.pages??[],branding:book.branding??[]};}
// The renderer reads a workspace's records through the current model and keeps
// its page settings beside them: the given ones, or the defaults.
export function renderingNotebook(source){
 const {website,pages,branding}=withRenderingWebsite(source);
 const upgraded=upgradeNotebook(source.formatVersion>=21?currentWorkspaceMetadata(structuredClone({...source,formatVersion:21})):structuredClone(source));
 delete upgraded.website;delete upgraded.pages;delete upgraded.branding;delete upgraded.websites;
 return {...upgraded,website,pages,branding};
}
