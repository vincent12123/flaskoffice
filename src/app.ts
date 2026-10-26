import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import QRCode from 'qrcode';
import type { DB } from './db/koneksi.js';
import { AKAR_PROYEK } from './konfigurasi.js';
import { buatSesiLogin, guruDariSesi, hapusSesiLogin, periksaLogin, type Guru } from './layanan/auth.js';
import { rapikanBerkas } from './layanan/berkas.js';
import {
  ambilKiriman, ambilSesiKelas, bersihkanTeks, bukaSesiKelas, cariSesiKelas, daftarKiriman, daftarSesiGuru,
  kirimanUntukSiswa, rekapCSV, sesiMasihBuka, hitungSesiGuru, hapusSesiKelas, hapusSesiDitutup, simpanHasil, simpanKiriman, tutupSesiKelas, validasiHasil,
} from './layanan/kelas.js';

export interface OpsiApp {
  db: DB;
  cookieSecure: boolean;
  percayaProxy: boolean;
  sekarang?: () => Date;
}

const COOKIE = 'fo_sesi';

/** Pembatas laju sederhana di memori: maks `batas` kejadian per `jendelaMs` per kunci. */
export class PembatasLaju {
  private catatan = new Map<string, number[]>();
  constructor(private batas: number, private jendelaMs: number) {}
  boleh(kunci: string, sekarang = Date.now()): boolean {
    const daftar = (this.catatan.get(kunci) ?? []).filter((t) => t > sekarang - this.jendelaMs);
    if (daftar.length >= this.batas) {
      this.catatan.set(kunci, daftar);
      return false;
    }
    daftar.push(sekarang);
    this.catatan.set(kunci, daftar);
    if (this.catatan.size > 5000) this.catatan.clear();
    return true;
  }
}

type Variabel = { Variables: { guru: Guru } };

export function buatApp(opsi: OpsiApp) {
  const { db } = opsi;
  const sekarang = opsi.sekarang ?? (() => new Date());
  const app = new Hono<Variabel>();

  const batasLogin = new PembatasLaju(8, 15 * 60 * 1000);
  const batasUnggah = new PembatasLaju(10, 60 * 1000);
  const batasCek = new PembatasLaju(120, 60 * 1000);

  // Kunci pembatas laju = IP pengirim. Di balik proxy (Cloudflare Tunnel) IP asli ada di header;
  // tanpa proxy (dijalankan di LAN lab) IP diambil dari soket @hono/node-server, supaya tiap siswa
  // punya jatah sendiri — kalau tidak, satu kelas berbagi satu jatah dan cepat terkena 429.
  // Header proxy diabaikan bila TRUST_PROXY=false agar tidak bisa dipalsukan siswa.
  const ipDari = (c: Context) => {
    const dariProxy = opsi.percayaProxy && (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim());
    if (dariProxy) return dariProxy;
    const soket = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
    return soket || 'lokal';
  };

  // Header keamanan dasar untuk semua respons
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
  });

  // -------------------------------------------------------------------------
  // Halaman & aset statis
  // -------------------------------------------------------------------------
  const fflate = readFileSync(path.join(AKAR_PROYEK, 'node_modules', 'fflate', 'esm', 'browser.js'), 'utf8');
  app.get('/vendor/fflate.js', (c) => c.body(fflate, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }));
  // three.js untuk kantor 3D; disajikan lokal supaya proyektor tidak bergantung pada CDN.
  // three.module.js mengimpor './three.core.js', jadi keduanya disajikan berdampingan.
  for (const berkas of ['three.module.js', 'three.core.js']) {
    const isi = readFileSync(path.join(AKAR_PROYEK, 'node_modules', 'three', 'build', berkas), 'utf8');
    app.get(`/vendor/${berkas}`, (c) => c.body(isi, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }));
  }
  // Add-on three.js untuk Pemeriksa: minifig LEGO (LDraw) + kepala facecap (glTF dengan meshopt & KTX2/Basis).
  // Hanya berkas yang memang diimpor yang disajikan; add-on mengimpor 'three' lewat import map di guru.html.
  const ADDON_THREE = [
    'loaders/LDrawLoader.js', 'materials/LDrawConditionalLineMaterial.js',
    'loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js',
    'loaders/KTX2Loader.js', 'libs/ktx-parse.module.js', 'libs/zstddec.module.js', 'math/ColorSpaces.js', 'utils/WorkerPool.js',
    'libs/meshopt_decoder.module.js', 'libs/basis/basis_transcoder.js', 'libs/basis/basis_transcoder.wasm',
  ];
  for (const berkas of ADDON_THREE) {
    const isi = readFileSync(path.join(AKAR_PROYEK, 'node_modules', 'three', 'examples', 'jsm', berkas));
    const jenis = berkas.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8';
    app.get(`/vendor/three-addons/${berkas}`, (c) => c.body(isi, 200, { 'Content-Type': jenis, 'Cache-Control': 'public, max-age=86400' }));
  }
  // Halaman & skrip selalu divalidasi ulang: setelah update, browser guru tidak boleh
  // tetap memakai pemeriksa versi lama dari cache.
  app.use('*', async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/api/') && !c.req.path.startsWith('/vendor/')) c.header('Cache-Control', 'no-cache');
  });
  app.get('/guru', serveStatic({ path: path.join(AKAR_PROYEK, 'public', 'guru.html') }));
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), path.join(AKAR_PROYEK, 'public')) || '.' }));

  // -------------------------------------------------------------------------
  // API siswa (tanpa akun)
  // -------------------------------------------------------------------------
  app.get('/api/sesi/:kode', (c) => {
    if (!batasCek.boleh(ipDari(c))) return c.json({ pesan: 'Terlalu banyak permintaan. Tunggu sebentar.' }, 429);
    const s = cariSesiKelas(db, c.req.param('kode'));
    if (!s) return c.json({ pesan: 'Kode sesi tidak ditemukan. Periksa lagi kode di layar proyektor.' }, 404);
    return c.json({ kode: s.kode, mode: s.mode, level: s.level, label: s.label, buka: sesiMasihBuka(s, sekarang()) });
  });

  app.post('/api/sesi/:kode/kiriman', bodyLimit({ maxSize: 3 * 1024 * 1024, onError: (c) => c.json({ pesan: 'Kiriman terlalu besar. Jangan ikutkan folder venv.' }, 413) }), async (c) => {
    if (!batasUnggah.boleh(ipDari(c))) return c.json({ pesan: 'Terlalu sering mengunggah. Tunggu satu menit.' }, 429);
    const s = cariSesiKelas(db, c.req.param('kode'));
    if (!s) return c.json({ pesan: 'Kode sesi tidak ditemukan.' }, 404);
    if (!sesiMasihBuka(s, sekarang())) return c.json({ pesan: 'Sesi ini sudah ditutup guru.' }, 409);
    let data: Record<string, unknown>;
    try {
      data = await c.req.json();
    } catch {
      return c.json({ pesan: 'Format kiriman tidak dikenal.' }, 400);
    }
    const nama = bersihkanTeks(data.nama, 60);
    const kelas = bersihkanTeks(data.kelas, 20);
    if (nama.length < 2) return c.json({ pesan: 'Isi nama lengkap.' }, 400);
    if (!kelas) return c.json({ pesan: 'Isi kelas, misalnya XI RPL 1.' }, 400);
    const rapi = rapikanBerkas(data.berkas);
    if (!rapi.ok) return c.json({ pesan: rapi.pesan }, 400);
    const { id, token } = simpanKiriman(db, s.id, nama, kelas, rapi.berkas, rapi.ukuran, sekarang());
    return c.json({ id, token, berkas: Object.keys(rapi.berkas) }, 201);
  });

  app.get('/api/kiriman/:id', (c) => {
    if (!batasCek.boleh(ipDari(c))) return c.json({ pesan: 'Terlalu banyak permintaan.' }, 429);
    const k = kirimanUntukSiswa(db, Number(c.req.param('id')), c.req.header('x-token') ?? '');
    if (!k) return c.json({ pesan: 'Kiriman tidak ditemukan.' }, 404);
    const antre = k.status === 'menunggu'
      ? (db.prepare("SELECT COUNT(*) AS n FROM kiriman WHERE sesi_id = ? AND status = 'menunggu' AND id < ?").get(k.sesi_id, k.id) as { n: number }).n
      : 0;
    return c.json({ status: k.status, antre, hasil: k.hasil_json ? JSON.parse(k.hasil_json) : null });
  });

  // -------------------------------------------------------------------------
  // API guru
  // -------------------------------------------------------------------------
  app.post('/api/guru/login', async (c) => {
    const ip = ipDari(c);
    if (!batasLogin.boleh(ip)) return c.json({ pesan: 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.' }, 429);
    const data = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const guru = await periksaLogin(db, String(data.username ?? ''), String(data.password ?? ''));
    if (!guru) return c.json({ pesan: 'Username atau password salah.' }, 401);
    const { token, csrf } = buatSesiLogin(db, guru.id, sekarang());
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Strict', secure: opsi.cookieSecure, path: '/', maxAge: 12 * 60 * 60 });
    return c.json({ nama: guru.nama, csrf });
  });

  app.use('/api/guru/*', async (c, next) => {
    if (c.req.path === '/api/guru/login') return next();
    const guru = guruDariSesi(db, getCookie(c, COOKIE), c.req.header('x-csrf'), sekarang());
    if (!guru) return c.json({ pesan: 'Silakan login lagi.' }, 401);
    c.set('guru', guru);
    return next();
  });

  app.post('/api/guru/logout', (c) => {
    const token = getCookie(c, COOKIE);
    if (token) hapusSesiLogin(db, token);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/guru/saya', (c) => c.json({ nama: c.get('guru').nama }));

  app.get('/api/guru/sesi', (c) => {
    const waktu = sekarang();
    const saringan = c.req.query('status') === 'ditutup' ? 'ditutup' : 'aktif';
    const guruId = c.get('guru').id;
    return c.json({
      saringan,
      jumlah: hitungSesiGuru(db, guruId, waktu),
      sesi: daftarSesiGuru(db, guruId, saringan, waktu).map((s) => ({ ...s, buka: sesiMasihBuka(s, waktu) })),
    });
  });

  // Hapus semua sesi yang sudah ditutup (permanen; sesi yang masih buka tidak ikut)
  app.post('/api/guru/sesi-ditutup/hapus', (c) => c.json({ terhapus: hapusSesiDitutup(db, c.get('guru').id, sekarang()) }));

  app.post('/api/guru/sesi', async (c) => {
    const data = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const mode = data.mode === 'bebas' || data.mode === 'pos' ? data.mode : 'tiket';
      const s = bukaSesiKelas(db, c.get('guru').id, mode, Number(data.level ?? 0), bersihkanTeks(data.label, 40), sekarang());
      return c.json(s, 201);
    } catch (e) {
      return c.json({ pesan: (e as Error).message }, 400);
    }
  });

  /** Sesi milik guru yang login, atau respons 404. */
  const sesiMilik = (c: Context<Variabel>) => {
    const s = cariSesiKelas(db, c.req.param('kode') ?? '');
    return s && s.guru_id === c.get('guru').id ? s : undefined;
  };

  app.get('/api/guru/sesi/:kode', (c) => {
    const s = sesiMilik(c);
    if (!s) return c.json({ pesan: 'Sesi tidak ditemukan.' }, 404);
    return c.json({ ...s, buka: sesiMasihBuka(s, sekarang()), kiriman: daftarKiriman(db, s.id) });
  });

  app.delete('/api/guru/sesi/:kode', (c) => {
    const s = sesiMilik(c);
    if (!s) return c.json({ pesan: 'Sesi tidak ditemukan.' }, 404);
    if (sesiMasihBuka(s, sekarang())) return c.json({ pesan: 'Tutup sesi dulu sebelum menghapusnya.' }, 409);
    hapusSesiKelas(db, s.id);
    return c.json({ ok: true });
  });

  app.post('/api/guru/sesi/:kode/tutup', (c) => {
    const s = sesiMilik(c);
    if (!s) return c.json({ pesan: 'Sesi tidak ditemukan.' }, 404);
    tutupSesiKelas(db, s.id, sekarang());
    return c.json({ ok: true });
  });

  app.get('/api/guru/sesi/:kode/qr.svg', async (c) => {
    const s = sesiMilik(c);
    if (!s) return c.json({ pesan: 'Sesi tidak ditemukan.' }, 404);
    const url = new URL(c.req.url);
    const asal = opsi.percayaProxy && c.req.header('x-forwarded-proto') ? `${c.req.header('x-forwarded-proto')}://${url.host}` : url.origin;
    const svg = await QRCode.toString(`${asal}/?sesi=${s.kode}`, { type: 'svg', margin: 1 });
    return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' });
  });

  app.get('/api/guru/sesi/:kode/rekap.csv', (c) => {
    const s = sesiMilik(c);
    if (!s) return c.json({ pesan: 'Sesi tidak ditemukan.' }, 404);
    return c.body(rekapCSV(db, s.id), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rekap-${s.kode}.csv"`,
    });
  });

  /** Kiriman yang termasuk sesi milik guru yang login. */
  const kirimanMilik = (c: Context<Variabel>) => {
    const k = ambilKiriman(db, Number(c.req.param('id')));
    if (!k) return undefined;
    const s = ambilSesiKelas(db, k.sesi_id);
    return s && s.guru_id === c.get('guru').id ? { k, s } : undefined;
  };

  app.get('/api/guru/kiriman/:id', (c) => {
    const ada = kirimanMilik(c);
    if (!ada) return c.json({ pesan: 'Kiriman tidak ditemukan.' }, 404);
    const { k } = ada;
    return c.json({
      id: k.id, nama: k.nama, kelas: k.kelas, status: k.status, dikirim_pada: k.dikirim_pada,
      berkas: JSON.parse(k.berkas_json), hasil: k.hasil_json ? JSON.parse(k.hasil_json) : null,
    });
  });

  app.post('/api/guru/kiriman/:id/hasil', async (c) => {
    const ada = kirimanMilik(c);
    if (!ada) return c.json({ pesan: 'Kiriman tidak ditemukan.' }, 404);
    const hasil = validasiHasil(await c.req.json().catch(() => null));
    if (!hasil) return c.json({ pesan: 'Format hasil tidak dikenal.' }, 400);
    simpanHasil(db, ada.k.id, hasil, sekarang());
    return c.json({ ok: true });
  });

  return app;
}
