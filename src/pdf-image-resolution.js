import {planPdfImageResolution} from './web/pdf-image-resolution-model.js';
import {applyPdfImageResolution} from './web/pdf-image-resolution.js';
export {planPdfImageResolution,applyPdfImageResolution};
// Evaluate before preflight in the existing isolated rendering window. Its
// lifetime/cancellation owner closes that window when the operation is aborted.
export const pdfImageResolutionScript='('+applyPdfImageResolution.toString()+')('+planPdfImageResolution.toString()+')';
