export const activeWebsite=state=>state.websitePin!=null;
export const websiteContext=state=>JSON.stringify([state.storage?.contextId,state.projectOwner?.projectId??null,state.projectOwner?.labBookId??null,activeWebsite(state),state.websiteId??null]);
export const websiteRequest=route=>/^\/api\/(?:website\/|publishing(?:\/|$)|publication-|deployment-jobs\/|repository-setup\/|local-export\/|preview$|design-preview$|appearance-preview(?:\/|$)|export(?:\/|$))/.test(route);


