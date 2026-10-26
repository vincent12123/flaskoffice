import { describe, expect, it } from 'vitest';
import { BATAS, rapikanBerkas } from '../src/layanan/berkas.js';

const b = (path: string, isi = 'x') => ({ path, isi });

describe('rapikanBerkas', () => {
  it('menjadikan folder app.py sebagai akar dan membuang venv/__pycache__/.env', () => {
    const h = rapikanBerkas([
      b('tugas/app.py', 'from flask import Flask'),
      b('tugas/templates/index.html', '<h1>{{ x }}</h1>'),
      b('tugas/templates/sub/a.html'),
      b('tugas/static/gaya.css'),
      b('tugas/static/js/main.js'),
      b('tugas/static/logo.png', 'ISI-BINER'),
      b('tugas/venv/Lib/site-packages/flask/app.py'),
      b('tugas/__pycache__/app.cpython-312.pyc'),
      b('tugas/.vscode/settings.json'),
      b('tugas/.env', 'SECRET_KEY=rahasia'),
      b('tugas/models.py'),
      b('tugas/routes/siswa.py'),
      b('tugas/requirements.txt', 'flask'),
      b('tugas/schema.sql', 'CREATE TABLE x (id INTEGER);'),
      b('tugas/README.md'),
    ]);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.entry).toBe('app.py');
    expect(Object.keys(h.berkas).sort()).toEqual([
      'app.py', 'models.py', 'requirements.txt', 'routes/siswa.py', 'schema.sql',
      'static/gaya.css', 'static/js/main.js', 'static/logo.png', 'templates/index.html', 'templates/sub/a.html',
    ]);
    // gambar hanya dicatat namanya
    expect(h.berkas['static/logo.png']).toBe('');
  });

  it('memakai entry paling dangkal, bukan yang di dalam venv', () => {
    const h = rapikanBerkas([b('venv/flask/app.py', 'SALAH'), b('app.py', 'BENAR')]);
    expect(h.ok && h.berkas['app.py']).toBe('BENAR');
  });

  it('menerima main.py / run.py sebagai entry', () => {
    const h = rapikanBerkas([b('proyek/main.py', 'from flask import Flask'), b('proyek/templates/a.html')]);
    expect(h.ok && h.entry).toBe('main.py');
  });

  it('mengenali pola factory app/__init__.py', () => {
    const h = rapikanBerkas([
      b('web/app/__init__.py', 'from flask import Flask\ndef create_app():\n    return Flask(__name__)'),
      b('web/app/routes.py'),
      b('web/app/templates/index.html'),
      b('web/config.py'),
    ]);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.entry).toBe('app/__init__.py');
    expect(Object.keys(h.berkas).sort()).toEqual(['app/__init__.py', 'app/routes.py', 'app/templates/index.html', 'config.py']);
  });

  it('proyek POS: menyimpan tests/, .gitignore, .env.example, pytest.ini; .env tetap dibuang', () => {
    const h = rapikanBerkas([
      b('pos/app/__init__.py', 'from flask import Flask\ndef create_app():\n    return Flask(__name__)'),
      b('pos/config.py'),
      b('pos/tests/test_auth.py'),
      b('pos/.gitignore', '.env\n.venv/'),
      b('pos/.env.example', 'SECRET_KEY='),
      b('pos/.env', 'SECRET_KEY=rahasia-asli'),
      b('pos/pytest.ini', '[pytest]'),
      b('pos/ruff.toml', 'line-length = 100'),
      b('pos/instance/pos_smk.db', 'SQLite'),
    ]);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(Object.keys(h.berkas).sort()).toEqual([
      '.env.example', '.gitignore', 'app/__init__.py', 'config.py', 'pytest.ini', 'ruff.toml', 'tests/test_auth.py',
    ]);
  });

  it('menolak bila tidak ada berkas aplikasi Flask', () => {
    const h = rapikanBerkas([b('hitung.py'), b('templates/index.html')]);
    expect(h).toEqual({ ok: false, pesan: expect.stringContaining('Tidak ditemukan berkas aplikasi Flask') });
  });

  it('menolak path dengan .. atau absolut', () => {
    expect(rapikanBerkas([b('../app.py')]).ok).toBe(false);
    expect(rapikanBerkas([b('/etc/app.py')]).ok).toBe(false);
    expect(rapikanBerkas([b('C:/x/app.py')]).ok).toBe(false);
  });

  it('menerima path Windows dengan backslash', () => {
    const h = rapikanBerkas([b('proyek\\app.py'), b('proyek\\templates\\index.html')]);
    expect(h.ok && Object.keys(h.berkas).sort()).toEqual(['app.py', 'templates/index.html']);
  });

  it('menolak berkas terlalu besar dan total terlalu besar', () => {
    expect(rapikanBerkas([b('app.py', 'a'.repeat(BATAS.perBerkas + 1))]).ok).toBe(false);
    const banyak = [b('app.py')];
    for (let i = 0; i < 9; i++) banyak.push(b(`templates/t${i}.html`, 'a'.repeat(190 * 1024)));
    expect(rapikanBerkas(banyak)).toEqual({ ok: false, pesan: expect.stringContaining('terlalu besar') });
  });

  it('menolak format yang bukan daftar berkas', () => {
    expect(rapikanBerkas(null).ok).toBe(false);
    expect(rapikanBerkas([{ path: 1, isi: 'x' }]).ok).toBe(false);
    expect(rapikanBerkas([]).ok).toBe(false);
  });
});
