export const websiteContext=state=>JSON.stringify([state.storage?.contextId,state.projectOwner?.projectId??null,state.projectOwner?.labBookId??null,state.websiteId??null]);
export const websiteRequest=route=>/^\/api\/(?:website\/|publishing(?:\/|$)|publication-|deployment-jobs\/|repository-setup\/|local-export\/|preview$|design-preview$|export(?:\/|$))/.test(route);
export const websiteRouteId=hash=>/^#\/websites\/([a-f0-9-]{36})\//.exec(hash)?.[1]??null;
export const websitePages=new Set(['website','publishing','integrations','review','branding']);

export const publicationPreviewUrl=(state,id,file='')=>(state.projectOwner?'/api/projects/'+state.projectOwner.projectId+(state.projectOwner.labBookId?'/lab-books/'+state.projectOwner.labBookId:'')+'/publication-preview/':'/preview/')+id+'/'+file;
