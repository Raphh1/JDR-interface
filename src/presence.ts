// presence.ts — Présence autoritative : qui est connecté, et à quelle aventure.
// Map advId -> (socketId -> membre). Une socket n'appartient qu'à UNE aventure à la fois
// (le re-join déplace la socket). Module pur, sans dépendance Socket.io → testable.

interface Member {
  name: string;
}

const rooms = new Map<string, Map<string, Member>>();

// Inscrit (ou met à jour) une socket dans une aventure. Si elle était dans une AUTRE
// aventure, elle en est retirée. Renvoie l'aventure précédente si elle a changé (pour
// que l'appelant puisse re-diffuser sa présence), sinon null.
export function join(advId: string, socketId: string, name: string): { previousAdvId: string | null } {
  const previousAdvId = leave(socketId);
  let members = rooms.get(advId);
  if (!members) { members = new Map(); rooms.set(advId, members); }
  members.set(socketId, { name });
  return { previousAdvId: previousAdvId && previousAdvId !== advId ? previousAdvId : null };
}

// Retire une socket de son aventure. Renvoie l'aventure quittée (pour re-diffusion), ou null.
export function leave(socketId: string): string | null {
  for (const [advId, members] of rooms) {
    if (members.delete(socketId)) {
      if (members.size === 0) rooms.delete(advId);
      return advId;
    }
  }
  return null;
}

// Liste des noms uniques présents dans une aventure (dédupliqués : plusieurs sockets/onglets
// d'un même nom ne comptent qu'une fois), triés.
export function list(advId: string): string[] {
  const members = rooms.get(advId);
  if (!members) return [];
  return [...new Set([...members.values()].map((m) => m.name))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

// Nombre de sockets (connexions) dans une aventure — utile pour distinguer multi-onglets.
export function socketCount(advId: string): number {
  return rooms.get(advId)?.size ?? 0;
}

// Réinitialise tout l'état (tests uniquement).
export function _reset(): void {
  rooms.clear();
}
