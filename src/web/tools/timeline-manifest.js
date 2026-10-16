import {t} from '../i18n/index.js';
export const timelineModule={
 id:'timeline',metadataOnly:true,pages:[],entityTypes:['timeline-view'],
 get label(){return t('timeline','label');},get description(){return t('timeline','description');},
 navigation:[{action:'module-open',moduleId:'timeline',get label(){return t('timeline','label');},icon:'records'}],
 load:async()=>()=>{},createUI:services=>import('./timeline-ui.js').then(m=>m.createTimelineUI(services))
};
