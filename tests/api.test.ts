import { beforeEach, describe, expect, it } from 'vitest';
import { buatApp } from '../src/app.js';
import { bukaDatabase, type DB } from '../src/db/koneksi.js';
import { jalankanMigrasi } from '../src/db/migrasi.js';
import { buatGuru } from '../src/layanan/auth.js';
import { hapusSesiLama, rekapCSV } from '../src/layanan/kelas.js';

let db: DB;
let waktu: Date;
let app: ReturnType<typeof buatApp>;

beforeEach(async () => {
  db = bukaDatabase(':memory:');
  jalankanMigrasi(db);
  waktu = new Date('2026-10-20T01:00:00Z');
  app = buatApp({ db, cookieSecure: false, percayaProxy: false, sekarang: () => waktu });
  await buatGuru(db, 'sukardi', 'Sukardi', 'rahasia-panjang-1');
});

const json = (body: unknown, header: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...header },
  body: JSON.stringify(body),
});

async function login(username = 'sukardi', password = 'rahasia-panjang-1') {
  const r = await app.request('/api/guru/login', json({ username, password }));
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]!;
  const { csrf } = (await r.json()) as { csrf: string };
  return { status: r.status, cookie, csrf, h: { Cookie: cookie, 'X-CSRF': csrf } };
}

async function bukaSesi(h: Record<string, string>, level = 0, mode = 'tiket') {
  const r = await app.request('/api/guru/sesi', json({ mode, level, label: 'XI RPL 1' }, h));
  return (await r.json()) as { kode: string; id: number };
}

const proyek = [
  { path: 'tugas/app.py', isi: "from flask import Flask\napp = Flask(__name__)\n" },
  { path: 'tugas/venv/x.py', isi: 'abaikan' },
];

describe('login guru', () => {
  it('menolak password salah dan menerima yang benar', async () => {
    expect((await login('sukardi', 'salah-sekali-123')).status).toBe(401);
    const ok = await login();
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^fo_sesi=/);
  });

  it('API guru menolak cookie tanpa header X-CSRF (kode siswa di worker hanya punya cookie)', async () => {
    const { cookie, csrf } = await login();
    expect((await app.request('/api/guru/sesi', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await app.request('/api/guru/sesi', { headers: { Cookie: cookie, 'X-CSRF': csrf + 'x' } })).status).toBe(401);
    expect((await app.request('/api/guru/sesi', { headers: { Cookie: cookie, 'X-CSRF': csrf } })).status).toBe(200);
  });
});

describe('alur sesi kelas', () => {
  it('siswa mengunggah, guru melihat, memeriksa, siswa membaca hasil', async () => {
    const { h } = await login();
    const sesi = await bukaSesi(h, 2);
    expect(sesi.kode).toMatch(/^[A-Z2-9]{6}$/);

    const info = await app.request(`/api/sesi/${sesi.kode.toLowerCase()}`);
    expect(await info.json()).toMatchObject({ level: 2, buka: true, label: 'XI RPL 1' });

    const unggah = await app.request(`/api/sesi/${sesi.kode}/kiriman`, json({ nama: 'Budi Santoso', kelas: 'XI RPL 1', berkas: proyek }));
    expect(unggah.status).toBe(201);
    const { id, token, berkas } = (await unggah.json()) as { id: number; token: string; berkas: string[] };
    expect(berkas).toEqual(['app.py']);

    const daftar = (await (await app.request(`/api/guru/sesi/${sesi.kode}`, { headers: h })).json()) as { kiriman: { id: number; status: string }[] };
    expect(daftar.kiriman).toEqual([expect.objectContaining({ id, status: 'menunggu', ke: 1 })]);

    const detail = (await (await app.request(`/api/guru/kiriman/${id}`, { headers: h })).json()) as { berkas: Record<string, string> };
    expect(detail.berkas['app.py']).toContain('Flask(__name__)');

    const statusAwal = await (await app.request(`/api/kiriman/${id}`, { headers: { 'X-Token': token } })).json();
    expect(statusAwal).toMatchObject({ status: 'menunggu', antre: 0, hasil: null });

    const hasil = {
      lulus: true,
      butir: [
        { label: 'GET /', lulus: true, pesan: 'Sesuai harapan.' },
        { label: 'Saran', lulus: true, pesan: 'Pakai url_for.', saran: true },
      ],
    };
    expect((await app.request(`/api/guru/kiriman/${id}/hasil`, json(hasil, h))).status).toBe(200);

    const statusAkhir = await (await app.request(`/api/kiriman/${id}`, { headers: { 'X-Token': token } })).json();
    expect(statusAkhir).toMatchObject({ status: 'lulus', hasil });

    // token salah tidak bisa membaca kiriman orang lain
    expect((await app.request(`/api/kiriman/${id}`, { headers: { 'X-Token': 'ngawur' } })).status).toBe(404);

    const csv = rekapCSV(db, sesi.id);
    expect(csv).toContain('"Budi Santoso","XI RPL 1","1","Ya","2026-10-20 08:00","Lulus"');
  });

  it('menolak kiriman ke sesi tertutup, tanpa nama, atau tanpa app.py', async () => {
    const { h } = await login();
    const sesi = await bukaSesi(h);
    const kirim = (body: unknown) => app.request(`/api/sesi/${sesi.kode}/kiriman`, json(body));

    expect((await kirim({ nama: '', kelas: 'X', berkas: proyek })).status).toBe(400);
    expect((await kirim({ nama: 'Ani', kelas: 'X', berkas: [{ path: 'hitung.py', isi: '' }] })).status).toBe(400);

    await app.request(`/api/guru/sesi/${sesi.kode}/tutup`, json({}, h));
    const r = await kirim({ nama: 'Ani', kelas: 'X', berkas: proyek });
    expect(r.status).toBe(409);
  });

  it('sesi otomatis tertutup setelah 12 jam', async () => {
    const { h } = await login();
    const sesi = await bukaSesi(h);
    waktu = new Date(waktu.getTime() + 13 * 60 * 60 * 1000);
    const info = (await (await app.request(`/api/sesi/${sesi.kode}`)).json()) as { buka: boolean };
    expect(info.buka).toBe(false);
  });

  it('guru lain tidak bisa melihat sesi atau kiriman milik guru ini', async () => {
    const { h } = await login();
    const sesi = await bukaSesi(h);
    const unggah = await app.request(`/api/sesi/${sesi.kode}/kiriman`, json({ nama: 'Ani', kelas: 'X', berkas: proyek }));
    const { id } = (await unggah.json()) as { id: number };

    await buatGuru(db, 'guru2', 'Guru Dua', 'rahasia-panjang-2');
    const lain = await login('guru2', 'rahasia-panjang-2');
    expect((await app.request(`/api/guru/sesi/${sesi.kode}`, { headers: lain.h })).status).toBe(404);
    expect((await app.request(`/api/guru/kiriman/${id}`, { headers: lain.h })).status).toBe(404);
    expect((await app.request(`/api/guru/kiriman/${id}/hasil`, json({ lulus: true, butir: [] }, lain.h))).status).toBe(404);
  });

  it('rekap CSV menetralkan nilai yang bisa dibaca Excel sebagai rumus', async () => {
    const { h } = await login();
    const sesi = await bukaSesi(h);
    await app.request(`/api/sesi/${sesi.kode}/kiriman`, json({ nama: '=HYPERLINK("x")', kelas: 'X', berkas: proyek }));
    expect(rekapCSV(db, sesi.id)).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('mode proyek bebas', () => {
  it('membuka sesi bebas, menyimpan laporan bertingkat + skor, dan rekap memuat skor', async () => {
    const { h } = await login();
    const sesi = await bukaSesi(h, 3, 'bebas');
    const info = (await (await app.request(`/api/sesi/${sesi.kode}`)).json()) as { mode: string; level: number };
    expect(info).toMatchObject({ mode: 'bebas', level: 0 });

    const unggah = await app.request(`/api/sesi/${sesi.kode}/kiriman`, json({ nama: 'Ani', kelas: 'XI RPL 1', berkas: [{ path: 'main.py', isi: 'x' }] }));
    const { id } = (await unggah.json()) as { id: number };
    const laporan = {
      lulus: false,
      skor: 72.4,
      ringkasan: { bug: 1, peringatan: 2, halaman: 5, 'BUKAN-KUNCI': 9 },
      butir: [{ label: 'GET /hapus/1', lulus: false, pesan: 'Error 500', tingkat: 'bug', kategori: 'Route', lokasi: 'main.py baris 20' }],
    };
    expect((await app.request(`/api/guru/kiriman/${id}/hasil`, json(laporan, h))).status).toBe(200);
    const tersimpan = (await (await app.request(`/api/guru/kiriman/${id}`, { headers: h })).json()) as { hasil: Record<string, unknown> };
    expect(tersimpan.hasil).toMatchObject({ skor: 72, ringkasan: { bug: 1, peringatan: 2, halaman: 5 } });
    expect((tersimpan.hasil.ringkasan as Record<string, number>)['BUKAN-KUNCI']).toBeUndefined();

    expect(rekapCSV(db, sesi.id)).toContain('"Belum lulus","72"');

    // tingkat yang tidak dikenal ditolak
    const salah = { lulus: true, butir: [{ label: 'x', lulus: true, pesan: 'y', tingkat: 'kritis' }] };
    expect((await app.request(`/api/guru/kiriman/${id}/hasil`, json(salah, h))).status).toBe(400);
  });
});

describe('pembatas laju per IP', () => {
  // @hono/node-server meneruskan soket lewat c.env.incoming; app.request menerima env sebagai argumen ke-3
  const dari = (ip: string) => ({ incoming: { socket: { remoteAddress: ip } } });
  const unggah = (kode: string, ip: string, header: Record<string, string> = {}) =>
    app.request(`/api/sesi/${kode}/kiriman`, json({ nama: 'Ani', kelas: 'XI', berkas: proyek }, header), dari(ip));

  it('di LAN (tanpa proxy) tiap siswa punya jatah sendiri, dan header palsu tidak berpengaruh', async () => {
    const { h } = await login();
    const sesi = await bukaSesi(h);
    for (let i = 0; i < 10; i++) expect((await unggah(sesi.kode, '192.168.1.21')).status).toBe(201);
    expect((await unggah(sesi.kode, '192.168.1.21')).status).toBe(429);
    // siswa lain di kelas yang sama tidak ikut terkena batas
    expect((await unggah(sesi.kode, '192.168.1.22')).status).toBe(201);
    // TRUST_PROXY=false: X-Forwarded-For dari siswa tidak dipercaya
    expect((await unggah(sesi.kode, '192.168.1.21', { 'X-Forwarded-For': '10.9.9.9' })).status).toBe(429);
  });

  it('di balik proxy (TRUST_PROXY=true) memakai IP asli dari header Cloudflare', async () => {
    app = buatApp({ db, cookieSecure: false, percayaProxy: true, sekarang: () => waktu });
    const { h } = await login();
    const sesi = await bukaSesi(h);
    // semua permintaan datang dari soket yang sama (tunnel), tetapi IP pengirim berbeda
    for (let i = 0; i < 10; i++) expect((await unggah(sesi.kode, '127.0.0.1', { 'CF-Connecting-IP': '36.1.1.1' })).status).toBe(201);
    expect((await unggah(sesi.kode, '127.0.0.1', { 'CF-Connecting-IP': '36.1.1.1' })).status).toBe(429);
    expect((await unggah(sesi.kode, '127.0.0.1', { 'CF-Connecting-IP': '36.2.2.2' })).status).toBe(201);
  });
});

describe('mode proyek POS', () => {
  it('membuka sesi POS per bab (Bab 2–17) dan menolak bab di luar jangkauan', async () => {
    const { h } = await login();
    const sesi = await bukaSesi(h, 15, 'pos');   // indeks 15 = Bab 17
    const info = (await (await app.request(`/api/sesi/${sesi.kode}`)).json()) as { mode: string; level: number };
    expect(info).toMatchObject({ mode: 'pos', level: 15 });
    const salah = await app.request('/api/guru/sesi', json({ mode: 'pos', level: 16, label: 'X' }, h));
    expect(salah.status).toBe(400);
  });
});

describe('daftar & hapus sesi', () => {
  const daftar = async (h: Record<string, string>, status = 'aktif') =>
    (await (await app.request(`/api/guru/sesi?status=${status}`, { headers: h })).json()) as
      { jumlah: { aktif: number; ditutup: number }; sesi: { kode: string }[] };

  it('memisahkan sesi aktif dan ditutup (termasuk yang kedaluwarsa)', async () => {
    const { h } = await login();
    const a = await bukaSesi(h);
    const b = await bukaSesi(h);
    await app.request(`/api/guru/sesi/${b.kode}/tutup`, json({}, h));
    let d = await daftar(h);
    expect(d.jumlah).toEqual({ aktif: 1, ditutup: 1 });
    expect(d.sesi.map((s) => s.kode)).toEqual([a.kode]);
    expect((await daftar(h, 'ditutup')).sesi.map((s) => s.kode)).toEqual([b.kode]);

    waktu = new Date(waktu.getTime() + 13 * 60 * 60 * 1000);   // sesi a kedaluwarsa
    d = await daftar((await login()).h);                       // login lama juga sudah kedaluwarsa
    expect(d.jumlah).toEqual({ aktif: 0, ditutup: 2 });
  });

  it('menghapus sesi yang ditutup beserta kirimannya; sesi aktif harus ditutup dulu', async () => {
    const { h } = await login();
    const s = await bukaSesi(h);
    await app.request(`/api/sesi/${s.kode}/kiriman`, json({ nama: 'Ani', kelas: 'X', berkas: proyek }));
    expect((await app.request(`/api/guru/sesi/${s.kode}`, { method: 'DELETE', headers: h })).status).toBe(409);

    await app.request(`/api/guru/sesi/${s.kode}/tutup`, json({}, h));
    expect((await app.request(`/api/guru/sesi/${s.kode}`, { method: 'DELETE', headers: h })).status).toBe(200);
    expect((await app.request(`/api/guru/sesi/${s.kode}`, { headers: h })).status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM kiriman').get()).toEqual({ n: 0 });
  });

  it('hapus semua yang ditutup tidak menyentuh sesi aktif maupun sesi guru lain', async () => {
    const { h } = await login();
    const aktif = await bukaSesi(h);
    for (let i = 0; i < 3; i++) {
      const s = await bukaSesi(h);
      await app.request(`/api/guru/sesi/${s.kode}/tutup`, json({}, h));
    }
    await buatGuru(db, 'guru2', 'Guru Dua', 'rahasia-panjang-2');
    const lain = await login('guru2', 'rahasia-panjang-2');
    const milikLain = await bukaSesi(lain.h);
    await app.request(`/api/guru/sesi/${milikLain.kode}/tutup`, json({}, lain.h));

    const r = (await (await app.request('/api/guru/sesi-ditutup/hapus', json({}, h))).json()) as { terhapus: number };
    expect(r.terhapus).toBe(3);
    expect((await daftar(h)).sesi.map((s) => s.kode)).toEqual([aktif.kode]);
    expect((await daftar(h, 'ditutup')).jumlah.ditutup).toBe(0);
    expect((await daftar(lain.h, 'ditutup')).sesi.map((s) => s.kode)).toEqual([milikLain.kode]);
    // guru lain juga tidak bisa menghapus sesi milik guru ini
    expect((await app.request(`/api/guru/sesi/${aktif.kode}`, { method: 'DELETE', headers: lain.h })).status).toBe(404);
  });

  it('membersihkan otomatis sesi yang sudah ditutup lebih dari 90 hari', async () => {
    const { h } = await login();
    const lama = await bukaSesi(h);
    await app.request(`/api/guru/sesi/${lama.kode}/tutup`, json({}, h));
    const kedaluwarsa = await bukaSesi(h);          // tidak pernah ditutup manual
    waktu = new Date(waktu.getTime() + 60 * 24 * 60 * 60 * 1000);
    const h2 = (await login()).h;
    const baru = await bukaSesi(h2);
    await app.request(`/api/guru/sesi/${baru.kode}/tutup`, json({}, h2));

    expect(hapusSesiLama(db, new Date(waktu.getTime() + 20 * 24 * 60 * 60 * 1000))).toBe(0);   // baru 80 hari
    expect(hapusSesiLama(db, new Date(waktu.getTime() + 31 * 24 * 60 * 60 * 1000))).toBe(2);   // 91 hari
    const sisa = (db.prepare('SELECT kode FROM sesi_kelas').all() as { kode: string }[]).map((s) => s.kode);
    expect(sisa).toEqual([baru.kode]);
    expect(sisa).not.toContain(kedaluwarsa.kode);
  });
});
