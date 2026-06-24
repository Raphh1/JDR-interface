// Tests des fonctions pures du store (création d'aventure, résumé, normalize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, summary, normalize, DEFAULT_STATS } from '../src/store.js';
import type { Adventure } from '../src/types.js';

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

test('createAdventure initialise les critères de conception avec les valeurs fournies', () => {
  const adv = createAdventure({ title: 'X', players: ['Bob'], tone: 'Sombre', dangerLevel: 'Mortel', inspiration: 'Bloodborne', conceptionDepth: 7, classCount: 6 });
  assert.equal(adv.tone, 'Sombre');
  assert.equal(adv.dangerLevel, 'Mortel');
  assert.equal(adv.inspiration, 'Bloodborne');
  assert.equal(adv.conceptionDepth, 7);
  assert.equal(adv.classCount, 6);
});

test('createAdventure applique les valeurs par défaut aux critères manquants', () => {
  const adv = createAdventure({ title: 'X', players: ['Bob'] });
  assert.equal(adv.tone, '');
  assert.equal(adv.dangerLevel, '');
  assert.equal(adv.inspiration, '');
  assert.equal(adv.conceptionDepth, 3);
  assert.equal(adv.classCount, 5);
});

test('createAdventure borne conceptionDepth et classCount', () => {
  const adv = createAdventure({ title: 'X', players: ['Bob'], conceptionDepth: 99, classCount: 0 });
  assert.equal(adv.conceptionDepth, 10);
  assert.equal(adv.classCount, 3);
});

test('normalize : remplit les champs manquants d\'une ancienne aventure', () => {
  const old = createAdventure({ title: 'X', players: ['Bob'] }) as Partial<Adventure> & Adventure;
  delete (old as Partial<Adventure>).tone;
  delete (old as Partial<Adventure>).dangerLevel;
  delete (old as Partial<Adventure>).inspiration;
  delete (old as Partial<Adventure>).conceptionDepth;
  delete (old as Partial<Adventure>).classCount;
  const fixed = normalize(old);
  assert.equal(fixed.tone, '');
  assert.equal(fixed.dangerLevel, '');
  assert.equal(fixed.inspiration, '');
  assert.equal(fixed.conceptionDepth, 3);
  assert.equal(fixed.classCount, 5);
});

test('normalize : remplit les champs manquants des ClassDef sans segments', () => {
  const adv = createAdventure({ title: 'X', players: ['Bob'] });
  adv.classPool = [{ id: '1', name: 'Guerrier', description: 'Fort', stats: {}, hp: 18 } as any];
  normalize(adv);
  assert.deepEqual(adv.classPool[0].equipment, []);
  assert.equal(adv.classPool[0].ability, '');
  assert.equal(adv.classPool[0].hook, '');
});
