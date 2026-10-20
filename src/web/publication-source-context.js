// Native websites expose only a count and immutable choice identity. Source
// content windows resolve their choices from the retained server document.
export const publicationSourceCount=state=>state.websiteEditor?.sources?.count??state.book?.website.researchSources?.length??0;
export const publicationSourceRevision=state=>state.websiteEditor?.sources?.revision??JSON.stringify(state.book?.website.researchSources??[]);
export function publicationSourceTarget(state){const editor=state.websiteEditor;return editor?{websitePin:editor.websitePin,...(editor.draft?{websiteDraft:{id:editor.draft.id,revision:editor.draft.revision}}:{})}:null;}
export async function publicationSourceWindow(state,api,query={},options={}){const editor=state.websiteEditor;if(!editor)throw Error('PUBLICATION_SOURCE_RESPONSE');return api('/api/websites/editor/sources',{workspaceId:state.book.id,websiteId:editor.websitePin.websiteId,websitePin:editor.websitePin,...(editor.draft?{draftId:editor.draft.id,draftRevision:editor.draft.revision}:{}),...query},{adopt:false,websitePin:editor.websitePin,...options});}
