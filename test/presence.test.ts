// Tests du module de présence autoritative.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as presence from '../src/presence.js';

beforeEach(() => presence._reset());

test('liste les noms uniques présents, triés', () => {
  presence.join('adv1', 's1', 'Bob');
  presence.join('adv1', 's2', 'Alice');
  assert.deepEqual(presence.list('adv1'), ['Alice', 'Bob']);
});

test('déduplique plusieurs sockets/onglets du même nom', () => {
  presence.join('adv1', 's1', 'Bob');
  presence.join('adv1', 's2', 'Bob');
  assert.deepEqual(presence.list('adv1'), ['Bob']);
  assert.equal(presence.socketCount('adv1'), 2);
});

test('leave retire la socket et renvoie son aventure', () => {
  presence.join('adv1', 's1', 'Bob');
  assert.equal(presence.leave('s1'), 'adv1');
  assert.deepEqual(presence.list('adv1'), []);
  assert.equal(presence.socketCount('adv1'), 0);
});

test('leave sur socket inconnue renvoie null', () => {
  assert.equal(presence.leave('inconnu'), null);
});

test('join déplace une socket vers une autre aventure et signale la précédente', () => {
  presence.join('adv1', 's1', 'Bob');
  const { previousAdvId } = presence.join('adv2', 's1', 'Bob');
  assert.equal(previousAdvId, 'adv1');
  assert.deepEqual(presence.list('adv1'), []);
  assert.deepEqual(presence.list('adv2'), ['Bob']);
});

test('re-join dans la MÊME aventure ne signale pas de précédente', () => {
  presence.join('adv1', 's1', 'Bob');
  const { previousAdvId } = presence.join('adv1', 's1', 'Bob');
  assert.equal(previousAdvId, null);
});

test('aventure vide est nettoyée', () => {
  presence.join('adv1', 's1', 'Bob');
  presence.leave('s1');
  assert.equal(presence.socketCount('adv1'), 0);
  assert.deepEqual(presence.list('adv1'), []);
});
