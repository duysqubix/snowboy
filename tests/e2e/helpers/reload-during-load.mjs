// Loaded into the app's main process with `electron -r` by startup.spec.ts.
// Reloads the window at dom-ready, before its first load has finished, as
// Vite's dependency reload does in dev. Then quits once the reload has loaded.
import { app } from 'electron';

app.on('web-contents-created', (_event, contents) => {
  let loaded = false;
  contents.on('did-finish-load', () => {
    loaded = true;
  });
  contents.once('dom-ready', () => {
    console.log(`[e2e] reloading; first load finished: ${loaded}`);
    contents.once('did-finish-load', () => app.quit());
    contents.reload();
  });
});
