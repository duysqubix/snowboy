// Loaded into the app's main process with `electron -r` by startup.spec.ts.
// Closes the window at dom-ready, before its first load has finished, as a
// user closing the window straight away would.
import { app, BrowserWindow } from 'electron';

app.on('web-contents-created', (_event, contents) => {
  let loaded = false;
  contents.on('did-finish-load', () => {
    loaded = true;
  });
  contents.once('dom-ready', () => {
    console.log(`[e2e] closing; first load finished: ${loaded}`);
    BrowserWindow.fromWebContents(contents)?.close();
  });
});
