import {OwnedAccessSettings} from './owned-access-settings.js';
import {AppError} from './errors.js';
export class ProjectAccessSettings extends OwnedAccessSettings{constructor(storage){if(!storage.projectId||storage.labBookId!==undefined)throw new AppError('INVALID');super(storage);}}
