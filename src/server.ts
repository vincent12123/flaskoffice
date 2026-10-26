import { serve } from '@hono/node-server';
import { buatApp } from './app.js';
import { bacaKonfigurasi, muatEnv } from './konfigurasi.js';
import { bukaDatabase } from './db/koneksi.js';
import { jalankanMigrasi } from './db/migrasi.js';
import { hapusKirimanLama, hapusSesiLama } from './layanan/kelas.js';

muatEnv();
const konfigurasi = bacaKonfigurasi();
const db = bukaDatabase(konfigurasi.dbPath);
jalankanMigrasi(db);

const bersihkan = () => {
  const n = hapusKirimanLama(db, new Date());
  if (n > 0) console.log(`Menghapus ${n} kiriman lama`);
  const s = hapusSesiLama(db, new Date());
  if (s > 0) console.log(`Menghapus ${s} sesi lama yang sudah ditutup`);
};
bersihkan();
const timerBersih = setInterval(bersihkan, 6 * 60 * 60 * 1000);

const app = buatApp({ db, cookieSecure: konfigurasi.cookieSecure, percayaProxy: konfigurasi.percayaProxy });

const server = serve(
  { fetch: app.fetch, port: konfigurasi.port, hostname: konfigurasi.host },
  (info) => console.log(`Flask Office berjalan di http://${konfigurasi.host}:${info.port}`),
);

function berhenti() {
  clearInterval(timerBersih);
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', berhenti);
process.on('SIGTERM', berhenti);
