// uploads.ts — Résolution sûre des fichiers d'images de la galerie. Module pur
// (pas d'I/O) → testable. Le serveur enrobe ça d'un fs.unlink.

import path from 'node:path';

// Mappe un `src` de galerie ("/uploads/<nom>") vers un chemin absolu sous `uploadsDir`.
// Refuse tout ce qui n'est pas un simple nom de fichier (anti-traversal : pas de "/",
// "\", "..", ni chemin absolu). Renvoie null si le src n'est pas un upload local valide.
export function uploadFilePath(uploadsDir: string, src: string): string | null {
  const m = /^\/uploads\/([^/\\]+)$/.exec(src || '');
  if (!m) return null;
  const name = path.basename(m[1]);
  if (!name || name === '.' || name === '..') return null;
  return path.join(uploadsDir, name);
}
