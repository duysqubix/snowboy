import type { SnowboyApi } from '../../../main/types';

export const snowboy: SnowboyApi = (window as unknown as { snowboy: SnowboyApi }).snowboy;

export type { SnowboyApi } from '../../../main/types';
