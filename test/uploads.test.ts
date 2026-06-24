// Tests de la résolution sûre des fichiers d'upload (anti-traversal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { uploadFilePath } from '../src/uploads.js';

const DIR = '/srv/app/public/uploads';

test('résout un src de galerie valide', () => {
  assert.equal(uploadFilePath(DIR, '/uploads/abc.png'), path.join(DIR, 'abc.png'));
});

test('refuse un src hors du dossier uploads', () => {
  assert.equal(uploadFilePath(DIR, '/css/style.css'), null);
  assert.equal(uploadFilePath(DIR, 'abc.png'), null);
  assert.equal(uploadFilePath(DIR, ''), null);
});

test('refuse la traversée de répertoire', () => {
  assert.equal(uploadFilePath(DIR, '/uploads/../../etc/passwd'), null);
  assert.equal(uploadFilePath(DIR, '/uploads/sub/dir.png'), null);
  assert.equal(uploadFilePath(DIR, '/uploads/..'), null);
  assert.equal(uploadFilePath(DIR, '/uploads/a\\b.png'), null);
});

test('reste confiné au dossier uploads fourni', () => {
  const resolved = uploadFilePath(DIR, '/uploads/x.jpg');
  assert.ok(resolved && resolved.startsWith(DIR + path.sep));
});
