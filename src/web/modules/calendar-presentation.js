import {t} from '../i18n/index.js';
import './editor-presentation.js';
import errors from '../locales/en/errors.json' with {type:'json'};

export function calendarOwnerLabel(descriptor,fallback=''){
 if(!descriptor||typeof descriptor.name!=='string')return fallback;
 if(descriptor.kind==='workspace')return t('moduleEditors','workspaceName',{name:descriptor.name});
 if(descriptor.kind==='removed')return t('moduleEditors','removedLocation');
 return descriptor.kind==='location'?descriptor.name:fallback;
}
export const calendarSourceOwner=source=>calendarOwnerLabel(source?.ownerDisplay,source?.owner??'');
export const calendarEventOrigin=event=>event.origin===undefined?calendarSourceOwner(event.source):calendarOwnerLabel(event.originDisplay,event.origin);
export const calendarSourceName=source=>source?.id?.startsWith('tasks:')?t('calendar','taskDeadlines'):source?.id?.startsWith('bookings:')?t('calendar','bookings'):source?.name??'';
export function calendarSourceError(source){
 if(['refreshFailed','sourceChanged'].includes(source?.errorKey))return t('calendar',source.errorKey);
 return Object.hasOwn(errors,source?.errorCode)?t('errors',source.errorCode):source?.error??'';
}
export const calendarErrorMessage=error=>Object.hasOwn(errors,error?.code)&&(!error.message||error.message===errors[error.code])?t('errors',error.code):error?.message;
