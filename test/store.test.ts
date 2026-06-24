// Tests des fonctions pures du store (création d'aventure, résumé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, summary, DEFAULT_STATS } from '../src/store.js';

test('createAdventure crée un personnage par joueur, en phase lobby', () => {
  const adv = createAdventure({ title: 'Camp', players: ['Bob', 'Alice', 'Cyril'] });
  assert.equal(adv.characters.length, 3);
  assert.equal(adv.phase, 'lobby');
  assert.deepEqual(adv.characters.map((c) => c.playerName), ['Bob', 'Alice', 'Cyril']);
});

test('createAdventure applique le statTemplate fourni (init à 10)', () => {
  const adv = createAdventure({ title: 'X', players: ['Bob'], statTemplate: ['Mana', 'Vigueur'] });
  assert.deepEqual(adv.statTemplate, ['Mana', 'Vigueur']);
  assert.deepEqual(adv.characters[0].stats, { Mana: 10, Vigueur: 10 });
});

test('createAdventure retombe sur les stats par défaut si template vide', () => {
  const adv = createAdventure({ title: 'X', players: ['Bob'], statTemplate: [] });
  assert.deepEqual(adv.statTemplate, DEFAULT_STATS);
});

test('createAdventure initialise un champ ai avec modèle par défaut', () => {
  const adv = createAdventure({ title: 'X', players: ['Bob'] });
  assert.ok(adv.ai);
  assert.equal(typeof adv.ai.model, 'string');
});

test('summary expose playerCount et masque les données lourdes', () => {
  const adv = createAdventure({ title: 'X', players: ['Bob', 'Alice'] });
  const s = summary(adv);
  assert.equal(s.playerCount, 2);
  assert.equal(s.title, 'X');
  assert.equal((s as Record<string, unknown>).characters, undefined);
  assert.equal((s as Record<string, unknown>).story, undefined);
});
