import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('snowboy', {});
