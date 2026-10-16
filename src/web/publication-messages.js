import messages from './locales/en/publication.json' with {type:'json'};
import {translator} from './i18n/runtime.js';
// Generated sites use the edition's English interface, independently of the
// private application's selected language. Authored content is never translated.
export const publicationText=translator('en',messages);
