const {app}=require('electron');
const path=require('node:path');
app.setPath('userData',process.env.OBSERVANDA_PDF_TEST_PROFILE);
app.setPath('crashDumps',path.join(process.env.OBSERVANDA_PDF_TEST_PROFILE,'crashes'));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
globalThis.pdfService=import('../../desktop/pdf-renderer.js');
app.whenReady().then(()=>{globalThis.pdfReady=true;});
