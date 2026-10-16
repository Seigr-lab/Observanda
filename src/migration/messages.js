import messages from '../web/locales/en/migration.json' with {type:'json'};
import {translator} from '../web/i18n/runtime.js';
export const migrationMessage=translator('en',messages);
