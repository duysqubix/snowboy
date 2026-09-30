// Loaded into the app's main process with `electron -r` by startup.spec.ts.
// dialog.showErrorBox is modal and would block the run until someone closed
// it, so print its title and text on stdout for the spec to check instead.
import { dialog } from 'electron';

dialog.showErrorBox = (title, content) => {
  console.log(`[e2e] error box: ${JSON.stringify({ title, content })}`);
};
