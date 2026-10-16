import messages from './locales/en/recordRecovery.json' with {type:'json'};
import {translator} from './i18n/runtime.js';

// Pure reconciliation has an English default; the UI supplies its active owner.
export const recordRecoveryMessage=translator('en',messages,messages);
export const recordConflictLabel=(key,message=recordRecoveryMessage)=>Object.hasOwn(messages,'field.'+key)?message('field.'+key):key;
