import './i18n/catalogues/recordEditors.js';
import {t} from './i18n/index.js';
import {RECORD_TYPES} from './record-types.js';

// Shared record definitions remain English: they seed authored content and
// participate in server-side revision identities. Translate only presentation.
const known=new Set(RECORD_TYPES.map(type=>type.id));
export const recordTypeLabel=(id,fallback=id)=>known.has(id)?t('recordEditors','type_'+id+'_label'):fallback;
export const recordTypeDescription=(id,fallback='')=>known.has(id)?t('recordEditors','type_'+id+'_description'):fallback;
export const recordTypePresentation=type=>({...type,label:recordTypeLabel(type.id,type.label),description:recordTypeDescription(type.id,type.description)});
