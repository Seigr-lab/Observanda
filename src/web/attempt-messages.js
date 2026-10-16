import messages from './locales/en/attempts.json' with {type:'json'};
import {translator} from './i18n/runtime.js';
export const attemptText=translator('en',messages,messages);
