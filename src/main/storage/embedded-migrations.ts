import init001 from './migrations/001_initial.sql?raw';

export const EMBEDDED_MIGRATIONS: Record<string, string> = {
  '001_initial': init001
};
