// Tests du parseur MJ (gmsync). Couvre le format @récit/@titre/@lieu/@classes/@maj
// et garantit les "échecs silencieux" (ligne mal formée ignorée sans casser le reste).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGmUpdates } from '../src/gmsync.js';
import { createAdventure } from '../src/store.js';
import type { Adventure } from '../src/types.js';

function makeAdv(): Adventure {
  return createAdventure({
    title: 'Test',
    theme: 'fantasy',
    players: ['Bob', 'Alice'],
    statTemplate: ['Force', 'Dextérité'],
  });
}

test('@maj : dégâts PV (pv -5)', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv, '@récit\nBoom.\n@maj\nBob: pv -5\n@fin');
  const bob = adv.characters.find((c) => c.playerName === 'Bob')!;
  assert.equal(bob.hp.current, 5);
  assert.equal(r.clean, 'Boom.');
  assert.deepEqual(r.changedIds, [bob.id]);
});

test('@maj : pv courant/max (18/20)', () => {
  const adv = makeAdv();
  applyGmUpdates(adv, '@maj\nAlice: pv 18/20\n@fin');
  const alice = adv.characters.find((c) => c.playerName === 'Alice')!;
  assert.deepEqual(alice.hp, { current: 18, max: 20 });
});

test('@maj : ajout/retrait inventaire avec quantité', () => {
  const adv = makeAdv();
  applyGmUpdates(adv, '@maj\nBob: +potion de soin x2, +torche\n@fin');
  const bob = adv.characters.find((c) => c.playerName === 'Bob')!;
  assert.equal(bob.inventory.find((i) => i.name === 'potion de soin')?.qty, 2);
  assert.ok(bob.inventory.find((i) => i.name === 'torche'));

  applyGmUpdates(adv, '@maj\nBob: -torche\n@fin');
  assert.equal(bob.inventory.find((i) => i.name === 'torche'), undefined);
});

test('@maj : modification de caractéristique (Force 16, Dextérité +1)', () => {
  const adv = makeAdv();
  applyGmUpdates(adv, '@maj\nBob: Force 16, Dextérité +1\n@fin');
  const bob = adv.characters.find((c) => c.playerName === 'Bob')!;
  assert.equal(bob.stats['Force'], 16);
  assert.equal(bob.stats['Dextérité'], 11); // 10 + 1
});

test('@titre et @lieu sont extraits', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv, '@titre Les Cendres de Valdoren\n@lieu Aux portes de Cendrebourg\n@récit\nIl fait nuit.');
  assert.equal(r.title, 'Les Cendres de Valdoren');
  assert.equal(r.startLocation, 'Aux portes de Cendrebourg');
  assert.equal(r.clean, 'Il fait nuit.');
});

test('@classes : pool parsé', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv, '@classes\nPaladin | Force 16, pv 18 | Un serment brisé\nMage | Force 8, pv 12 | Arcaniste\n@fin');
  assert.equal(r.classes?.length, 2);
  assert.equal(r.classes?.[0].name, 'Paladin');
  assert.equal(r.classes?.[0].hp, 18);
  assert.equal(r.classes?.[0].stats['Force'], 16);
});

test('échec silencieux : ligne @maj mal formée ignorée, aucun changement', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv, '@récit\nRien.\n@maj\nceci nest pas une directive valide\n@fin');
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.changedIds, []);
  assert.equal(r.clean, 'Rien.'); // la narration reste intacte
});

test('échec silencieux : personnage inconnu ignoré', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv, '@maj\nGandalf: pv -5\n@fin');
  assert.deepEqual(r.changedIds, []);
});

test('sans @récit : tout le texte (nettoyé des blocs) devient la narration', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv, 'Une simple narration sans marqueur.');
  assert.equal(r.clean, 'Une simple narration sans marqueur.');
});

test('message de setup seul (titre/lieu/classes) → narration vide (pas de récit fantôme)', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv, '@titre Les Boyaux du Roi-Charogne\n@lieu Au pied des remparts\n@classes\nÉcorcheur | Force 16, pv 18 | Pille les tombes\n@fin');
  assert.equal(r.title, 'Les Boyaux du Roi-Charogne');
  assert.equal(r.classes?.length, 1);
  assert.equal(r.clean, '');  // surtout PAS le bloc brut → sinon il devient un tour de récit
});

test('bloc @maj seul (pas de narration) → narration vide', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv, '@maj\nBob: pv -5\n@fin');
  assert.equal(r.clean, '');
});

test('le chrome avant @récit est ignoré', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv, 'Claude\n12:34\nVoici ma réponse\n@récit\nLa vraie narration.');
  assert.equal(r.clean, 'La vraie narration.');
});

test('ne mute pas un personnage non concerné', () => {
  const adv = makeAdv();
  applyGmUpdates(adv, '@maj\nBob: pv -5\n@fin');
  const alice = adv.characters.find((c) => c.playerName === 'Alice')!;
  assert.deepEqual(alice.hp, { current: 10, max: 10 });
});

// --- Nouveaux tests : format @classes enrichi ---

test('@classes : segments équip/atout/lien parsés', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv,
    '@classes\n' +
    'Rôdeur | Dextérité 16, pv 14 | Traque dans l\'ombre | équip: arc long, 12 flèches, cape | atout: Œil de braise — voit dans le noir | lien: cherche le Cendrier\n' +
    '@fin'
  );
  const cls = r.classes?.[0]!;
  assert.equal(cls.name, 'Rôdeur');
  assert.equal(cls.description, 'Traque dans l\'ombre');
  assert.deepEqual(cls.equipment, ['arc long', '12 flèches', 'cape']);
  assert.equal(cls.ability, 'Œil de braise — voit dans le noir');
  assert.equal(cls.hook, 'cherche le Cendrier');
  assert.equal(cls.stats['Dextérité'], 16);
  assert.equal(cls.hp, 14);
});

test('@classes : segments dans un ordre différent', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv,
    '@classes\n' +
    'Mage | Force 8, pv 10 | Arcaniste | lien: gardien du secret | atout: Mémoire vive — retient tout | équip: grimoire, encre\n' +
    '@fin'
  );
  const cls = r.classes?.[0]!;
  assert.equal(cls.hook, 'gardien du secret');
  assert.equal(cls.ability, 'Mémoire vive — retient tout');
  assert.deepEqual(cls.equipment, ['grimoire', 'encre']);
});

test('@classes : sans segments enrichis (ancien format, rétrocompatible)', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv,
    '@classes\nPaladin | Force 16, pv 18 | Un serment brisé\n@fin'
  );
  const cls = r.classes?.[0]!;
  assert.equal(cls.name, 'Paladin');
  assert.equal(cls.description, 'Un serment brisé');
  assert.deepEqual(cls.equipment, []);
  assert.equal(cls.ability, '');
  assert.equal(cls.hook, '');
});

test('@classes : segment équip sans atout ni lien', () => {
  const adv = makeAdv();
  const r = applyGmUpdates(adv,
    '@classes\nGuerrier | Force 18, pv 16 | Colosse | équip: hache, bouclier\n@fin'
  );
  const cls = r.classes?.[0]!;
  assert.deepEqual(cls.equipment, ['hache', 'bouclier']);
  assert.equal(cls.ability, '');
  assert.equal(cls.hook, '');
});
