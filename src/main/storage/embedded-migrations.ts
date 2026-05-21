import init001 from './migrations/001_initial.sql?raw';
import wave4_002 from './migrations/002_wave4.sql?raw';

export const EMBEDDED_MIGRATIONS: Record<string, string> = {
  '001_initial': init001,
  '002_wave4': wave4_002
};
