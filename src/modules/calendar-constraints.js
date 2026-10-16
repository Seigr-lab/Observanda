import {requireValue} from './validation.js';
export const calendarConstraintTypes=['calendar','event','subscription','calendar-connection'];
export async function validateCalendarSource(source){
 let enabled=0;
 for await(const item of source.all(['subscription','calendar-connection']))if(item.data.enabled)requireValue(++enabled<=30,'Up to 30 connected calendar sources can be enabled at once');
 for await(const {data:d} of source.all('event'))requireValue(await source.has('calendar',d.calendarId),'Event calendar','MODULE_REFERENCE');
}
