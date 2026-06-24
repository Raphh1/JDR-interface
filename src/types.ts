// types.ts — Modèles de données partagés du serveur.

export interface InventoryItem {
  id: string;
  name: string;
  qty: number;
  notes: string;
}

export interface Character {
  id: string;
  playerName: string;
  name: string;
  charClass: string;        // classe choisie (depuis le pool généré par Claude)
  stats: Record<string, number>;
  hp: { current: number; max: number };
  inventory: InventoryItem[];
  notes: string;
}

// Une classe proposée par le MJ (Claude) pour cet univers.
export interface ClassDef {
  id: string;
  name: string;
  description: string;
  stats: Record<string, number>;  // valeurs de départ pour les caractéristiques
  hp: number;                     // PV de départ
  equipment: string[];            // objets de départ, matérialisés à la pioche
  ability: string;                // atout signature : "Nom — effet"
  hook: string;                   // accroche narrative reliant la classe au récit
}

export interface Roll {
  id: string;
  player: string;
  die: string;
  modifier: number;
  raw: number;
  total: number;
  crit: 'success' | 'fail' | null;
  timestamp: string;
}

export interface GalleryItem {
  id: string;
  src: string;
  caption: string;
  timestamp: string;
}

// Un bloc affiché dans le récit : narration du MJ, action d'un joueur, ou récap système.
export interface StoryTurn {
  id: string;
  role: 'player' | 'gm' | 'system';
  author: string;
  content: string;
  timestamp: string;
}

// Action soumise par un joueur pour le tour courant (verrouillée une fois validée).
export interface ActionSubmission {
  characterId: string;
  author: string;
  text: string;
}

export interface ActionRound {
  number: number;
  submissions: ActionSubmission[];
}

export interface AiSettings {
  model: string;
  summary: string;
}

export type Phase = 'lobby' | 'play';

export interface Adventure {
  id: string;
  title: string;
  theme: string;
  description: string;
  statTemplate: string[];
  startLocation: string;       // lieu de départ, affiché en fond du récit
  mjName: string;              // nom du MJ (l'hôte/créateur) ; '' tant qu'aucun MJ assigné
  phase: Phase;                // 'lobby' (pioche des classes) puis 'play'
  classPool: ClassDef[];       // classes générées par Claude, piochables
  createdAt: string;
  lastSessionAt: string;
  archived: boolean;
  characters: Character[];
  rolls: Roll[];
  gallery: GalleryItem[];
  story: StoryTurn[];
  actionRound: ActionRound;
  ai: AiSettings;
  // Critères de conception (optionnels pour compatibilité avec les anciennes aventures)
  tone?: string;               // Sombre | Héroïque | Comique | Horreur | Mystère | (libre)
  dangerLevel?: string;        // Bienveillant | Modéré | Mortel
  inspiration?: string;        // source d'inspiration (garde anti-copie dans le prompt)
  conceptionDepth?: number;    // 1–10 : nombre de questions d'affinage
  classCount?: number;         // 3–8 : taille du pool de classes à générer
  lore?: string;               // pitch/PNJ/intrigue collé par le MJ ; gardé côté MJ, non diffusé
}

export interface AdventureSummary {
  id: string;
  title: string;
  theme: string;
  description: string;
  playerCount: number;
  phase: Phase;
  createdAt: string;
  lastSessionAt: string;
  archived: boolean;
}
