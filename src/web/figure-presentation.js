import './i18n/catalogues/figureDisplay.js';
import {t} from './i18n/index.js';
import {renderFigure as render,renderFigureView as view,figureTable as table,figureSummary as summary} from './figure-renderer.js';

// Browser display opts into the active language. Shared export callers keep
// the pure renderer's deterministic English defaults.
export const renderFigure=(figure,options={})=>render(figure,{translate:t,...options});
export const renderFigureView=(figure,options={})=>view(figure,{translate:t,...options});
export const figureTable=(figure,options={})=>table(figure,{translate:t,...options});
export const figureSummary=(figure,options={})=>summary(figure,{translate:t,...options});
