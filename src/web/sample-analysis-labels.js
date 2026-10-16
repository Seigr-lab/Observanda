import {t} from './i18n/index.js';
const keys={'create-sample':'eventCreateSample','create-analysis':'eventCreateAnalysis','save-result':'eventSaveResult','submit':'eventSubmit','save-and-submit':'eventSaveSubmit','review':'eventReview','amend':'eventAmend','archive':'eventArchive'};
export const sampleAnalysisAction=action=>keys[action]?t('sampleAnalysis',keys[action]):action;
