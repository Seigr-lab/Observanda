export const activeWebsite=state=>state.websitePin!=null;
export const websiteSnapshot=state=>JSON.stringify([websiteContext(state),state.etag,state.websitePin?[state.websitePin.researchSnapshotId,state.websitePin.websiteId,state.websitePin.websiteRevision]:null]);
export const websiteContext=state=>JSON.stringify([state.storage?.contextId,state.projectOwner?.projectId??null,state.projectOwner?.labBookId??null,activeWebsite(state),state.websiteId??null]);
export const websiteRequest=route=>/^\/api\/(?:website\/|publishing(?:\/|$)|publication-|deployment-jobs\/|repository-setup\/|local-export\/|preview$|design-preview$|appearance-preview(?:\/|$)|export(?:\/|$))/.test(route);
export const websiteRouteId=hash=>/^#\/websites\/([a-f0-9-]{36})\//.exec(hash)?.[1]??null;
export const websitePages=new Set(['website','publishing','integrations','review','branding','appearance']);

export const publicationPreviewUrl=(state,id,file='')=>(state.projectOwner?'/api/projects/'+state.projectOwner.projectId+(state.projectOwner.labBookId?'/lab-books/'+state.projectOwner.labBookId:'')+'/publication-preview/':'/preview/')+id+'/'+file;

export const websiteRoute=hash=>Boolean(websiteRouteId(hash))||/^#\/(?:website|publishing|appearance|review(?:\/.*)?|branding\/.*|preferences\/(?:appearance|integrations))$/.test(hash);
