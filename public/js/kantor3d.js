// =====================================================================
// KANTOR VOXEL 3D — versi three.js dari kantor pixel-art (kantor.js).
//
//   Antarmukanya sama dengan buatKantor(): datang, periksa, kabar, hasil, papan,
//   layar, reset — jadi guru.js bisa memakai salah satunya. Sprite 12×16 dari
//   kantor.js dipakai ulang dan "ditebalkan" menjadi kotak-kotak voxel, sehingga
//   karakter siswa yang sama terlihat sama di versi 2D maupun 3D.
//
//   Teks (nama, gelembung bicara, ikon, efek) tidak digambar di WebGL, melainkan di
//   lapisan HTML di atas kanvas supaya tetap tajam di proyektor. Nama siswa selalu
//   disisipkan lewat textContent / fillText (tidak pernah sebagai markup).
//
//   Bila WebGL2 tidak ada atau three.js gagal dimuat, guru.js kembali ke kantor SVG.
// =====================================================================
import * as THREE from '/vendor/three.module.js';
import { baris, IKON, penampilan, pecah, WARNA_CATATAN } from '/js/kantor.js';

const V = 3;               // ukuran satu voxel = satu piksel sprite
const TEBAL = 4;           // ketebalan karakter (voxel)
const KECEPATAN = 85;      // satuan dunia per detik (sama dengan piksel di versi 2D)
const KETIK_MS = 28;       // jeda per huruf pada gelembung bicara
const DASAR = { E: 'S', M: 'S', T: 'S' };   // isi kepala di belakang mata/mulut

// Denah lantai: x kiri→kanan, z dinding belakang→depan (0–270).
//   x −170..0  ruang tunggu (kursi murid, layar antrean)
//   x    0..480 ruang periksa; pintu masuk di dinding kiri (x = 0), pintu keluar di dinding kanan
//              (x = 484) menuju taman — murid yang masuk dan keluar tidak berpapasan.
const TEMPAT = {
  // ruang tunggu
  koridor: { x: -215, z: 228 }, masukTunggu: { x: -150, z: 228 }, lorongTunggu: { x: -60, z: 140 },
  depanPintuMasuk: { x: -22, z: 172 },
  // ruang periksa
  balikPintuMasuk: { x: 34, z: 172 }, sambutPintuMasuk: { x: 30, z: 214 },
  kursiTamu: { x: 150, z: 118 }, sampingMurid: { x: 196, z: 176 },
  meja: { x: 258, z: 130 }, sampingPemeriksa: { x: 296, z: 136 }, depanPapan: { x: 96, z: 40 },
  mejaDev: { x: 326, z: 66 }, terminal: { x: 380, z: 70 }, sampingServer: { x: 366, z: 104 },
  pojokQA: { x: 440, z: 210 },
  // keluar
  lorongKeluar: { x: 190, z: 205 }, depanPintuKeluar: { x: 452, z: 196 }, pintu: { x: 502, z: 172 }, luar: { x: 548, z: 172 },
};
// Empat kursi tunggu satu baris, menghadap kamera
const KURSI_TUNGGU = [-150, -118, -86, -54].map((x) => ({ x, z: 72 }));
const ARAH_MEJA = Math.PI;      // membelakangi kamera, menghadap monitor/server
// Tinggi karakter Mixamo (Pemeriksa). Lebih tinggi dari voxel (48) karena tubuh manusia yang ramping
// tampak lebih kecil daripada sprite voxel yang gempal pada tinggi yang sama.
const TINGGI_MIXAMO = 68;

/**
 * Aturan panggung: karakter yang menghadap ke samping diputar 3/4 ke arah kamera,
 * supaya wajah & badannya tetap terlihat (sprite yang ditebalkan tampak tipis dari samping).
 */
function panggung(sudut) {
  const a = Math.abs(sudut);
  return a > 0.9 && a < 2.2 ? Math.sign(sudut) * 0.9 : sudut;
}
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

/** three.js r186 butuh WebGL2. */
export function dukungWebGL() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function buatKantor3D(wadah) {
  const akar = document.createElement('div');
  akar.className = 'kantor3d';
  akar.setAttribute('role', 'img');
  akar.setAttribute('aria-label', 'Kantor voxel 3D yang memeriksa kiriman');
  const lapisan = document.createElement('div');
  lapisan.className = 'lapisan';

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  akar.append(renderer.domElement, lapisan);
  wadah.append(akar);

  const adegan = new THREE.Scene();
  adegan.background = new THREE.Color('#efe6d2');

  // Kamera menatap seluruh kantor (ruang tunggu sampai pintu keluar). Ia hanya bergeser pelan pada
  // tiga momen — murid dipanggil, kode dibawa ke server, kembali luas — supaya tidak melelahkan di proyektor.
  const kamera = new THREE.PerspectiveCamera(20, 16 / 9, 50, 3000);
  const SUDUT = THREE.MathUtils.degToRad(48);
  const arahKamera = new THREE.Vector3(0, Math.sin(SUDUT), Math.cos(SUDUT));
  const FOKUS = {
    luas: { x: 180, z: 136, jarak: 1150 },
    panggil: { x: 90, z: 140, jarak: 1000 },
    server: { x: 300, z: 120, jarak: 1000 },
  };
  const fokusKini = { ...FOKUS.luas };
  let fokusTujuan = FOKUS.luas;
  const sasaranKamera = new THREE.Vector3();
  function aturKamera() {
    sasaranKamera.set(fokusKini.x, 22, fokusKini.z);
    kamera.position.copy(sasaranKamera).addScaledVector(arahKamera, fokusKini.jarak);
    kamera.lookAt(sasaranKamera);
  }
  aturKamera();
  const fokus = (nama) => { fokusTujuan = FOKUS[nama]; };

  adegan.add(new THREE.HemisphereLight('#fff7ea', '#b59a72', 1.7));
  const matahari = new THREE.DirectionalLight('#ffffff', 1.9);
  matahari.position.set(60, 320, 300);
  matahari.target.position.set(180, 0, 130);
  matahari.castShadow = true;
  matahari.shadow.mapSize.set(2048, 1024);
  Object.assign(matahari.shadow.camera, { left: -420, right: 420, top: 230, bottom: -230, near: 50, far: 900 });
  matahari.shadow.bias = -0.0008;
  adegan.add(matahari, matahari.target);

  // -------------------------------------------------------------------
  // Pembantu bentuk
  // -------------------------------------------------------------------
  const geomKotak = new THREE.BoxGeometry(1, 1, 1);
  const daftarBahan = new Map();
  const lambert = (warna) => {
    if (!daftarBahan.has(warna)) daftarBahan.set(warna, new THREE.MeshLambertMaterial({ color: warna }));
    return daftarBahan.get(warna);
  };

  /** Kotak dari sudut (x1,y1,z1) ke (x2,y2,z2). */
  function kotak(x1, y1, z1, x2, y2, z2, warna, induk = adegan) {
    const m = new THREE.Mesh(geomKotak, typeof warna === 'string' ? lambert(warna) : warna);
    m.scale.set(x2 - x1, y2 - y1, z2 - z1);
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    m.castShadow = m.receiveShadow = true;
    induk.add(m);
    return m;
  }

  function silinder(x, y1, z, r, y2, warna) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y2 - y1, 16), lambert(warna));
    m.position.set(x, (y1 + y2) / 2, z);
    m.castShadow = m.receiveShadow = true;
    adegan.add(m);
    return m;
  }

  function kanvas(lebar, tinggi) {
    const k = document.createElement('canvas');
    k.width = lebar; k.height = tinggi;
    const tekstur = new THREE.CanvasTexture(k);
    tekstur.colorSpace = THREE.SRGBColorSpace;
    tekstur.anisotropy = 4;
    return { ctx: k.getContext('2d'), tekstur };
  }

  /** Bidang datar menghadap +z (dinding, layar). `bercahaya` = tidak terpengaruh lampu. */
  function panel(x, y, z, lebar, tinggi, tekstur, bercahaya = false) {
    const bahan = bercahaya
      ? new THREE.MeshBasicMaterial({ map: tekstur, toneMapped: false })
      : new THREE.MeshLambertMaterial({ map: tekstur });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(lebar, tinggi), bahan);
    m.position.set(x, y, z);
    m.receiveShadow = !bercahaya;
    adegan.add(m);
    return m;
  }

  // -------------------------------------------------------------------
  // Ruangan
  // -------------------------------------------------------------------
  {
    // Lantai papan kayu (mengikuti garis-garis lantai versi 2D)
    const { ctx, tekstur } = kanvas(960, 540);
    ctx.fillStyle = '#e9d9b8';
    ctx.fillRect(0, 0, 960, 540);
    for (let i = 0; i < 14; i++) {
      const y = i * 40;
      ctx.fillStyle = i % 2 ? 'rgba(138,111,82,.06)' : 'rgba(255,255,255,.08)';
      ctx.fillRect(0, y, 960, 40);
      ctx.fillStyle = 'rgba(138,111,82,.28)';
      ctx.fillRect(0, y, 960, 2);
      for (let x = (i * 173) % 240; x < 960; x += 240) ctx.fillRect(x, y, 2, 40);
    }
    const lantai = new THREE.Mesh(new THREE.PlaneGeometry(480, 270), new THREE.MeshLambertMaterial({ map: tekstur }));
    lantai.rotation.x = -Math.PI / 2;
    lantai.position.set(240, 0, 135);
    lantai.receiveShadow = true;
    adegan.add(lantai);
    // Ruang tunggu: lantai ubin terang supaya jelas berbeda dari ruang periksa
    const ubin = kanvas(340, 540);
    ubin.ctx.fillStyle = '#e4e0d6';
    ubin.ctx.fillRect(0, 0, 340, 540);
    ubin.ctx.fillStyle = 'rgba(120,110,95,.22)';
    for (let i = 0; i <= 340; i += 40) ubin.ctx.fillRect(i, 0, 2, 540);
    for (let j = 0; j <= 540; j += 40) ubin.ctx.fillRect(0, j, 340, 2);
    const lantaiTunggu = new THREE.Mesh(new THREE.PlaneGeometry(170, 270), new THREE.MeshLambertMaterial({ map: ubin.tekstur }));
    lantaiTunggu.rotation.x = -Math.PI / 2;
    lantaiTunggu.position.set(-85, 0, 135);
    lantaiTunggu.receiveShadow = true;
    adegan.add(lantaiTunggu);
  }
  // Rumput & jalan setapak di luar pintu
  kotak(488, -2, -8, 620, -0.2, 290, '#a7c98a');
  kotak(488, -2, 154, 620, 0.2, 190, '#d6c39b');
  kotak(490, 0, 156, 520, 0.8, 188, '#a08060');                 // keset

  // Dinding belakang + plint, dinding samping rendah (ruangan "dipotong" seperti diorama)
  kotak(-178, 0, -10, 488, 112, 0, '#d8c6a0');
  kotak(-178, 0, 0, 480, 8, 1.5, '#8a6f52');
  kotak(-178, 0, 0, -170, 16, 200, '#cdb892');         // dinding kiri ruang tunggu, celah koridor di z 200–256
  kotak(-178, 0, 256, -170, 16, 270, '#cdb892');
  kotak(-4, 0, 0, 4, 16, 148, '#cdb892');               // sekat ruang tunggu | ruang periksa
  kotak(-4, 0, 197, 4, 16, 270, '#cdb892');
  kotak(480, 0, 0, 488, 16, 148, '#cdb892');
  kotak(480, 0, 197, 488, 16, 270, '#cdb892');

  /** Kusen + daun pintu dengan engsel di (x, 150); `buka` = sudut daun saat terbuka (ke dalam ruang periksa). */
  function buatPintu(x, buka) {
    kotak(x - 5, 0, 145, x + 5, 80, 150, '#7d5a39');
    kotak(x - 5, 0, 195, x + 5, 80, 200, '#7d5a39');
    kotak(x - 5, 75, 145, x + 5, 82, 200, '#7d5a39');
    const engsel = new THREE.Group();
    engsel.position.set(x, 0, 150);
    adegan.add(engsel);
    kotak(-2, 0, 0.5, 2, 74, 44.5, '#8a6f52', engsel);
    kotak(-2.6, 2, 3, 2.6, 72, 5, '#7a5f44', engsel);
    kotak(-3.5, 34, 37, 3.5, 38, 41, '#e0c060', engsel);
    return { engsel, x, buka, sudut: 0, target: 0 };
  }
  const pintuKeluar = buatPintu(484, -1.5);
  const pintuMasuk = buatPintu(0, 1.5);

  // Ruang tunggu: kursi, layar antrean, poster, tanaman
  for (const { x, z } of KURSI_TUNGGU) {
    kotak(x - 11, 12, z - 9, x + 11, 15, z + 7, '#4a7bd0');          // dudukan
    kotak(x - 11, 15, z - 12, x + 11, 34, z - 9, '#4a7bd0');         // sandaran
    for (const dx of [-9, 7]) kotak(x + dx, 0, z - 8, x + dx + 2, 12, z + 6, '#8a8d96');
  }
  kotak(-152, 46, 0, -48, 98, 3, '#2b2d33');                          // bingkai layar antrean
  const antreanKanvas = kanvas(400, 192);
  panel(-100, 72, 3.1, 98, 47, antreanKanvas.tekstur, true);
  kotak(-36, 52, 0, -12, 84, 1.5, '#f0e2c0');                         // poster "Tertib antre"
  kotak(-33, 74, 1.5, -15, 78, 1.8, '#c26a12');
  kotak(-33, 66, 1.5, -18, 68, 1.8, '#9a8a70');
  kotak(-33, 61, 1.5, -21, 63, 1.8, '#9a8a70');
  kotak(-230, -2, 200, -176, -0.2, 256, '#d6c39b');                   // lantai koridor

  // Jendela
  const kaca = new THREE.MeshBasicMaterial({ color: '#b9e0f8' });
  for (const [x1, x2] of [[185, 275], [300, 360]]) {
    kotak(x1 - 3, 52, 0, x2 + 3, 100, 2, '#8a6f52');
    kotak(x1, 55, 0, x2, 97, 2.6, kaca);
    kotak((x1 + x2) / 2 - 1, 55, 0, (x1 + x2) / 2 + 1, 97, 3.2, '#8a6f52');
  }

  // Jam dinding (jarum mengikuti jam sungguhan)
  const jamDinding = new THREE.Group();
  jamDinding.position.set(378, 86, 1.5);
  adegan.add(jamDinding);
  {
    const bingkai = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 10.5, 2, 24), lambert('#6b5a45'));
    const muka = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 2.6, 24), lambert('#ffffff'));
    for (const m of [bingkai, muka]) { m.rotation.x = Math.PI / 2; jamDinding.add(m); }
  }
  const jarum = (panjang, tebal, warna) => {
    const poros = new THREE.Group();
    poros.position.z = 1.6;
    kotak(-tebal / 2, 0, 0, tebal / 2, panjang, 0.6, warna, poros);
    jamDinding.add(poros);
    return poros;
  };
  const jarumJam = jarum(5, 1.4, '#333333');
  const jarumMenit = jarum(7.5, 1, '#555555');

  // Papan "sudah lulus" (isinya digambar di kanvas)
  kotak(12, 18, 0, 168, 98, 3, '#6b6b6b');
  kotak(14, 15, 0, 166, 18, 7, '#9a9a9a');
  const papanKanvas = kanvas(600, 300);
  panel(90, 58, 3.1, 150, 75, papanKanvas.tekstur);

  // Meja pemeriksa, monitor, kopi, baki surat
  kotak(172, 26, 66, 288, 30, 104, '#a0764e');
  for (const [x, z] of [[176, 70], [280, 70], [176, 96], [280, 96]]) kotak(x, 0, z, x + 4, 26, z + 4, '#7d5a39');
  kotak(226, 30, 76, 234, 36, 82, '#2b2f3a');
  kotak(196, 34, 70, 264, 72, 76, '#2b2f3a');
  const layarKanvas = kanvas(256, 136);
  panel(230, 53, 76.1, 62, 33, layarKanvas.tekstur, true);
  kotak(212, 30, 86, 248, 31.5, 95, '#3a3d45');
  silinder(272, 30, 92, 3.4, 37, '#6b3a1a');
  silinder(272, 37, 92, 2.8, 37.3, '#3a1d0a');
  kotak(178, 30, 82, 196, 37, 96, '#c94f4f');
  kotak(180, 37, 84, 194, 38, 94, '#f4f4f4');

  // Kursi kantor Pemeriksa (dipakai animasi "ketik" yang duduk)
  const kursi = new THREE.Group();
  kursi.position.set(258, 0, 130);
  adegan.add(kursi);
  kotak(-10, 13, -9, 10, 16, 9, '#3a3d45', kursi);            // dudukan
  kotak(-10, 16, 8, 10, 29, 11, '#3a3d45', kursi);            // sandaran rendah: punggung Pemeriksa tetap terlihat
  kotak(-1.5, 3, -1.5, 1.5, 13, 1.5, '#8a8d96', kursi);       // tiang
  kotak(-9, 1, -1, 9, 3, 1, '#2b2d33', kursi);                // kaki silang
  kotak(-1, 1, -9, 1, 3, 9, '#2b2d33', kursi);
  // ukuran di atas pas untuk Pemeriksa setinggi 54; ikut membesar bersama karakternya
  kursi.scale.setScalar(TINGGI_MIXAMO / 54);
  // Saat berdiri, kursi digeser ke samping kiri (bukan ke belakang, yang akan menutupi Pemeriksa dari kamera)
  const KURSI_GESER = -20 * TINGGI_MIXAMO / 54;
  let kursiX = KURSI_GESER;

  // Karpet di depan meja
  kotak(150, 0, 140, 330, 0.4, 192, '#c97a4a');
  kotak(156, 0.4, 146, 324, 0.6, 186, '#d99a6a');

  // Server: rak, enam LED (menyala sesuai jumlah siswa lulus), cahaya biru saat memeriksa
  kotak(395, 0, 6, 455, 108, 46, '#3b3e46');
  const led = [];
  for (let i = 0; i < 6; i++) {
    const y = 90 - i * 14;
    kotak(402, y - 5, 46, 448, y + 5, 47, '#2b2d33');
    const m = new THREE.Mesh(geomKotak, new THREE.MeshBasicMaterial({ color: '#5a5d66' }));
    m.scale.set(5, 4, 1);
    m.position.set(409, y, 47.4);
    adegan.add(m);
    led.push(m);
  }
  {
    const { ctx, tekstur } = kanvas(128, 32);
    ctx.fillStyle = '#2b2d33'; ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = '#c8ccd6'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SERVER', 64, 17);
    panel(425, 102, 46.2, 40, 10, tekstur, true);
  }
  const garisServer = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(66, 114, 46)),
    new THREE.LineBasicMaterial({ color: '#4f8cff', transparent: true, opacity: 0 }),
  );
  garisServer.position.set(425, 54, 26);
  adegan.add(garisServer);
  const lampuServer = new THREE.PointLight('#4f8cff', 0, 170, 0);
  lampuServer.position.set(425, 60, 72);
  adegan.add(lampuServer);
  let nyalaLed = 0;
  let serverSibuk = false;

  // Meja kecil QA dengan buku & kopi
  kotak(416, 20, 222, 464, 23, 246, '#a0764e');
  for (const [x, z] of [[418, 224], [459, 224], [418, 241], [459, 241]]) kotak(x, 0, z, x + 3, 20, z + 3, '#7d5a39');
  kotak(422, 23, 228, 438, 26, 240, '#4a7bd0');
  kotak(429.5, 23, 228, 430.5, 26.2, 240, '#2f5fb3');
  silinder(452, 23, 234, 3, 29, '#6b3a1a');

  // Tanaman pot di pojok ruang tunggu (diam; tidak ada angin di dalam ruangan)
  kotak(-164, 0, 18, -140, 14, 42, '#a0764e');
  for (const [x, y, z, w] of [[22, 14, 234, '#6aa84f'], [30, 14, 236, '#5a9440'], [24, 22, 238, '#7cbb5c'],
    [32, 22, 232, '#6aa84f'], [26, 30, 234, '#5a9440'], [20, 22, 242, '#5a9440'], [30, 30, 242, '#7cbb5c'], [27, 38, 238, '#6aa84f']]) {
    kotak(x - 181, y, z - 211, x - 171, y + 9, z - 201, w);
  }

  // Meja Developer: monitor kode (kanvas) & kursi, di bawah jendela kanan
  kotak(296, 26, 22, 358, 30, 46, '#a0764e');
  for (const [x, z] of [[298, 24], [352, 24], [298, 40], [352, 40]]) kotak(x, 0, z, x + 4, 26, z + 4, '#7d5a39');
  kotak(322, 30, 30, 330, 35, 35, '#2b2f3a');
  kotak(302, 34, 26, 350, 62, 31, '#2b2f3a');
  const layarDevKanvas = kanvas(256, 136);
  panel(326, 48, 31.1, 44, 24, layarDevKanvas.tekstur, true);
  kotak(310, 30, 36, 342, 31.5, 43, '#3a3d45');                       // keyboard
  const kursiDev = new THREE.Group();
  kursiDev.position.set(TEMPAT.mejaDev.x, 0, TEMPAT.mejaDev.z);
  adegan.add(kursiDev);
  kotak(-10, 12, -9, 10, 15, 9, '#3a3d45', kursiDev);
  kotak(-10, 15, 8, 10, 27, 11, '#3a3d45', kursiDev);
  kotak(-1.5, 3, -1.5, 1.5, 12, 1.5, '#8a8d96', kursiDev);
  kotak(-9, 1, -1, 9, 3, 1, '#2b2d33', kursiDev);
  kotak(-1, 1, -9, 1, 3, 9, '#2b2d33', kursiDev);

  // Terminal di samping rak server: tempat kartu kode dimasukkan
  kotak(368, 0, 26, 392, 38, 42, '#4a4d56');
  kotak(371, 30, 42, 389, 32, 43, '#1d1f24');                         // celah kartu
  kotak(368, 38, 30, 392, 58, 35, '#2b2f3a');
  const terminalKanvas = kanvas(192, 128);
  panel(380, 48, 35.1, 20, 14, terminalKanvas.tekstur, true);

  // Kursi tamu di ujung kiri meja Pemeriksa (murid duduk menghadap Pemeriksa)
  const kursiTamu = new THREE.Group();
  kursiTamu.position.set(TEMPAT.kursiTamu.x, 0, TEMPAT.kursiTamu.z);
  kursiTamu.rotation.y = 0.9;
  adegan.add(kursiTamu);
  kotak(-11, 12, -9, 11, 15, 7, '#c26a12', kursiTamu);
  kotak(-11, 15, -12, 11, 32, -9, '#c26a12', kursiTamu);
  for (const dx of [-9, 7]) kotak(dx, 0, -8, dx + 2, 12, 6, '#7d5a39', kursiTamu);

  // Kipas angin berdiri di pojok depan ruang periksa
  kotak(14, 0, 238, 30, 2, 254, '#3a3d45');
  kotak(21, 2, 245, 23, 44, 247, '#8a8d96');
  const kipas = new THREE.Group();
  kipas.position.set(22, 48, 246);
  kipas.rotation.y = 0.7;                       // menghadap ke tengah ruangan
  adegan.add(kipas);
  kotak(-4, -4, -6, 4, 4, 0, '#3a3d45', kipas);
  const baling = new THREE.Group();
  baling.position.z = 1;
  kipas.add(baling);
  for (let i = 0; i < 3; i++) {
    const daun = new THREE.Group();
    daun.rotation.z = (i * Math.PI * 2) / 3;
    kotak(-2.5, 1, -0.4, 2.5, 10, 0.4, '#c8d8f0', daun);
    baling.add(daun);
  }

  // -------------------------------------------------------------------
  // Lapisan HTML (teks di atas kanvas)
  // -------------------------------------------------------------------
  const elemen = (kelas) => {
    const e = document.createElement('div');
    e.className = kelas;
    lapisan.append(e);
    return e;
  };
  let lebarLapisan = 1, tinggiLapisan = 1;
  const titik = new THREE.Vector3();

  /** Letakkan elemen HTML di atas titik dunia (x,y,z); `jepit` menjaga elemen tetap di dalam kanvas. */
  function letakkan(e, x, y, z, jepit = false) {
    titik.set(x, y, z).project(kamera);
    let px = (titik.x + 1) / 2 * lebarLapisan;
    const py = (1 - titik.y) / 2 * tinggiLapisan;
    if (jepit) {
      const separuh = e.offsetWidth / 2 + 4;
      px = Math.min(Math.max(px, separuh), lebarLapisan - separuh);
    }
    e.style.left = `${px.toFixed(1)}px`;
    e.style.top = `${py.toFixed(1)}px`;
  }

  /** Efek HTML sesaat di titik dunia, dihapus setelah `ms`. */
  function efekLayar(kelas, x, y, z, ms, teks = '') {
    const e = elemen(kelas);
    e.textContent = teks;
    letakkan(e, x, y, z);
    setTimeout(() => e.remove(), ms);
    return e;
  }

  function ukurUlang() {
    const w = akar.clientWidth, h = akar.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    kamera.aspect = w / h;
    kamera.updateProjectionMatrix();
    lebarLapisan = w; tinggiLapisan = h;
    lapisan.style.fontSize = `${(w / 560 * 7).toFixed(2)}px`;
  }
  new ResizeObserver(ukurUlang).observe(akar);

  // -------------------------------------------------------------------
  // Karakter voxel
  // -------------------------------------------------------------------
  const geomVoxel = new THREE.BoxGeometry(V, V, V);
  const bahanVoxel = new THREE.MeshLambertMaterial();
  const m4 = new THREE.Matrix4();
  const semua = new Set();

  function buatKarakter({ nama, baju, celana = '#2f3a55', rambut = 'pendek', H = '#3b2a1a', S = '#f2c9a0', mulai, warnaLabel = '#2b2f3a', arah = 0 }) {
    const grup = new THREE.Group();
    const badan = new THREE.Group();
    const voxel = new THREE.InstancedMesh(geomVoxel, bahanVoxel, 12 * 16 * TEBAL);
    voxel.castShadow = voxel.receiveShadow = true;
    voxel.frustumCulled = false;
    badan.add(voxel);
    grup.add(badan);
    adegan.add(grup);
    const label = elemen('nama');
    label.style.background = warnaLabel;
    const k = {
      grup, badan, voxel, label, ikonEl: elemen('ikon'), gelembung: elemen('gelembung'), tempelan: new Set(),
      pos: { ...mulai }, rute: [], selesai: null, arah, arahTarget: arah, waktuFrame: 0,
      frame: 'diam', ekspresi: 'normal', kedip: false, rambut, lompat: 0, napas: Math.random() * 6, squash: 0,
      warna: Object.fromEntries(Object.entries({ H, S, E: '#1d1d1d', M: '#a94f4a', B: baju, P: celana, K: '#4a3020', T: '#6ab0ff' })
        .map(([h, w]) => [h, new THREE.Color(w)])),
    };
    // Setiap piksel sprite menjadi TEBAL voxel: lapisan depan berwarna asli, bagian dalam
    // memakai warna dasar, dan bagian belakang kepala diberi rambut.
    k.gambar = () => {
      let n = 0;
      baris(k).forEach((teks, y) => [...teks].forEach((h, x) => {
        if (h === '.') return;
        for (let d = 0; d < TEBAL; d++) {
          const huruf = d === 0 ? h : d === TEBAL - 1 && y < 6 ? 'H' : DASAR[h] ?? h;
          voxel.setMatrixAt(n, m4.makeTranslation((x - 5.5) * V, (15 - y) * V + V / 2, ((TEBAL - 1) / 2 - d) * V));
          voxel.setColorAt(n, k.warna[huruf]);
          n++;
        }
      }));
      voxel.count = n;
      voxel.instanceMatrix.needsUpdate = true;
      voxel.instanceColor.needsUpdate = true;
    };
    k.setFrame = (f) => { if (k.frame !== f) { k.frame = f; k.gambar(); } };
    k.setEkspresi = (e) => {
      if (k.ekspresi !== e) { k.ekspresi = e; k.gambar(); k.squash = 0.15; }
    };
    k.ikon = (n) => {
      clearTimeout(k.timerIkon);
      k.ikonEl.replaceChildren();
      if (!n) return;
      // IKON berisi markup SVG statis milik aplikasi (bukan input pengguna)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '-20 -22 40 40');
      svg.innerHTML = IKON[n];
      k.ikonEl.append(svg);
    };
    k.setNama = (teks) => {
      const pendek = teks && teks.length > 16 ? teks.slice(0, 15) + '…' : teks || '';
      label.textContent = pendek;
      label.hidden = !pendek;
    };
    k.hapus = () => {
      k.dihapus = true;
      clearInterval(k.timerKedip);
      clearTimeout(k.timerIkon);
      k.rig?.mixer.stopAllAction();
      semua.delete(k);
      adegan.remove(grup);
      voxel.dispose();
      // bahan warna salinan milik murid ini (geometri model dipakai bersama, tidak dibuang)
      k.rig?.tubuh.traverse((c) => {
        if (!c.isMesh) return;
        for (const b of [c.material].flat()) if (b.userData.salinan) b.dispose();
      });
      for (const e of [label, k.ikonEl, k.gelembung, ...k.tempelan]) e.remove();
    };
    k.setNama(nama);
    k.timerKedip = setInterval(() => {
      k.kedip = true; k.gambar();
      setTimeout(() => { k.kedip = false; k.gambar(); }, 140);
    }, 2600 + Math.random() * 2400);
    k.gambar();
    semua.add(k);
    return k;
  }

  // -------------------------------------------------------------------
  // Minifig LEGO (dipakai Pemeriksa): part LDraw yang tidak digabung, sehingga kaki,
  // lengan (beserta tangan), dan kepala bisa digerakkan sendiri-sendiri.
  // -------------------------------------------------------------------
  async function pasangMinifig(k, url) {
    const [{ LDrawLoader }, { LDrawConditionalLineMaterial }] = await Promise.all([
      import('/vendor/three-addons/loaders/LDrawLoader.js'),
      import('/vendor/three-addons/materials/LDrawConditionalLineMaterial.js'),
    ]);
    const model = await new LDrawLoader().setConditionalLineMaterial(LDrawConditionalLineMaterial).loadAsync(url);
    model.traverse((c) => {
      if (c.isLineSegments) c.visible = false;
      if (c.isMesh) c.castShadow = c.receiveShadow = true;
    });
    const part = (nama) => model.children.filter((c) => c.name.endsWith(nama));
    const [lenganKanan] = part('3818.dat'), [lenganKiri] = part('3819.dat');
    const [kakiKanan] = part('3816.dat'), [kakiKiri] = part('3817.dat'), [kepala] = part('3626bp01.dat');
    if (!lenganKanan || !lenganKiri || !kakiKanan || !kakiKiri || !kepala) throw new Error('Part minifig tidak lengkap');
    model.updateMatrixWorld(true);
    const tangan = part('3820.dat');      // diambil sebelum dipindah menjadi anak lengan
    for (const t of tangan) (t.position.x < 0 ? lenganKanan : lenganKiri).attach(t);

    // Koordinat LDraw: y ke bawah dan wajah ke -z → putar 180° di sumbu X, skala ke tinggi ±50
    const tubuh = new THREE.Group();
    model.rotation.x = Math.PI;
    tubuh.add(model);
    tubuh.scale.setScalar(0.5);
    tubuh.updateMatrixWorld(true);
    tubuh.position.y = -new THREE.Box3().setFromObject(tubuh).min.y;

    const sendi = [lenganKanan, lenganKiri, kakiKanan, kakiKiri, kepala].map((o) => ({ o, dasar: o.quaternion.clone(), sudut: 0 }));
    k.badan.remove(k.voxel);
    k.voxel.dispose();
    k.badan.add(tubuh);
    k.gambar = () => {};          // tidak ada sprite lagi; pose diatur oleh poseMinifig()
    k.minifig = { sendi, langkah: 0, tubuh, kepalaLego: kepala, tangan };
  }

  // Ekspresi kantor → bobot blendshape ARKit milik facecap ('bicara' digerakkan oleh ucap(),
  // yang berganti antara 'bicara' dan ekspresi dasar tiap 3 huruf → mulut membuka-menutup).
  const BLENDSHAPE = {
    normal: {},
    senyum: { mouthSmile_L: 0.85, mouthSmile_R: 0.85, cheekSquint_L: 0.45, cheekSquint_R: 0.45, eyeSquint_L: 0.25, eyeSquint_R: 0.25, mouthDimple_L: 0.3, mouthDimple_R: 0.3 },
    sedih: { mouthFrown_L: 0.9, mouthFrown_R: 0.9, browInnerUp: 0.9, browDown_L: 0.15, browDown_R: 0.15, eyeLookDown_L: 0.35, eyeLookDown_R: 0.35, mouthShrugLower: 0.4 },
    kaget: { jawOpen: 0.45, eyeWide_L: 1, eyeWide_R: 1, browInnerUp: 0.8, browOuterUp_L: 0.9, browOuterUp_R: 0.9, mouthFunnel: 0.35 },
    bicara: { jawOpen: 0.4, mouthFunnel: 0.2, mouthSmile_L: 0.15, mouthSmile_R: 0.15 },
  };
  const WARNA_KULIT = '#e8b48f';     // dikalikan dengan tekstur abu-abu facecap
  const WARNA_TANGAN = '#c8916c';    // tangan polos dibuat sedikit lebih gelap supaya sewarna dengan kepala

  /**
   * Ganti kepala LEGO minifig dengan kepala manusia facecap (Face Cap, bannaflak.com) yang punya
   * 52 blendshape, lalu warnai tangan dengan warna kulit. Gagal → kepala LEGO tetap dipakai.
   */
  async function pasangKepalaManusia(k, url) {
    const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
      import('/vendor/three-addons/loaders/GLTFLoader.js'),
      import('/vendor/three-addons/loaders/KTX2Loader.js'),
      import('/vendor/three-addons/libs/meshopt_decoder.module.js'),
    ]);
    const ktx2 = new KTX2Loader().setTranscoderPath('/vendor/three-addons/libs/basis/').detectSupport(renderer);
    const gltf = await new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    const akarKepala = gltf.scene;
    const wajah = akarKepala.getObjectByName('mesh_2');
    if (!wajah?.morphTargetDictionary) throw new Error('Mesh kepala facecap tidak ditemukan');
    akarKepala.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    // kepala, mata, dan gigi berbagi satu material; hanya kulit kepala yang diwarnai
    wajah.material = wajah.material.clone();
    wajah.material.color.set(WARNA_KULIT);

    // Ukur dari titik dasar (Box3.setFromObject ikut menghitung morph target → terlalu besar).
    // Tinggi kepala ±16 satuan dunia = 32 satuan lokal `tubuh` (skala 0.5); dagu di leher (asal torso).
    akarKepala.updateMatrixWorld(true);
    const kotak = new THREE.Box3();
    const pos = wajah.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) kotak.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(wajah.matrixWorld));
    const s = 32 / (kotak.max.y - kotak.min.y);
    const tengah = kotak.getCenter(new THREE.Vector3()).multiplyScalar(s);
    akarKepala.scale.setScalar(s);
    akarKepala.position.set(-tengah.x, -kotak.min.y * s, -tengah.z);
    const leher = new THREE.Group();
    leher.position.y = 1;
    leher.add(akarKepala);

    const m = k.minifig;
    m.kepalaLego.visible = false;
    m.tubuh.add(leher);
    m.sendi[4] = { o: leher, dasar: new THREE.Quaternion(), sudut: 0 };
    for (const t of m.tangan) {
      t.traverse((c) => {
        if (!c.isMesh) return;
        const warnai = (b) => { const baru = b.clone(); baru.color.set(WARNA_TANGAN); return baru; };
        c.material = Array.isArray(c.material) ? c.material.map(warnai) : warnai(c.material);
      });
    }
    const bobot = {};
    for (const nama of Object.keys(wajah.morphTargetDictionary)) bobot[nama] = 0;
    m.wajah = { mesh: wajah, bobot };
  }

  /** Blendshape wajah per frame, dihaluskan; kedip memakai k.kedip yang sudah ada. */
  function ekspresiWajah(k, dt) {
    const { mesh, bobot } = k.minifig.wajah;
    const target = BLENDSHAPE[k.ekspresi] || BLENDSHAPE.normal;
    for (const nama in bobot) {
      let t = target[nama] ?? 0;
      if (k.kedip && nama.startsWith('eyeBlink')) t = 1;
      const laju = nama.startsWith('eyeBlink') ? 40 : nama === 'jawOpen' || nama === 'mouthFunnel' ? 25 : 8;
      bobot[nama] += (t - bobot[nama]) * Math.min(1, dt * laju);
      mesh.morphTargetInfluences[mesh.morphTargetDictionary[nama]] = bobot[nama];
    }
  }

  const sumbuX = new THREE.Vector3(1, 0, 0);
  const qSementara = new THREE.Quaternion();

  /**
   * Pose minifig per frame. Sudut di sumbu X lokal part LDraw: negatif = mengayun ke depan
   * (lengan -2.6 ≈ terangkat ke atas kepala), positif pada kepala = menunduk.
   */
  function poseMinifig(k, dt, berjalan) {
    const m = k.minifig;
    const [lKa, lKi, kKa, kKi, kpl] = m.sendi;
    let lenganKa = 0, lenganKi = 0, kakiKa = 0, kakiKi = 0, kepala = 0;
    if (berjalan) {
      m.langkah += dt * 9;
      const ayun = Math.sin(m.langkah);
      kakiKa = ayun * 0.6; kakiKi = -ayun * 0.6;
      lenganKa = -ayun * 0.5; lenganKi = ayun * 0.5;
    } else {
      m.langkah = 0;
      const napas = Math.sin(k.napas * 1.6) * 0.05;
      lenganKa = napas; lenganKi = -napas;
    }
    if (k.ekspresi === 'bicara') { lenganKa = -0.5; kepala = Math.sin(k.napas * 14) * 0.06; }
    if (k.ekspresi === 'kaget') { lenganKa = lenganKi = -1.3; kepala = -0.15; }
    if (k.ekspresi === 'sedih') kepala = 0.3;
    if (k.ekspresi === 'senyum' && !berjalan) lenganKa = -0.35;
    if (k.lompat > 0) { lenganKa = lenganKi = -2.6; kakiKa = kakiKi = 0; }
    const target = [lenganKa, lenganKi, kakiKa, kakiKi, kepala];
    m.sendi.forEach((s, i) => {
      s.sudut += (target[i] - s.sudut) * Math.min(1, dt * (berjalan ? 20 : 10));
      s.o.quaternion.copy(s.dasar).multiply(qSementara.setFromAxisAngle(sumbuX, s.sudut));
    });
  }

  // -------------------------------------------------------------------
  // Karakter glTF bertulang (Pemeriksa Mixamo, QA & siswa Quaternius).
  // Tiap keadaan (diam, jalan, bicara, ...) dipetakan ke satu klip animasi. Keadaan tanpa klip
  // memakai klip "diam" ditambah lapisan pose ringan (kepala menunduk, tangan bergerak), atau —
  // bila "diam" pun tidak ada — pose prosedural penuh dari pose-T.
  // -------------------------------------------------------------------
  // Nama tulang kanonik (gaya Mixamo) → nama tulang di tiap jenis rangka
  const TULANG_KANONIK = ['Hips', 'Spine', 'Spine1', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];
  const RANGKA = {
    mixamo: Object.fromEntries(TULANG_KANONIK.map((n) => [n, n])),
    // GLTFLoader membuang titik dari nama node ("UpperArm.L" → "UpperArmL")
    quaternius: {
      Hips: 'Hips', Spine: 'Abdomen', Spine1: 'Chest', Neck: 'Neck', Head: 'Head',
      LeftArm: 'UpperArmL', RightArm: 'UpperArmR', LeftForeArm: 'LowerArmL', RightForeArm: 'LowerArmR',
      LeftUpLeg: 'UpperLegL', RightUpLeg: 'UpperLegR', LeftLeg: 'LowerLegL', RightLeg: 'LowerLegR',
    },
  };
  // Klip bawaan karakter Quaternius (Ultimate Modular Men) untuk tiap keadaan kantor
  const KLIP_QUATERNIUS = { diam: 'Idle', jalan: 'Walk', kaget: 'HitRecieve', sorak: 'Wave', ketuk: 'Interact', serah: 'Interact', periksa: 'Interact' };
  const sumbu = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  let pemuatGltf = null;
  async function muatGltf(url) {
    if (!pemuatGltf) {
      const { GLTFLoader } = await import('/vendor/three-addons/loaders/GLTFLoader.js');
      pemuatGltf = new GLTFLoader();
    }
    return pemuatGltf.loadAsync(url);
  }

  /** Buang perpindahan horizontal akar (posisi karakter diatur oleh kantor, bukan oleh klip). */
  function diTempat(klip, namaHips) {
    for (const t of klip.tracks) {
      // Mixamo: Hips; Quaternius: Body (atau Root)
      if (![`${namaHips}.position`, 'Root.position', 'Body.position'].includes(t.name)) continue;
      for (let i = 0; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 2] = t.values[2]; }
    }
    return klip;
  }

  /**
   * Ganti tubuh karakter `k` dengan `model` (Object3D bertulang). `klip`: { slot: AnimationClip }.
   * Sinkron, supaya siswa yang modelnya sudah dimuat bisa langsung dipasang.
   */
  function pasangModel(k, model, { klip = {}, rangka = 'mixamo', tinggi }) {
    model.traverse((c) => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; c.frustumCulled = false; } });
    // Arah istirahat tiap tulang (relatif akar model) disimpan untuk lapisan pose & pose prosedural.
    // Tulang dicari menurut nama; bila ada salinan (FBXLoader), yang terluar yang dipakai.
    model.updateMatrixWorld(true);
    const tulang = {};
    for (const [kanonik, nama] of Object.entries(RANGKA[rangka])) {
      const o = model.getObjectByName(nama);
      if (!o) throw new Error(`Tulang ${nama} tidak ada`);
      const dunia = o.getWorldQuaternion(new THREE.Quaternion());
      tulang[kanonik] = { o, lokal: o.quaternion.clone(), dunia, duniaInv: dunia.clone().invert() };
    }
    const kotakModel = new THREE.Box3().setFromObject(model);
    const tinggiAsli = kotakModel.getSize(new THREE.Vector3()).y;
    const skala = tinggi / tinggiAsli;
    // Untuk pose duduk: tinggi pangkal paha & lutut di atas lantai (satuan dunia)
    const yDunia = (t) => (t.o.getWorldPosition(new THREE.Vector3()).y - kotakModel.min.y) * skala;
    const tinggiPaha = yDunia(tulang.LeftUpLeg), tinggiLutut = yDunia(tulang.LeftLeg);
    const tubuh = new THREE.Group();
    tubuh.add(model);
    tubuh.scale.setScalar(skala);

    const mixer = new THREE.AnimationMixer(model);
    const aksi = {};
    for (const [slot, c] of Object.entries(klip)) if (c) aksi[slot] = mixer.clipAction(c);

    if (k.minifig) k.badan.remove(k.minifig.tubuh);
    else if (k.voxel.parent) { k.badan.remove(k.voxel); k.voxel.dispose(); }
    if (k.rig) { k.rig.mixer.stopAllAction(); k.badan.remove(k.rig.tubuh); }
    k.minifig = null;
    k.badan.add(tubuh);
    k.gambar = () => {};
    k.rig = { tubuh, tulang, mixer, aksi, slot: null, sudut: {}, lapis: {}, langkah: 0, tinggiPaha, tinggiLutut };
    k.tinggi = tinggi;
  }

  /** Pemeriksa: model + klip terpisah di /model/pemeriksa (animasi.json: { "jalan": "jalan.glb", ... }). */
  async function pasangPemeriksaMixamo(k, folder) {
    const gltf = await muatGltf(`${folder}/model.glb`);
    const klip = {};
    let daftar = {};
    try { daftar = await (await fetch(`${folder}/animasi.json`)).json(); } catch { /* belum ada daftar */ }
    await Promise.all(Object.entries(daftar).map(async ([slot, berkas]) => {
      try {
        klip[slot] = diTempat((await muatGltf(`${folder}/${berkas}`)).animations[0], 'Hips');
      } catch (err) {
        console.warn(`Animasi ${slot} (${berkas}) gagal dimuat:`, err);
      }
    }));
    pasangModel(k, gltf.scene, { klip, rangka: 'mixamo', tinggi: TINGGI_MIXAMO });
  }

  /** Klip bawaan glTF Quaternius → { slot: klip }. */
  const klipQuaternius = (gltf) => Object.fromEntries(Object.entries(KLIP_QUATERNIUS)
    .map(([slot, nama]) => [slot, gltf.animations.find((a) => a.name === nama)])
    .filter(([, c]) => c)
    .map(([slot, c]) => [slot, diTempat(c, 'Hips')]));

  /** Putar tulang dengan rotasi di ruang model (pada pose istirahat), menggantikan pose tulang. */
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
  function deltaTulang(t, rotasi) {
    qA.identity();
    for (const [s, a] of rotasi) if (a) qA.premultiply(qB.setFromAxisAngle(sumbu[s], a));
    // delta lokal = duniaIstirahat⁻¹ · rotasiDunia · duniaIstirahat
    return qA.premultiply(t.duniaInv).multiply(t.dunia);
  }
  const putarTulang = (t, rotasi) => t.o.quaternion.copy(t.lokal).multiply(deltaTulang(t, rotasi));
  /** Sama, tetapi ditumpuk di atas pose dari klip yang sedang berjalan. */
  const tambahTulang = (t, rotasi) => t.o.quaternion.multiply(deltaTulang(t, rotasi));

  /** Gerakan sesaat dari adegan (mis. 'ketuk' di pintu, 'serah' kertas) selama `detik`. */
  function gerakSesaat(k, slot, detik) {
    if (k.rig) k.rig.sesaat = { slot, sampai: performance.now() / 1000 + detik };
  }

  /** Keadaan karakter saat ini → nama slot animasi. */
  function slotKarakter(k, berjalan) {
    // ucap() berganti 'bicara' ↔ ekspresi dasar tiap 3 huruf; tahan slot bicara 0,6 dtk agar klip tidak berganti-ganti
    const kini = performance.now() / 1000, m = k.rig;
    if (k.ekspresi === 'bicara') m.bicaraSampai = kini + 0.6;
    if (k.lompat > 0) return 'sorak';
    if (berjalan) return 'jalan';
    if (m.sesaat && kini < m.sesaat.sampai) return m.sesaat.slot;
    if (k.ekspresi === 'kaget') return 'kaget';
    if (k.ekspresi === 'sedih') return 'sedih';
    if (k.aktivitas === 'telepon' && m.aksi.telepon) return 'telepon';   // menelepon sambil bicara
    if (kini < (m.bicaraSampai ?? 0)) return 'bicara';
    if (k.aktivitas) return k.aktivitas;      // 'ketik' di meja, 'pikir' di server
    return 'diam';
  }

  function poseRig(k, dt, berjalan) {
    const m = k.rig;
    const keadaan = slotKarakter(k, berjalan);
    // tanpa klip untuk keadaan ini → pakai "diam" + lapisan pose
    const slot = m.aksi[keadaan] ? keadaan : m.aksi.diam && keadaan !== 'jalan' ? 'diam' : keadaan;
    const aksiBaru = m.aksi[slot];
    if (aksiBaru) {
      if (m.slot !== slot) {
        const lama = m.aksi[m.slot];
        aksiBaru.reset().setEffectiveWeight(1).fadeIn(0.25).play();
        if (lama) lama.fadeOut(0.25);
        m.slot = slot;
      }
      m.mixer.update(dt);
      lapisanPose(k, dt, slot === keadaan ? null : keadaan);
      return;
    }
    if (m.slot) { m.mixer.stopAllAction(); m.slot = null; }
    poseProsedural(k, dt, keadaan);
  }

  /**
   * Gerak ringan di atas klip "diam" untuk keadaan tanpa klip sendiri (dihaluskan supaya tidak menyentak).
   * `k.toleh` (−1..1) memutar kepala ke kiri/kanan karakter tanpa memutar badan — dipakai murid yang duduk.
   */
  function lapisanPose(k, dt, keadaan) {
    const m = k.rig, T = m.tulang;
    const t = { kepala: 0, punggung: 0, lenganKa: 0, siku: 0, lenganKi: 0, sikuKi: 0, lenganKedua: 0, toleh: (k.toleh ?? 0) * 0.7 };
    const getar = Math.sin(k.napas * 18) * 0.12;
    if (keadaan === 'bicara') { t.lenganKa = -0.45; t.siku = 0.5 + Math.sin(k.napas * 9) * 0.25; t.kepala = Math.sin(k.napas * 14) * 0.05; }
    if (keadaan === 'sedih') { t.kepala = 0.4; t.punggung = 0.15; }
    if (keadaan === 'kaget') { t.lenganKedua = -0.8; t.kepala = -0.12; }
    if (keadaan === 'pikir' || keadaan === 'baca') t.kepala = 0.22;
    if (keadaan === 'baca') { t.lenganKa = t.lenganKi = -0.7; t.siku = t.sikuKi = 0.9; }
    // mengetik (di laptop pangkuan, keyboard, atau terminal): dua lengan ke depan, jari bergantian
    if (keadaan === 'ketik') { t.kepala = 0.22; t.lenganKa = -0.6 + getar; t.lenganKi = -0.6 - getar; t.siku = t.sikuKi = 1.0; }
    if (keadaan === 'jempol') { t.lenganKa = -1.3; t.siku = 1.2; t.kepala = -0.08; }
    if (keadaan === 'tunjuk') { t.lenganKa = -1.25; t.siku = 0.1; }
    if (keadaan === 'angkat') { t.lenganKa = -2.7; t.siku = 0.2; }
    if (keadaan === 'regang') { t.lenganKa = t.lenganKi = -2.8; t.punggung = -0.1; }
    if (keadaan === 'angguk') t.kepala = 0.12 + Math.sin(k.napas * 11) * 0.22;
    for (const [n, v] of Object.entries(t)) m.lapis[n] = (m.lapis[n] ?? 0) + (v - (m.lapis[n] ?? 0)) * Math.min(1, dt * 10);
    const s = m.lapis;
    if (Math.abs(s.kepala) > 1e-3 || Math.abs(s.toleh) > 1e-3) tambahTulang(T.Head, [['y', s.toleh], ['x', s.kepala]]);
    if (Math.abs(s.punggung) > 1e-3) tambahTulang(T.Spine1, [['x', s.punggung]]);
    if (Math.abs(s.lenganKa) > 1e-3 || Math.abs(s.lenganKedua) > 1e-3) tambahTulang(T.RightArm, [['x', s.lenganKa + s.lenganKedua]]);
    if (Math.abs(s.lenganKi) > 1e-3 || Math.abs(s.lenganKedua) > 1e-3) tambahTulang(T.LeftArm, [['x', s.lenganKi + s.lenganKedua]]);
    if (Math.abs(s.siku) > 1e-3) tambahTulang(T.RightForeArm, [['x', -s.siku]]);
    if (Math.abs(s.sikuKi) > 1e-3) tambahTulang(T.LeftForeArm, [['x', -s.sikuKi]]);
  }

  /**
   * Pose duduk prosedural (klip Quaternius tidak punya klip duduk): paha diputar ke depan, lutut
   * ditekuk, badan diturunkan setinggi paha. `k.duduk` 0..1 dihaluskan supaya bangkit/duduk terlihat.
   * Mengembalikan seberapa jauh badan diturunkan.
   */
  function poseDuduk(k, dt) {
    const m = k.rig;
    k.dudukKini = (k.dudukKini ?? 0) + ((k.duduk ? 1 : 0) - (k.dudukKini ?? 0)) * Math.min(1, dt * 5);
    const d = k.dudukKini;
    if (d < 0.01) return 0;
    const T = m.tulang;
    const goyang = k.goyangKaki ? Math.sin(k.napas * 12) * 0.18 : 0;
    putarTulang(T.LeftUpLeg, [['x', -1.45 * d]]);
    putarTulang(T.RightUpLeg, [['x', -1.45 * d]]);
    putarTulang(T.LeftLeg, [['x', (1.45 + goyang) * d]]);
    putarTulang(T.RightLeg, [['x', (1.45 - goyang) * d]]);
    return (m.tinggiPaha - m.tinggiLutut) * 0.92 * d;
  }

  /**
   * Pose cadangan tanpa klip: sudut di ruang model (wajah ke +z, kiri karakter = +x).
   * Lengan turun dari pose-T: putar di sumbu Z; ayun depan/belakang: sumbu X (negatif = ke depan).
   */
  function poseProsedural(k, dt, slot) {
    const m = k.rig, T = m.tulang;
    let ayun = 0, lKiZ = -1.2, lKaZ = 1.2, lKiX = 0, lKaX = 0, siku = 0.15, sikuKa = 0.15, kepala = 0, punggung = 0;
    if (slot === 'jalan') {
      m.langkah += dt * 8;
      ayun = Math.sin(m.langkah);
      lKiX = ayun * 0.45; lKaX = -ayun * 0.45;
    } else {
      lKiZ -= Math.sin(k.napas * 1.6) * 0.03; lKaZ += Math.sin(k.napas * 1.6) * 0.03;
    }
    if (slot === 'bicara') { lKaX = -0.7; sikuKa = 1.1; kepala = Math.sin(k.napas * 14) * 0.05; }
    if (slot === 'kaget') { lKiX = lKaX = -1.3; siku = sikuKa = 0.9; kepala = -0.12; }
    if (slot === 'sedih') { kepala = 0.4; punggung = 0.15; }
    if (slot === 'ketik' || slot === 'pikir') { lKiX = lKaX = -0.55; siku = sikuKa = 1.25; kepala = 0.15; }
    if (slot === 'sorak') { lKiZ = 1.1; lKaZ = -1.1; }

    const target = { ayun, lKiZ, lKaZ, lKiX, lKaX, siku, sikuKa, kepala, punggung };
    for (const [n, v] of Object.entries(target)) m.sudut[n] = (m.sudut[n] ?? v) + (v - (m.sudut[n] ?? v)) * Math.min(1, dt * (slot === 'jalan' ? 20 : 10));
    const s = m.sudut;
    putarTulang(T.LeftArm, [['z', s.lKiZ], ['x', s.lKiX]]);
    putarTulang(T.RightArm, [['z', s.lKaZ], ['x', s.lKaX]]);
    // siku: lengan bawah ditekuk ke depan (dinyatakan pada pose-T: putar di sumbu Y)
    putarTulang(T.LeftForeArm, [['y', -s.siku]]);
    putarTulang(T.RightForeArm, [['y', s.sikuKa]]);
    putarTulang(T.LeftUpLeg, [['x', -s.ayun * 0.5]]);
    putarTulang(T.RightUpLeg, [['x', s.ayun * 0.5]]);
    putarTulang(T.LeftLeg, [['x', Math.max(0, s.ayun) * 0.6]]);
    putarTulang(T.RightLeg, [['x', Math.max(0, -s.ayun) * 0.6]]);
    putarTulang(T.Head, [['x', s.kepala]]);
    putarTulang(T.Spine1, [['x', s.punggung]]);
  }

  // Sapaan untuk Pemeriksa; berubah ke "Ibu/Bu" bila karakter Ch07 (perempuan) yang terpasang.
  const sapaan = { Bapak: 'Bapak', Pak: 'Pak' };
  const sebut = (teks) => teks.replace(/\b(Bapak|Pak)\b/g, (s) => sapaan[s]);

  const pemeriksa = buatKarakter({ nama: 'Pemeriksa', baju: '#4a7bd0', rambut: 'rapi', mulai: TEMPAT.meja, warnaLabel: '#2f5fb3', arah: ARAH_MEJA });
  // Urutan cadangan: karakter Mixamo → minifig (+ kepala facecap) → voxel.
  const atribusi = elemen('atribusi');
  const kreditPemeriksa = { teks: '' };
  const aturAtribusi = () => { atribusi.textContent = [kreditPemeriksa.teks, siapQuaternius.berhasil ? 'QA & siswa: Quaternius (CC0)' : ''].filter(Boolean).join(' · '); };
  pasangPemeriksaMixamo(pemeriksa, '/model/pemeriksa')
    .then(() => {
      Object.assign(sapaan, { Bapak: 'Ibu', Pak: 'Bu' });
      kreditPemeriksa.teks = 'Pemeriksa: karakter Mixamo (Adobe)';
      aturAtribusi();
    })
    .catch((err) => {
      console.warn('Karakter Mixamo gagal dimuat, memakai minifig:', err);
      return pasangMinifig(pemeriksa, '/model/minifig-pemeriksa.mpd')
        .then(async () => {
          atribusi.textContent = 'Minifig: LDraw Parts Library (CCAL 2.0)';
          try {
            await pasangKepalaManusia(pemeriksa, '/model/facecap.glb');
            atribusi.textContent += ' · Kepala: Face Cap (bannaflak.com)';
          } catch (e) {
            console.warn('Kepala facecap gagal dimuat, memakai kepala LEGO:', e);
          }
        })
        .catch((e) => console.warn('Minifig Pemeriksa gagal dimuat, memakai voxel:', e));
    });
  const qa = buatKarakter({ nama: 'QA', baju: '#8e5bd0', rambut: 'jambul', H: '#1d1d1d', mulai: TEMPAT.pojokQA, warnaLabel: '#6a3fb0' });
  const developer = buatKarakter({ nama: 'Developer', baju: '#2f6b4f', rambut: 'pendek', H: '#141414', mulai: TEMPAT.mejaDev, warnaLabel: '#2a7a55', arah: ARAH_MEJA });
  developer.duduk = true;
  let siswa = null;

  // QA (Worker) dan dua model siswa dari Quaternius Ultimate Modular Men (CC0). Model siswa dimuat
  // sekali lalu digandakan (SkeletonUtils.clone) untuk tiap kiriman; Developer memakai model hoodie
  // dengan warna tetap. Gagal → tetap voxel.
  const TINGGI_QA = 58, TINGGI_SISWA = 52, TINGGI_DEV = 56;
  const siapQuaternius = (async () => {
    const [{ clone }, gltfQa, ...gltfSiswa] = await Promise.all([
      import('/vendor/three-addons/utils/SkeletonUtils.js'),
      muatGltf('/model/qa/model.glb'),
      muatGltf('/model/siswa/casual.glb'),
      muatGltf('/model/siswa/hoodie.glb'),
    ]);
    pasangModel(qa, gltfQa.scene, { klip: klipQuaternius(gltfQa), rangka: 'quaternius', tinggi: TINGGI_QA });
    siapQuaternius.berhasil = true;
    aturAtribusi();
    // Bahan yang diwarnai ulang per siswa: baju & celana berbeda nama di tiap model
    const varian = [
      // Casual_2: LightBrown = kaos, LightBlue = celana (Red_Dark = sepatu, dibiarkan)
      { gltf: gltfSiswa[0], baju: ['LightBrown'], celana: ['LightBlue'] },
      { gltf: gltfSiswa[1], baju: ['Purple'], celana: ['LightBlue'] },
    ];
    const q = { clone, varian: varian.map((v) => ({ ...v, klip: klipQuaternius(v.gltf) })) };
    // Developer: hoodie hijau tua, celana gelap, rambut hitam
    pasangModel(developer, warnaiModel(q.clone(q.varian[1].gltf.scene), new Map([
      ['Skin', '#d9a47c'], ['Skin_Darker', new THREE.Color('#d9a47c').multiplyScalar(0.8)], ['Hair', '#141414'], ['Eyebrows', '#141414'],
      ['Purple', '#2f6b4f'], ['LightBlue', '#2b2f3a'],
    ])), { klip: q.varian[1].klip, rangka: 'quaternius', tinggi: TINGGI_DEV });
    return q;
  })();
  siapQuaternius.catch((err) => console.warn('Karakter Quaternius gagal dimuat, QA & siswa memakai voxel:', err));

  /** Ganti warna bahan bernama (Skin, Hair, …) pada salinan model; bahan dikloning supaya model lain tidak ikut berubah. */
  function warnaiModel(model, warna) {
    model.traverse((c) => {
      if (!c.isMesh) return;
      const ganti = (b) => {
        if (!warna.has(b.name)) return b;
        const baru = b.clone();
        baru.color.set(warna.get(b.name));
        baru.userData.salinan = true;      // dibuang bersama karakternya (k.hapus)
        return baru;
      };
      c.material = Array.isArray(c.material) ? c.material.map(ganti) : ganti(c.material);
    });
    return model;
  }

  const KULIT = ['#f1c9a5', '#e0ac82', '#c68e63', '#a8714d', '#8a5a3c'];
  const RAMBUT = ['#1d1612', '#2b1d12', '#3b2a1a', '#4a2f1f', '#141414'];
  const BAJU = ['#2f6fd6', '#d64545', '#2a9d6a', '#e0a020', '#7b4bc4', '#e06aa0', '#1f8fa8', '#f4f4f4', '#3a3d45'];
  const CELANA = ['#2f3a55', '#4a4f5a', '#1f2a44', '#5b4636', '#3a3a3a'];

  /** Penampilan 3D siswa dari namanya (siswa yang sama selalu terlihat sama). */
  function penampilan3D(nama) {
    let h = 2166136261;
    for (const c of nama) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const pilih = (daftar) => daftar[(h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0) % daftar.length];
    return { varian: h % 2, kulit: pilih(KULIT), rambut: pilih(RAMBUT), baju: pilih(BAJU), celana: pilih(CELANA) };
  }

  /** Ganti siswa voxel dengan model Quaternius berwarna sesuai namanya (bila model sudah siap). */
  async function pasangSiswa3D(k, nama) {
    const q = await siapQuaternius;
    if (k.dihapus) return;
    const p = penampilan3D(nama);
    const v = q.varian[p.varian];
    const model = warnaiModel(q.clone(v.gltf.scene), new Map([
      ['Skin', p.kulit], ['Skin_Darker', new THREE.Color(p.kulit).multiplyScalar(0.8)],
      ['Hair', p.rambut], ['Eyebrows', p.rambut],
      ...v.baju.map((n) => [n, p.baju]), ...v.celana.map((n) => [n, p.celana]),
    ]));
    pasangModel(k, model, { klip: v.klip, rangka: 'quaternius', tinggi: TINGGI_SISWA });
  }

  /** Murid baru (voxel dulu, model 3D menyusul bila siap). */
  function buatMurid(nama, mulai, arah = 0) {
    const tampil = penampilan(nama);
    const k = buatKarakter({ nama, baju: '#f4f4f4', celana: '#6b6f78', rambut: tampil.rambut, H: tampil.H, S: tampil.S, mulai, warnaLabel: '#c26a12', arah });
    pasangSiswa3D(k, nama).catch((err) => console.warn('Model siswa gagal dipasang, memakai voxel:', err));
    return k;
  }

  // -------------------------------------------------------------------
  // Benda adegan: map proyek (map kuning berisi kartu kode biru), laptop, catatan
  // -------------------------------------------------------------------
  const bendaDibawa = new Set();
  const kartuKanvas = kanvas(64, 40);
  kartuKanvas.ctx.fillStyle = '#4f8cff';
  kartuKanvas.ctx.fillRect(0, 0, 64, 40);
  kartuKanvas.ctx.fillStyle = '#ffffff';
  kartuKanvas.ctx.font = 'bold 22px monospace';
  kartuKanvas.ctx.textAlign = 'center';
  kartuKanvas.ctx.textBaseline = 'middle';
  kartuKanvas.ctx.fillText('</>', 32, 21);
  const bahanKartu = new THREE.MeshBasicMaterial({ map: kartuKanvas.tekstur, toneMapped: false });

  /** Benda kecil (Group) yang bisa dibawa karakter, diletakkan, atau diterbangkan ke titik lain. */
  function buatBenda(jenis) {
    const g = new THREE.Group();
    if (jenis === 'map') {
      kotak(-6, -8, -0.6, 6, 8, 0.6, '#f2c14e', g);
      kotak(-6, 6, -0.7, -1, 9, 0.7, '#e0a830', g);                          // tab map
      const kartu = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.6), bahanKartu);
      kartu.position.set(0, 1, 0.75);
      g.add(kartu);
    } else if (jenis === 'kartu') {
      kotak(-4.5, -2.8, -0.3, 4.5, 2.8, 0.3, '#2f5fb3', g);
      const muka = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 5.4), bahanKartu);
      muka.position.z = 0.35;
      g.add(muka);
    } else if (jenis === 'laptop') {
      kotak(-7, 0, -5, 7, 1, 5, '#8a8d96', g);
      const tutup = new THREE.Group();
      tutup.position.set(0, 1, -5);
      tutup.rotation.x = -0.35;
      kotak(-7, 0, -0.5, 7, 9, 0.5, '#8a8d96', tutup);
      kotak(-6, 1, 0.5, 6, 8, 0.7, '#9fd0ff', tutup);
      g.add(tutup);
    } else if (jenis === 'catatan') {
      kotak(-4, -4, -0.2, 4, 4, 0.2, '#ffe58a', g);
    }
    g.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    g.rotation.order = 'YXZ';      // miring (x) dihitung setelah arah hadap (y) → map bisa tergeletak datar di meja
    adegan.add(g);
    const b = { m: g, oleh: null, jenis };
    bendaDibawa.add(b);
    return b;
  }

  function buangBenda(b) {
    if (!b) return;
    bendaDibawa.delete(b);
    adegan.remove(b.m);
    // muka kartu (PlaneGeometry) dibuat per benda; kotak memakai geomKotak bersama
    b.m.traverse((c) => { if (c.isMesh && c.geometry !== geomKotak) c.geometry.dispose(); });
  }

  /** Benda dipegang `k` (mengikuti tangannya); opsi: maju, tinggi, miring. */
  function pegang(b, k, opsi = {}) {
    Object.assign(b, { oleh: k, maju: 10, tinggi: 27, miring: 0 }, opsi);
  }

  /** Terbangkan benda ke titik (x, y, z) dalam lengkung pendek; benda lalu diam di sana. */
  function terbangkan(b, x, y, z, { detik = 0.6, miring = 0 } = {}) {
    const a = b.m.position.clone(), tujuan = new THREE.Vector3(x, y, z);
    const puncak = a.clone().lerp(tujuan, 0.5).setY(Math.max(a.y, y) + 18);
    const r0 = b.m.rotation.x;
    b.oleh = null;
    let t = 0;
    return new Promise((selesai) => {
      animasi.add((dt) => {
        t = Math.min(1, t + dt / detik);
        const u = 1 - t;
        b.m.position.set(
          u * u * a.x + 2 * u * t * puncak.x + t * t * tujuan.x,
          u * u * a.y + 2 * u * t * puncak.y + t * t * tujuan.y,
          u * u * a.z + 2 * u * t * puncak.z + t * t * tujuan.z,
        );
        b.m.rotation.x = r0 + (miring - r0) * t;
        if (t < 1) return true;
        selesai();
        return false;
      });
    });
  }
  /** Titik tangan karakter `k` (untuk serah-terima). */
  const tangan = (k, maju = 10, tinggi = 27) => [k.pos.x + Math.sin(k.arah) * maju, tinggi - (k.dudukKini ?? 0) * 9, k.pos.z + Math.cos(k.arah) * maju];
  /** Serahkan benda dari pegangan siapa pun ke tangan `ke`. */
  async function serahkan(b, ke, opsi) {
    await terbangkan(b, ...tangan(ke));
    pegang(b, ke, opsi);
  }

  // -------------------------------------------------------------------
  // Partikel (debu langkah, konfeti) & animasi sesaat
  // -------------------------------------------------------------------
  const partikel = new Set();
  const animasi = new Set();     // fungsi(dt) → false bila selesai

  function tambahPartikel(warna, ukuran, posisi, kecepatan, umur, { gravitasi = 0, susut = false, putar = 0 } = {}) {
    const m = new THREE.Mesh(geomKotak, lambert(warna));
    m.scale.set(...ukuran);
    m.position.copy(posisi);
    adegan.add(m);
    partikel.add({ m, v: kecepatan, umur, umur0: umur, gravitasi, susut, putar, skala: [...ukuran] });
  }

  function debuLangkah(x, z) {
    for (let i = 0; i < 4; i++) {
      const u = 1 + Math.random() * 1.5;
      tambahPartikel('#c4b89a', [u, u, u], new THREE.Vector3(x + (Math.random() - 0.5) * 14, 1, z + (Math.random() - 0.5) * 6),
        new THREE.Vector3((Math.random() - 0.5) * 8, 14 + Math.random() * 10, (Math.random() - 0.5) * 6), 0.35 + Math.random() * 0.25, { susut: true });
    }
  }

  function konfeti(x, z) {
    const warna = ['#ff6b6b', '#ffd166', '#4be38a', '#4f8cff', '#e3cdfa', '#ff9f43'];
    for (let i = 0; i < 30; i++) {
      const sudut = (Math.PI * 2 * i) / 30 + Math.random() * 0.3;
      const laju = 40 + Math.random() * 45;
      tambahPartikel(warna[i % warna.length], [3, 3, 0.8], new THREE.Vector3(x, 58, z),
        new THREE.Vector3(Math.cos(sudut) * laju, 70 + Math.random() * 50, Math.sin(sudut) * laju * 0.7),
        0.9 + Math.random() * 0.6, { gravitasi: 170, putar: 8 });
    }
  }

  function perbaruiPartikel(dt) {
    for (const p of partikel) {
      p.umur -= dt;
      if (p.umur <= 0 || p.m.position.y < -2) { adegan.remove(p.m); partikel.delete(p); continue; }
      p.v.y -= p.gravitasi * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.putar) { p.m.rotation.x += p.putar * dt; p.m.rotation.z += p.putar * 0.7 * dt; }
      if (p.susut) { const s = p.umur / p.umur0; p.m.scale.set(p.skala[0] * s, p.skala[1] * s, p.skala[2] * s); }
    }
  }

  // -------------------------------------------------------------------
  // Gerak: requestAnimationFrame + interpolasi
  // -------------------------------------------------------------------
  let terakhir = performance.now();
  let kedipKursorTerakhir = null, barisTerminalTerakhir = -1, halamanAntreanTerakhir = -1;
  let debuCooldown = 0;
  let dijeda = false;
  let waktu = 0;

  function tick(now) {
    const dt = Math.max(0, Math.min((now - terakhir) / 1000, 0.1));
    terakhir = now;
    waktu += dt;
    debuCooldown = Math.max(0, debuCooldown - dt);

    for (const k of semua) {
      let naik = 0;
      let sx = 1, sy = 1;
      if (k.rute.length) {
        const tj = k.rute[0], dx = tj.x - k.pos.x, dz = tj.z - k.pos.z, d = Math.hypot(dx, dz);
        if (d < 1) {
          k.rute.shift();
          if (!k.rute.length) { k.setFrame('diam'); const s = k.selesai; k.selesai = null; s && s(); }
        } else {
          const m = Math.min(KECEPATAN * dt, d);
          k.pos.x += dx / d * m; k.pos.z += dz / d * m;
          k.arahTarget = panggung(Math.atan2(dx, dz));
          k.waktuFrame += dt;
          if (k.waktuFrame > .22) {
            k.waktuFrame = 0;
            k.setFrame(k.frame === 'jalanA' ? 'jalanB' : 'jalanA');
            if (debuCooldown <= 0) { debuLangkah(k.pos.x, k.pos.z); debuCooldown = 0.15; }
          }
          naik = k.frame === 'jalanA' ? 1 : 0;
        }
      } else {
        k.napas += dt;
        naik = Math.sin(k.napas * 2.2) > 0.6 ? 1 : 0;
      }
      if (k.lompat > 0) {
        k.lompat = Math.max(0, k.lompat - dt);
        naik += Math.abs(Math.sin(k.lompat * Math.PI * 3)) * 12;
      }
      if (k.squash > 0) {
        k.squash = Math.max(0, k.squash - dt);
        const fase = Math.sin((k.squash / 0.15) * Math.PI * 1.5);
        sx = 1 + fase * 0.08;
        sy = 1 - fase * 0.08;
      }
      // berputar ke arah tujuan lewat sudut terpendek
      const beda = Math.atan2(Math.sin(k.arahTarget - k.arah), Math.cos(k.arahTarget - k.arah));
      k.arah += beda * Math.min(1, dt * 12);
      k.grup.position.set(k.pos.x, 0, k.pos.z);
      k.grup.rotation.y = k.arah;
      if (k.rig) {
        poseRig(k, dt, k.rute.length > 0);
        naik = (k.lompat > 0 ? naik : 0) - poseDuduk(k, dt);
      } else if (k.duduk) {
        naik = -10;     // voxel cadangan: cukup diturunkan ke dudukan
      }
      if (k.minifig) {
        poseMinifig(k, dt, k.rute.length > 0);
        if (k.minifig.wajah) ekspresiWajah(k, dt);
        naik = k.lompat > 0 ? naik : 0;   // minifig tidak "mengangguk" per frame jalan seperti sprite
      }
      k.badan.position.y = naik;
      k.badan.scale.set(sx, sy, sx);
      k.naik = naik;
    }

    for (const f of animasi) if (f(dt) === false) animasi.delete(f);
    perbaruiPartikel(dt);

    // Kursi maju hanya saat Pemeriksa (karakter Mixamo) duduk mengetik di mejanya
    const duduk = pemeriksa.rig?.slot === 'ketik' && Math.hypot(pemeriksa.pos.x - TEMPAT.meja.x, pemeriksa.pos.z - TEMPAT.meja.z) < 2;
    kursiX += ((duduk ? 0 : KURSI_GESER) - kursiX) * Math.min(1, dt * 8);
    kursi.position.x = TEMPAT.meja.x + kursiX;

    // Kursi Developer bergeser ke samping bila Developer tidak sedang duduk di sana
    const devDuduk = developer.duduk && Math.hypot(developer.pos.x - TEMPAT.mejaDev.x, developer.pos.z - TEMPAT.mejaDev.z) < 2;
    kursiDev.position.x += ((TEMPAT.mejaDev.x + (devDuduk ? 0 : -18)) - kursiDev.position.x) * Math.min(1, dt * 8);

    // Benda yang dibawa karakter (map, kartu, laptop) mengikuti tangan pemiliknya
    for (const b of bendaDibawa) {
      if (!b.oleh) continue;
      const k = b.oleh, duduk = k.dudukKini ?? 0;
      const maju = b.maju ?? 10, tinggi = (b.tinggi ?? 27) - duduk * 9;
      b.m.position.set(k.pos.x + Math.sin(k.arah) * maju, tinggi + (k.badan.position.y > 0 ? k.badan.position.y : 0), k.pos.z + Math.cos(k.arah) * maju);
      b.m.rotation.set(b.miring ?? 0, k.arah, 0);
    }

    // Pintu: perlambatan alami saat membuka & menutup
    for (const p of [pintuKeluar, pintuMasuk]) {
      p.sudut += (p.target - p.sudut) * Math.min(1, dt * 6);
      p.engsel.rotation.y = p.sudut;
    }

    // Kamera bergeser pelan ke fokus yang dipilih adegan
    const lajuKamera = Math.min(1, dt * 1.1);
    for (const n of ['x', 'z', 'jarak']) fokusKini[n] += (fokusTujuan[n] - fokusKini[n]) * lajuKamera;
    aturKamera();

    // Kipas berputar pelan; kursor monitor berkedip saat siaga
    baling.rotation.z += dt * 7;
    const kedipKursor = Math.floor(waktu * 2) % 2 === 0;
    if (kedipKursor !== kedipKursorTerakhir) {
      kedipKursorTerakhir = kedipKursor;
      if (!serverSibuk && !teksLayar) gambarLayar();
      if (!serverSibuk) gambarLayarDev();
    }
    const kini = new Date();
    jarumMenit.rotation.z = -(kini.getMinutes() + kini.getSeconds() / 60) / 60 * Math.PI * 2;
    jarumJam.rotation.z = -((kini.getHours() % 12) + kini.getMinutes() / 60) / 12 * Math.PI * 2;
    led.forEach((m, i) => {
      const terang = i < nyalaLed ? 0.65 + 0.35 * Math.cos(waktu * Math.PI * 2 / (0.6 + i * 0.17)) : 0;
      m.material.color.set(i < nyalaLed ? '#4be38a' : '#5a5d66').multiplyScalar(i < nyalaLed ? 0.4 + terang * 0.6 : 1);
    });
    if (serverSibuk) {
      const denyut = (Math.sin(waktu * Math.PI * 2 / 1.5) + 1) / 2;
      garisServer.material.opacity = 0.15 + denyut * 0.6;
      lampuServer.intensity = 0.4 + denyut * 1.6;
      gambarLayar((waktu % 2) / 2);
      if (Math.floor(waktu * 6) !== barisTerminalTerakhir) { barisTerminalTerakhir = Math.floor(waktu * 6); gambarTerminal(); }
    }
    // Layar antrean berganti informasi tiap 4 detik
    const halamanAntrean = Math.floor(waktu / 4) % 2;
    if (halamanAntrean !== halamanAntreanTerakhir) { halamanAntreanTerakhir = halamanAntrean; gambarAntrean(); }

    if (!dijeda) {
      renderer.render(adegan, kamera);
      for (const k of semua) {
        // teks mengikuti tinggi karakter (voxel 48, Pemeriksa Mixamo lebih tinggi)
        const { x, z } = k.pos, t = (k.tinggi ?? 48) + (k.naik || 0);
        letakkan(k.label, x, t + 6 + (k.labelNaik ?? 0) - (k.dudukKini ?? 0) * 12, z, true);
        letakkan(k.ikonEl, x + 10, t + 22, z);
        if (k.gelembung.firstChild) letakkan(k.gelembung, x, t + 32, z, true);
        for (const e of k.tempelan) letakkan(e, x, t + 44, z);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /**
   * Jalan ke satu tujuan atau melewati beberapa titik berurutan. Tiap titik = nama di TEMPAT atau {x, z}.
   * Jalur yang melewati perabot ditulis sebagai titik antara (lihat RUTE), bukan dicari otomatis.
   */
  function jalan(k, tujuan) {
    const titikRute = (Array.isArray(tujuan) ? tujuan : [tujuan]).map((t) => (typeof t === 'string' ? TEMPAT[t] : t));
    if (k.selesai) { const s = k.selesai; k.selesai = null; s(); }
    k.duduk = false;
    const akhir = titikRute[titikRute.length - 1];
    if (titikRute.length === 1 && Math.hypot(akhir.x - k.pos.x, akhir.z - k.pos.z) < 1) return Promise.resolve();
    k.rute = titikRute.map(({ x, z }) => ({ x, z }));
    return new Promise((r) => { k.selesai = r; });
  }
  // Jalur tetap supaya karakter tidak menembus meja, kursi, atau sekat
  const RUTE = {
    keKursiTamu: ['balikPintuMasuk', { x: 110, z: 150 }, 'kursiTamu'],
    keluar: [{ x: 168, z: 160 }, 'lorongKeluar', 'depanPintuKeluar', 'pintu'],
    devKePemeriksa: [{ x: 310, z: 100 }, 'sampingPemeriksa'],
    devKeTerminal: [{ x: 330, z: 104 }, 'terminal'],
    devKeMeja: [{ x: 350, z: 100 }, 'mejaDev'],
    qaKeServer: [{ x: 400, z: 150 }, 'sampingServer'],
    qaKeMurid: [{ x: 250, z: 175 }, 'sampingMurid'],
    qaPulang: [{ x: 300, z: 185 }, 'pojokQA'],
  };
  /** Rute dari kursi tunggu ke depan pintu masuk (turun dulu ke lorong, lalu ke pintu). */
  const ruteKePintuMasuk = (kursi) => [{ x: kursi.x, z: 120 }, 'lorongTunggu', 'depanPintuMasuk'];

  const hadap = (k, ke) => { k.arahTarget = panggung(Math.atan2(ke.pos.x - k.pos.x, ke.pos.z - k.pos.z)); };
  const hadapMeja = (k) => { k.arahTarget = ARAH_MEJA; };

  // -------------------------------------------------------------------
  // Gelembung bicara
  // -------------------------------------------------------------------
  let nomorUcap = 0;
  async function ucap(k, teks, { tahan = 1500, ekspresiAkhir } = {}) {
    const id = ++nomorUcap;
    k.ucapId = id;
    const barisTeks = pecah(sebut(teks));
    k.gelembung.className = 'gelembung';
    const teksEl = barisTeks.map((b) => {
      const e = document.createElement('div');
      e.style.minWidth = `${b.length}ch`;   // ukuran tetap selama huruf diketik
      return e;
    });
    k.gelembung.replaceChildren(...teksEl);
    const dasar = ekspresiAkhir || (k.ekspresi === 'bicara' ? 'normal' : k.ekspresi);
    let huruf = 0;
    const total = barisTeks.join('').length;
    while (huruf < total && k.ucapId === id) {
      huruf++;
      let sisa = huruf;
      barisTeks.forEach((b, i) => { teksEl[i].textContent = b.slice(0, Math.max(0, sisa)); sisa -= b.length; });
      if (huruf % 3 === 0) k.setEkspresi(k.ekspresi === 'bicara' ? dasar : 'bicara');
      await tunggu(KETIK_MS);
    }
    if (k.ucapId !== id) return;
    k.setEkspresi(dasar);
    await tunggu(tahan);
    if (k.ucapId === id) k.gelembung.replaceChildren();
  }

  function gelembungTetap(k, teks) {
    k.ucapId = ++nomorUcap;
    k.gelembung.className = 'gelembung tetap';
    k.gelembung.replaceChildren(...pecah(teks, 26).map((b) => Object.assign(document.createElement('div'), { textContent: b })));
  }

  // -------------------------------------------------------------------
  // Efek
  // -------------------------------------------------------------------
  function emoteBubble(k, emoji) {
    const e = elemen('emote');
    e.textContent = emoji;
    k.tempelan.add(e);
    setTimeout(() => { k.tempelan.delete(e); e.remove(); }, 1900);
  }

  function efekKetuk(p = pintuMasuk) {
    for (let i = 0; i < 3; i++) setTimeout(() => efekLayar('cincin', p.x - 5, 40, 172, 520), i * 180);
    efekLayar('tok', p.x - 8, 70, 172, 1000, 'TOK TOK');
    // daun pintu bergetar sedikit
    let t = 0;
    animasi.add((dt) => {
      t += dt;
      p.engsel.position.x = p.x + Math.sin(t * 60) * 0.6 * Math.max(0, 1 - t / 0.5);
      return t < 0.5;
    });
  }

  function efekLulus(k, skor) {
    const kilat = elemen('kilat');
    setTimeout(() => kilat.remove(), 450);
    const bintang = efekLayar('bintang', k.pos.x, 46, k.pos.z, 3700);
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.textContent = '★';
      s.style.setProperty('--sudut', `${i * 72}deg`);
      bintang.append(s);
    }
    if (typeof skor === 'number') efekLayar('skor', k.pos.x, 96, k.pos.z, 2100, `${skor}`);
  }

  function pintu(terbuka, p = pintuKeluar) {
    p.target = terbuka ? p.buka : 0;
  }

  function serverAktif(aktif) {
    serverSibuk = aktif;
    if (!aktif) {
      garisServer.material.opacity = 0;
      lampuServer.intensity = 0;
      gambarLayar();
    }
    gambarTerminal();
  }

  // -------------------------------------------------------------------
  // Sistem idle — aktivitas ringan saat tidak ada pemeriksaan
  // -------------------------------------------------------------------
  let sedangIdle = false;
  let idleBatal = false;
  let idleWakeup = null;
  let nomorObrolan = 0;

  const OBROLAN_IDLE = [
    ['Kopi lagi?', 'Boleh, makasih, Pak!'],
    ['Sudah ada yang kirim?', 'Belum, sabar ya.'],
    ['Servernya stabil?', 'Aman, semua hijau!'],
    ['Hari ini enak cuacanya.', 'Iya, adem.'],
    ['Sudah makan siang?', 'Nanti aja deh, hehe.'],
    ['Capek ya hari ini?', 'Lumayan sih, Pak.'],
    ['Semangat ya!', 'Siap, Pak!'],
    ['Mau cek server?', 'Baru dicek, aman kok.'],
    ['Masih segar kopinya?', 'Masih hangat!'],
    ['Proyek terakhir rapi ya.', 'Iya, bagus kodenya!'],
  ];
  const TEKS_LAYAR_IDLE = ['> _', '> idle', '> ready', '14:30', '> ...'];

  function tungguIdle(ms) {
    return new Promise((r) => {
      const t = setTimeout(r, ms);
      idleWakeup = () => { clearTimeout(t); r(); };
    });
  }

  function pilihBerbobot(daftar) {
    const total = daftar.reduce((s, d) => s + d.berat, 0);
    let r = Math.random() * total;
    for (const d of daftar) { r -= d.berat; if (r <= 0) return d.fn; }
    return daftar[0].fn;
  }

  async function idleDiam() {
    if (idleBatal) return;
    await tungguIdle(2000 + Math.random() * 3000);
  }

  // Aktivitas yang memakai klip animasi: hanya dipilih bila klipnya ada (lihat AKSI_IDLE),
  // dan berlangsung selama satu putaran klip (dibatasi supaya idle tidak macet di satu aksi).
  const punya = (k, slot) => !!k.rig?.aksi[slot];
  const durasiMs = (k, slot, cadangan) => Math.min(8000, (k.rig?.aksi[slot]?.getClip().duration ?? cadangan / 1000) * 1000);
  async function lakukan(k, slot, cadanganMs) {
    k.aktivitas = slot;
    await tungguIdle(durasiMs(k, slot, cadanganMs));
    if (k.aktivitas === slot) k.aktivitas = null;
  }
  /** Gerakan sesaat sepanjang satu putaran klip (mis. mengangguk) — mengalahkan animasi bicara. */
  const gerakPenuh = (k, slot, cadanganMs = 1500) => { if (punya(k, slot)) gerakSesaat(k, slot, durasiMs(k, slot, cadanganMs) / 1000); };

  async function idleMinumKopi() {
    if (idleBatal) return;
    pemeriksa.arahTarget = 0;
    pemeriksa.ikon('kopi');
    pemeriksa.setEkspresi('senyum');
    if (punya(pemeriksa, 'minum')) await lakukan(pemeriksa, 'minum', 1800);
    else await tungguIdle(1800);
    if (idleBatal) return;
    pemeriksa.ikon(null);
    pemeriksa.setEkspresi('normal');
    hadapMeja(pemeriksa);
  }

  async function idleRegangPemeriksa() {
    if (idleBatal) return;
    pemeriksa.arahTarget = 0;
    await lakukan(pemeriksa, 'regang', 3000);
    if (!idleBatal) hadapMeja(pemeriksa);
  }

  async function idleMenguap() {
    if (idleBatal) return;
    pemeriksa.arahTarget = 0;
    emoteBubble(pemeriksa, '🥱');
    await lakukan(pemeriksa, 'menguap', 3000);
    if (!idleBatal) hadapMeja(pemeriksa);
  }

  async function idleCekHP() {
    if (idleBatal) return;
    pemeriksa.arahTarget = 0.5;
    emoteBubble(pemeriksa, '📱');
    await lakukan(pemeriksa, 'hp', 4000);
    if (!idleBatal) hadapMeja(pemeriksa);
  }

  const TELEPON = ['Halo? Iya, nanti saya cek lagi.', 'Halo, iya Bu, servernya aman.', 'Oke, sampai ketemu di rapat.'];
  async function idleTelepon() {
    if (idleBatal) return;
    pemeriksa.arahTarget = 0.4;
    pemeriksa.aktivitas = 'telepon';      // 'telepon' tetap tampil walau sambil bicara
    await ucap(pemeriksa, TELEPON[Math.floor(Math.random() * TELEPON.length)], { tahan: 900 });
    if (!idleBatal) await tungguIdle(1500);
    if (pemeriksa.aktivitas === 'telepon') pemeriksa.aktivitas = null;
    if (!idleBatal) hadapMeja(pemeriksa);
  }

  async function idleQAKopi() {
    if (idleBatal) return;
    qa.ikon('kopi');
    qa.setEkspresi('senyum');
    await tungguIdle(1600);
    if (idleBatal) return;
    qa.ikon(null);
    qa.setEkspresi('normal');
  }

  async function idleMengobrol() {
    if (idleBatal) return;
    const [kataP, kataQ] = OBROLAN_IDLE[nomorObrolan++ % OBROLAN_IDLE.length];
    hadap(pemeriksa, qa);
    await ucap(pemeriksa, kataP, { tahan: 600 });
    if (idleBatal) return;
    hadap(qa, pemeriksa);
    // Pemeriksa menyimak (mengangguk setuju) selama QA menjawab, lalu kadang tertawa
    if (punya(pemeriksa, 'setuju')) pemeriksa.aktivitas = 'setuju';
    await ucap(qa, kataQ, { tahan: 600 });
    if (pemeriksa.aktivitas === 'setuju') pemeriksa.aktivitas = null;
    if (idleBatal) return;
    if (punya(pemeriksa, 'tertawa') && Math.random() < 0.4) {
      emoteBubble(pemeriksa, '😄');
      await lakukan(pemeriksa, 'tertawa', 2000);
      if (idleBatal) return;
    }
    pemeriksa.setEkspresi('normal');
    qa.setEkspresi('normal');
    hadapMeja(pemeriksa);
    qa.arahTarget = 0;
  }

  async function idleKetik() {
    if (idleBatal) return;
    hadapMeja(pemeriksa);
    pemeriksa.setEkspresi('normal');
    pemeriksa.aktivitas = 'ketik';
    for (let i = 0; i < 3; i++) {
      if (idleBatal) break;
      layar(TEKS_LAYAR_IDLE[Math.floor(Math.random() * TEKS_LAYAR_IDLE.length)]);
      await tungguIdle(700 + Math.random() * 500);
    }
    pemeriksa.aktivitas = null;
    if (!idleBatal) layar('');
  }

  async function idleQABaca() {
    if (idleBatal) return;
    qa.ikon('buku');
    qa.setEkspresi('normal');
    qa.aktivitas = 'baca';          // model 3D: menunduk membaca
    await tungguIdle(2500 + Math.random() * 1500);
    qa.aktivitas = null;
    if (idleBatal) return;
    qa.ikon(null);
  }

  async function idleLihatJam() {
    if (idleBatal) return;
    pemeriksa.arahTarget = Math.atan2(378 - pemeriksa.pos.x, 0 - pemeriksa.pos.z);
    if (punya(pemeriksa, 'lihat')) await lakukan(pemeriksa, 'lihat', 3000);
    if (idleBatal) return;
    await ucap(pemeriksa, 'Jam berapa ya…', { tahan: 800 });
    if (idleBatal) return;
    hadapMeja(pemeriksa);
  }

  async function idleRegangBadan() {
    if (idleBatal) return;
    qa.setEkspresi('senyum');
    qa.squash = 0.15;
    emoteBubble(qa, '💪');
    await tungguIdle(1200);
    if (idleBatal) return;
    qa.setEkspresi('normal');
  }

  // Developer: kerja di mejanya (mengetik paling sering), sesekali berpikir atau meregangkan bahu
  async function idleDevKetik() {
    if (idleBatal) return;
    developer.aktivitas = 'ketik';
    await tungguIdle(3000 + Math.random() * 3000);
    if (developer.aktivitas === 'ketik') developer.aktivitas = null;
  }

  async function idleDevPikir() {
    if (idleBatal) return;
    developer.aktivitas = 'pikir';
    developer.ikon('pikir');
    await tungguIdle(2500);
    developer.ikon(null);
    if (developer.aktivitas === 'pikir') developer.aktivitas = null;
  }

  async function idleDevRegang() {
    if (idleBatal) return;
    gerakSesaat(developer, 'regang', 1.8);
    await tungguIdle(2000);
  }

  const OBROLAN_DEV = [['Build-nya aman?', 'Aman, semua hijau.'], ['Lagi ngoding apa?', 'Rapikan skrip pemeriksa.'], ['Kopi?', 'Nanti dulu, tanggung!']];
  /** QA mampir ke meja Developer, mengobrol sebentar, lalu kembali ke pojoknya. */
  async function idleQACekDev() {
    if (idleBatal) return;
    await jalan(qa, RUTE.qaKeServer);
    if (idleBatal) return;
    hadap(qa, developer);
    developer.toleh = 0.5;
    const [tanya, jawab] = acak(OBROLAN_DEV);
    await ucap(qa, tanya, { tahan: 400 });
    if (idleBatal) return;
    await ucap(developer, jawab, { tahan: 400 });
    developer.toleh = 0;
    if (idleBatal) return;
    await jalan(qa, RUTE.qaPulang);
    if (!idleBatal) qa.arahTarget = 0;
  }

  const AKSI_IDLE = [
    { berat: 5, fn: idleDiam },
    { berat: 3, fn: idleDevKetik },
    { berat: 1, fn: idleDevPikir },
    { berat: 1, fn: idleDevRegang },
    { berat: 1, fn: idleQACekDev },
    { berat: 2, fn: idleMinumKopi },
    { berat: 2, fn: idleQAKopi },
    { berat: 2, fn: idleMengobrol },
    { berat: 1, fn: idleKetik },
    { berat: 1, fn: idleQABaca },
    { berat: 1, fn: idleLihatJam },
    { berat: 1, fn: idleRegangBadan },
    // butuh klip animasi Pemeriksa (Mixamo); tanpa klipnya tidak dipilih
    { berat: 1, fn: idleRegangPemeriksa, syarat: () => punya(pemeriksa, 'regang') },
    { berat: 1, fn: idleMenguap, syarat: () => punya(pemeriksa, 'menguap') },
    { berat: 1, fn: idleCekHP, syarat: () => punya(pemeriksa, 'hp') },
    { berat: 1, fn: idleTelepon, syarat: () => punya(pemeriksa, 'telepon') },
  ];

  async function mulaiIdle() {
    if (sedangIdle) return;
    sedangIdle = true;
    idleBatal = false;
    if (Math.hypot(pemeriksa.pos.x - TEMPAT.meja.x, pemeriksa.pos.z - TEMPAT.meja.z) > 2) await jalan(pemeriksa, 'meja');
    if (idleBatal) { sedangIdle = false; return; }
    hadapMeja(pemeriksa);
    if (Math.hypot(qa.pos.x - TEMPAT.pojokQA.x, qa.pos.z - TEMPAT.pojokQA.z) > 2) await jalan(qa, RUTE.qaPulang);
    if (idleBatal) { sedangIdle = false; return; }
    qa.arahTarget = 0;
    if (Math.hypot(developer.pos.x - TEMPAT.mejaDev.x, developer.pos.z - TEMPAT.mejaDev.z) > 2) await jalan(developer, RUTE.devKeMeja);
    if (idleBatal) { sedangIdle = false; return; }
    duduk(developer);
    while (!idleBatal) {
      await pilihBerbobot(AKSI_IDLE.filter((a) => !a.syarat || a.syarat()))();
      if (idleBatal) break;
      await tungguIdle(2500 + Math.random() * 3500);
    }
    sedangIdle = false;
  }

  function hentikanIdle() {
    idleBatal = true;
    if (idleWakeup) { idleWakeup(); idleWakeup = null; }
    pemeriksa.aktivitas = qa.aktivitas = developer.aktivitas = null;
    developer.toleh = 0;
    for (const k of [pemeriksa, qa, developer]) {
      k.rute = [];
      if (k.selesai) { const s = k.selesai; k.selesai = null; s(); }
      k.ucapId = ++nomorUcap;
      k.gelembung.replaceChildren();
      k.ikon(null);
      k.setEkspresi('normal');
      k.setFrame('diam');
    }
  }

  /** Tunggu sampai `syarat()` benar (diperiksa tiap 100 ms). */
  async function sampai(syarat, batasMs = 15000) {
    const akhir = Date.now() + batasMs;
    while (!syarat() && Date.now() < akhir) await tunggu(100);
  }
  const acak = (daftar) => daftar[Math.floor(Math.random() * daftar.length)];

  // -------------------------------------------------------------------
  // Ruang tunggu — murid yang antre duduk di kursi tunggu (maksimal 4 terlihat; jumlah
  // sebenarnya tampil di layar antrean). Gerak kecil mereka bergantian dengan jeda acak.
  // -------------------------------------------------------------------
  const muridTunggu = new Map();     // id kiriman → { id, nama, k, kursi, laptop }
  let daftarAntrean = [];             // [{ id, nama }] dari guru.js, urut antrean
  let dipanggil = null;               // { id, nama } yang sedang dipanggil / diperiksa
  let jumlahMenunggu = 0;

  /** Daftar murid yang menunggu (urut). Murid baru masuk lewat koridor, yang hilang dari daftar pergi. */
  function antrean(daftar) {
    daftarAntrean = daftar.map(({ id, nama }) => ({ id, nama }));
    const menunggu = daftarAntrean.filter((d) => d.id !== dipanggil?.id);
    jumlahMenunggu = menunggu.length;
    const tampilKursi = new Set(menunggu.slice(0, KURSI_TUNGGU.length).map((d) => d.id));
    for (const [id, m] of muridTunggu) if (!tampilKursi.has(id)) { muridTunggu.delete(id); muridPergi(m); }
    for (const d of menunggu.slice(0, KURSI_TUNGGU.length)) {
      if (muridTunggu.has(d.id)) continue;
      const kursi = KURSI_TUNGGU.findIndex((_, i) => ![...muridTunggu.values()].some((m) => m.kursi === i));
      if (kursi < 0) break;
      muridDatangTunggu(d, kursi);
    }
    gambarAntrean();
  }

  async function muridDatangTunggu(d, kursi) {
    const k = buatMurid(d.nama, TEMPAT.koridor, Math.PI / 2);
    // kursi tunggu berdempetan: cukup nama depan, label berselang-seling tinggi supaya tidak bertumpuk
    k.setNama(namaDepan(d.nama));
    k.labelNaik = kursi % 2 ? 9 : 0;
    const m = { ...d, k, kursi, laptop: buatBenda('laptop') };
    m.laptop.m.visible = false;
    muridTunggu.set(d.id, m);
    const K = KURSI_TUNGGU[kursi];
    await jalan(k, ['masukTunggu', { x: K.x, z: 120 }, K]);
    if (muridTunggu.get(d.id) !== m) return;
    k.arahTarget = 0;
    k.duduk = true;
    hidupTunggu(m);
  }

  async function muridPergi(m) {
    m.pergi = true;
    buangBenda(m.laptop);
    const K = KURSI_TUNGGU[m.kursi];
    m.k.aktivitas = null;
    m.k.toleh = 0;
    await jalan(m.k, [{ x: K.x, z: 120 }, 'masukTunggu', 'koridor']);
    m.k.hapus();
  }

  /** Arah menoleh (−1..1) dari kursi ke layar antrean di dinding belakang. */
  const tolehKeLayar = (m) => (KURSI_TUNGGU[m.kursi].x < -100 ? 1 : -1);
  const masihMenunggu = (m) => muridTunggu.get(m.id) === m && !m.dipanggil && !m.pergi;

  const OBROLAN_TUNGGU = [['Sudah dicek?', 'Belum, nunggu nih.'], ['Punyamu jalan?', 'Semoga, hehe.'], ['Deg-degan ya.', 'Iya, sama!']];
  /** Gerak kecil murid yang duduk menunggu, sampai ia dipanggil atau pergi. */
  async function hidupTunggu(m) {
    const k = m.k;
    while (masihMenunggu(m)) {
      await tunggu(4000 + Math.random() * 6000);
      if (!masihMenunggu(m)) break;
      const pilihan = acak(['ketik', 'ketik', 'baca', 'layar', 'kaki', 'ngobrol']);
      if (pilihan === 'ketik') {
        pegang(m.laptop, k, { maju: 9, tinggi: 26 });
        m.laptop.m.visible = true;
        k.aktivitas = 'ketik';
        await tunggu(2500 + Math.random() * 2500);
        k.aktivitas = null;
        m.laptop.m.visible = false;
      } else if (pilihan === 'baca') {
        k.aktivitas = 'baca';
        k.ikon('kertas');
        await tunggu(2500);
        k.aktivitas = null;
        k.ikon(null);
      } else if (pilihan === 'layar') {
        k.toleh = tolehKeLayar(m);
        await tunggu(1600);
        k.toleh = 0;
      } else if (pilihan === 'kaki') {
        k.goyangKaki = true;
        await tunggu(2200);
        k.goyangKaki = false;
      } else {
        // dua murid bersebelahan saling menoleh, bertukar kalimat pendek, lalu mengangguk
        const teman = [...muridTunggu.values()].find((t) => Math.abs(t.kursi - m.kursi) === 1 && masihMenunggu(t) && !t.k.aktivitas && !t.k.rute.length);
        if (!teman) continue;
        const kiri = KURSI_TUNGGU[teman.kursi].x > KURSI_TUNGGU[m.kursi].x ? 1 : -1;
        const [tanya, jawab] = acak(OBROLAN_TUNGGU);
        k.toleh = kiri; teman.k.toleh = -kiri;
        await ucap(k, tanya, { tahan: 400 });
        if (masihMenunggu(teman)) await ucap(teman.k, jawab, { tahan: 400 });
        gerakSesaat(k, 'angguk', 1.0);
        if (masihMenunggu(teman)) gerakSesaat(teman.k, 'angguk', 1.0);
        await tunggu(1000);
        k.toleh = 0;
        if (masihMenunggu(teman)) teman.k.toleh = 0;
      }
    }
    if (!m.dipanggil) m.k.aktivitas = null;
  }

  // -------------------------------------------------------------------
  // Adegan
  // -------------------------------------------------------------------
  const namaDepan = (n) => {
    const d = (n || '').trim().split(/\s+/)[0] || 'Nak';
    return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
  };

  let mapProyek = null, kartuKode = null, catatan = null;
  let janjiPulang = null;
  let lirikServer = null;

  /**
   * Murid dipanggil: menoleh ke layar, mengambil map, berdiri, berjalan ke pintu masuk, mengetuk;
   * Pemeriksa membukakan dan memberi jalan; murid masuk, duduk di kursi tamu, meletakkan map.
   * Murid berikutnya baru dipanggil setelah murid sebelumnya keluar (pintu & kursi tamu kosong).
   */
  async function datang(nama, id) {
    await janjiPulang;
    hentikanIdle();
    await tunggu(80);

    if (siswa) siswa.hapus();
    for (const b of [mapProyek, kartuKode, catatan]) buangBenda(b);
    mapProyek = kartuKode = catatan = null;
    qa.ikon(null);
    qa.gelembung.replaceChildren();
    qa.setEkspresi('normal');
    jalan(qa, 'pojokQA').then(() => { qa.arahTarget = 0; });
    duduk(developer);

    dipanggil = { id, nama };
    let m = id !== undefined ? muridTunggu.get(id) : null;
    if (m) { muridTunggu.delete(id); m.dipanggil = true; m.k.setNama(nama); m.k.labelNaik = 0; }
    antrean(daftarAntrean);          // kursi yang kosong boleh diisi murid berikutnya
    fokus('panggil');
    const k = siswa = m?.k ?? buatMurid(nama, TEMPAT.koridor, Math.PI / 2);
    mapProyek = buatBenda('map');

    // 1. Nomor muncul → murid menoleh ke layar, menutup laptop, mengambil map, berdiri
    if (m) {
      k.aktivitas = null;
      k.goyangKaki = false;
      k.toleh = tolehKeLayar(m);
      emoteBubble(k, '❗');
      await tunggu(900);
      k.toleh = 0;
      buangBenda(m.laptop);
      pegang(mapProyek, k);
      await tunggu(450);
      k.duduk = false;
      await tunggu(550);
      await jalan(k, ruteKePintuMasuk(KURSI_TUNGGU[m.kursi]));
    } else {
      // murid yang belum duduk (mis. kiriman ulang yang baru masuk) langsung dari koridor
      pegang(mapProyek, k);
      await jalan(k, ['masukTunggu', 'lorongTunggu', 'depanPintuMasuk']);
    }

    // 2. Mengetuk pintu masuk
    k.arahTarget = Math.PI / 2;
    gerakSesaat(k, 'ketuk', 1.2);
    efekKetuk(pintuMasuk);
    await tunggu(200);
    await ucap(k, 'Tok tok! Permisi, Pak.', { tahan: 500 });

    // 3. Pemeriksa menoleh ke pintu, lalu bangkit dan membukakan
    pemeriksa.aktivitas = null;
    pemeriksa.ikon('seru');
    pemeriksa.arahTarget = panggung(Math.atan2(0 - pemeriksa.pos.x, 172 - pemeriksa.pos.z));
    await tunggu(600);
    pemeriksa.ikon(null);
    await ucap(pemeriksa, 'Iya, silakan!', { tahan: 300 });
    await jalan(pemeriksa, [{ x: 150, z: 182 }, 'sambutPintuMasuk']);
    pemeriksa.arahTarget = -Math.PI / 2;
    pintu(true, pintuMasuk);
    await tunggu(500);
    // bergeser memberi jalan
    await jalan(pemeriksa, { x: 46, z: 236 });
    pemeriksa.arahTarget = panggung(-2.2);

    // 4. Murid mengangguk, masuk; pintu menutup setelah ia lewat
    gerakSesaat(k, 'angguk', 1.0);
    await tunggu(700);
    const masuk = jalan(k, RUTE.keKursiTamu);
    await sampai(() => k.pos.x > 50);
    pintu(false, pintuMasuk);
    const kembali = jalan(pemeriksa, [{ x: 170, z: 210 }, { x: 236, z: 168 }, 'meja']);
    await masuk;

    // 5. Duduk di kursi tamu, meletakkan map di meja
    k.arahTarget = 0.9;
    k.duduk = true;
    await tunggu(500);
    gerakSesaat(k, 'serah', 0.8);
    await terbangkan(mapProyek, 186, 31, 98, { miring: -Math.PI / 2 });
    await kembali;
    hadap(pemeriksa, k);
    await tunggu(150);
    await ucap(k, 'Ini proyek saya, Pak.', { tahan: 600 });
    await ucap(pemeriksa, `Baik, ${namaDepan(nama)}. Kita periksa, ya.`, { tahan: 500, ekspresiAkhir: 'senyum' });
  }

  /** Pemeriksa membuka map dan memanggil Developer; Developer membawa kartu kode ke terminal. */
  async function periksa() {
    pemeriksa.setEkspresi('normal');
    hadapMeja(pemeriksa);
    pemeriksa.aktivitas = 'baca';
    pemeriksa.ikon('kertas');
    await tunggu(900);
    pemeriksa.ikon(null);
    pemeriksa.aktivitas = null;
    pemeriksa.arahTarget = panggung(Math.atan2(developer.pos.x - pemeriksa.pos.x, developer.pos.z - pemeriksa.pos.z));
    const panggilDev = ucap(pemeriksa, 'Dev, tolong jalankan ini, ya!', { tahan: 300 });
    await tunggu(500);
    developer.aktivitas = null;
    developer.toleh = 0;
    await ucap(developer, 'Siap!', { tahan: 200 });
    await jalan(developer, RUTE.devKePemeriksa);
    await panggilDev;

    // Kartu kode diambil dari map
    developer.arahTarget = panggung(Math.atan2(186 - developer.pos.x, 98 - developer.pos.z));
    gerakSesaat(developer, 'serah', 0.8);
    kartuKode = buatBenda('kartu');
    kartuKode.m.position.set(186, 32, 98);
    await serahkan(kartuKode, developer);
    hadapMeja(pemeriksa);
    pemeriksa.aktivitas = 'ketik';          // Pemeriksa memantau monitornya
    if (siswa) emoteBubble(siswa, '🤞');

    // Ke terminal, kartu dimasukkan, layar menyala, Developer mengetik
    fokus('server');
    await jalan(developer, RUTE.devKeTerminal);
    hadapMeja(developer);
    gerakSesaat(developer, 'ketuk', 0.8);
    await terbangkan(kartuKode, 380, 33, 43, { detik: 0.4 });
    kartuKode.m.visible = false;
    teksTerminal = '';
    serverAktif(true);
    developer.aktivitas = 'ketik';
    gelembungTetap(developer, 'Menjalankan aplikasi…');
    // sesekali melirik lampu server (di kanannya)
    const id = Symbol('lirik');
    lirikServer = id;
    (async () => {
      while (lirikServer === id) {
        await tunggu(2200 + Math.random() * 1500);
        if (lirikServer !== id) break;
        developer.toleh = -0.8;
        await tunggu(900);
        if (lirikServer === id) developer.toleh = 0;
      }
    })();
  }

  function kabar(teks) {
    gelembungTetap(developer, teks.length > 52 ? teks.slice(0, 51) + '…' : teks);
  }

  /**
   * Hasil pemeriksaan → adegan. `h`: { lulus, bebas, skor, bug, saran, terhenti }.
   * `terhenti`: 'waktu' (waktu habis) atau 'error' (pemeriksa gagal menjalankan kode).
   */
  async function hasil(h) {
    lirikServer = null;
    developer.toleh = 0;
    developer.aktivitas = null;
    developer.gelembung.replaceChildren();
    pemeriksa.aktivitas = null;
    pemeriksa.ikon(null);
    siswa?.ikon(null);
    const k = siswa;

    if (h.terhenti) {
      // Developer berhenti mengetik, melihat terminal, memberi tanda kepada Pemeriksa
      teksTerminal = h.terhenti === 'waktu' ? 'WAKTU HABIS' : 'ERROR';
      serverAktif(false);
      developer.setEkspresi('kaget');
      await tunggu(800);
      developer.setEkspresi('normal');
      developer.arahTarget = panggung(Math.atan2(pemeriksa.pos.x - developer.pos.x, pemeriksa.pos.z - developer.pos.z));
      gerakSesaat(developer, 'angkat', 1.6);
      emoteBubble(developer, h.terhenti === 'waktu' ? '⏱️' : '⚠️');
      await ucap(developer, h.terhenti === 'waktu' ? 'Prosesnya berhenti, waktunya habis.' : 'Programnya tidak bisa dijalankan.', { tahan: 400 });
      if (k) hadap(pemeriksa, k);
      await ucap(pemeriksa, h.terhenti === 'waktu'
        ? 'Programnya berjalan terlalu lama. Cek perulangannya, ya.'
        : 'Programnya belum bisa berjalan. Lihat laporannya, ya.', { tahan: 500 });
      if (k) {
        gerakSesaat(k, 'angguk', 1.0);
        await ucap(k, 'Baik, Pak. Saya cek lagi.', { tahan: 500 });
      }
      ikonSementara(pemeriksa, 'seru');
    } else if (h.lulus) {
      serverAktif(false);
      teksTerminal = 'OK';
      gambarTerminal();
      // Developer menoleh dan mengacungkan jempol; Pemeriksa mengangguk lalu memuji
      developer.arahTarget = 0;
      developer.setEkspresi('senyum');
      gerakSesaat(developer, 'jempol', 1.8);
      emoteBubble(developer, '👍');
      await ucap(developer, 'Aman, semuanya jalan!', { tahan: 300, ekspresiAkhir: 'senyum' });
      if (k) hadap(pemeriksa, k);
      pemeriksa.setEkspresi('senyum');
      const kalimat = h.bebas
        ? `Bagus! Tidak ada bug.${typeof h.skor === 'number' ? ` Skornya ${h.skor}.` : ''}`
        : 'Bagus! Semua pemeriksaan lulus.';
      gerakPenuh(pemeriksa, 'angguk');
      await ucap(pemeriksa, kalimat, { tahan: 400, ekspresiAkhir: 'senyum' });
      if (k) {
        k.duduk = false;
        await tunggu(450);
        k.setEkspresi('senyum');
        k.lompat = 1.0;
        if (punya(pemeriksa, 'tepuk')) gerakSesaat(pemeriksa, 'tepuk', 2.5);
        konfeti(k.pos.x, k.pos.z);
        efekLulus(k, h.skor);
        emoteBubble(k, '🎉');
        await ucap(k, 'Yeay! Terima kasih, Pak!', { tahan: 500, ekspresiAkhir: 'senyum' });
      }
      if (h.saran) {
        // Laporan berisi saran: Pemeriksa membaca catatan lalu menunjuk sambil menjelaskan
        pemeriksa.ikon('kertas');
        await tunggu(700);
        pemeriksa.ikon(null);
        gerakSesaat(pemeriksa, 'tunjuk', 2.2);
        await ucap(pemeriksa, 'Ada beberapa saran di laporan. Coba dibaca, ya.', { tahan: 400 });
        if (k) gerakSesaat(k, 'angguk', 1.0);
      }
      await tempelCatatan();
    } else {
      serverAktif(false);
      teksTerminal = 'PERLU DIBENAHI';
      gambarTerminal();
      // Developer memanggil QA; QA mengecek terminal lalu menunjukkan temuannya kepada murid
      const jumlah = h.bug ?? 0;
      developer.arahTarget = panggung(Math.atan2(qa.pos.x - developer.pos.x, qa.pos.z - developer.pos.z));
      gerakSesaat(developer, 'angkat', 1.6);
      await ucap(developer, 'QA, bisa bantu cek ini?', { tahan: 200 });
      await jalan(qa, RUTE.qaKeServer);
      qa.arahTarget = panggung(Math.atan2(380 - qa.pos.x, 35 - qa.pos.z));
      qa.ikon('kaca');
      gerakSesaat(qa, 'periksa', 1.6);
      await ucap(qa, jumlah ? `Ketemu ${jumlah} hal yang perlu dibenahi.` : 'Ada bagian yang belum jalan.', { tahan: 300 });
      qa.ikon(null);
      catatan = buatBenda('catatan');
      pegang(catatan, qa);
      await jalan(qa, RUTE.qaKeMurid);
      if (k) {
        hadap(qa, k);
        k.toleh = 0.6;                      // murid menoleh ke QA di sampingnya
        gerakSesaat(qa, 'tunjuk', 2.4);
        await ucap(qa, 'Bagian ini yang perlu diperbaiki. Pasti bisa!', { tahan: 400, ekspresiAkhir: 'senyum' });
        await serahkan(catatan, k, { tinggi: 30, maju: 9 });
        gerakSesaat(k, 'angguk', 1.2);
        await ucap(k, 'Oke, saya perbaiki dulu!', { tahan: 400, ekspresiAkhir: 'senyum' });
        k.toleh = 0;
        hadap(pemeriksa, k);
      }
      gerakPenuh(pemeriksa, 'setuju');
      await ucap(pemeriksa, 'Semangat! Kirim lagi kalau sudah, ya.', { tahan: 400, ekspresiAkhir: 'senyum' });
      jalan(qa, RUTE.qaPulang).then(() => { if (!sedangDiperiksa()) qa.arahTarget = 0; });
    }

    // Developer kembali ke mejanya (tidak ditunggu)
    developer.setEkspresi('normal');
    jalan(developer, RUTE.devKeMeja).then(() => duduk(developer));
    janjiPulang = pulang();
  }

  const sedangDiperiksa = () => dipanggil !== null;
  function duduk(k) {
    if (k === developer && Math.hypot(k.pos.x - TEMPAT.mejaDev.x, k.pos.z - TEMPAT.mejaDev.z) < 2) {
      hadapMeja(k);
      k.duduk = true;
    }
  }

  /** Catatan nama murid yang lulus melayang dari tangan Pemeriksa ke papan, lalu "menempel". */
  async function tempelCatatan() {
    const c = buatBenda('catatan');
    c.m.position.set(...tangan(pemeriksa));
    const x = 30 + Math.random() * 120, y = 30 + Math.random() * 55;
    await terbangkan(c, x, y, 4, { detik: 0.9 });
    let t = 0;
    animasi.add((dt) => {
      t += dt;
      c.m.scale.setScalar(1 + Math.sin(Math.min(1, t / 0.3) * Math.PI) * 0.4);
      if (t < 1.4) return true;
      buangBenda(c);           // papan digambar ulang oleh guru.js (papan()) setelah hasil tersimpan
      return false;
    });
  }

  function ikonSementara(k, nama, ms = 3500) {
    k.ikon(nama);
    k.timerIkon = setTimeout(() => k.ikon(null), ms);
  }

  /**
   * Murid menerima map kembali, berdiri, mengangguk, lalu keluar lewat pintu kanan ke taman.
   * Pemeriksa membalas, merapikan meja, dan kembali duduk.
   */
  async function pulang() {
    const k = siswa;
    if (!k) return;
    await tunggu(300);
    hadap(pemeriksa, k);
    if (mapProyek) {
      gerakSesaat(pemeriksa, 'serah', 0.8);
      await serahkan(mapProyek, k);
    }
    if (k.duduk) {
      k.duduk = false;
      await tunggu(550);
    }
    hadap(k, pemeriksa);
    gerakSesaat(k, 'angguk', 1.0);
    await ucap(k, 'Terima kasih, Pak.', { tahan: 300 });
    gerakPenuh(pemeriksa, 'angguk');
    ucap(pemeriksa, 'Sama-sama!', { tahan: 600, ekspresiAkhir: 'senyum' });

    const keluar = jalan(k, RUTE.keluar);
    await tunggu(600);
    hadapMeja(pemeriksa);
    pemeriksa.aktivitas = 'ketik';         // merapikan meja, lalu duduk kembali
    await sampai(() => k.pos.x > 410 || k.dihapus);
    pintu(true);
    await keluar;
    await jalan(k, 'luar');
    pintu(false);
    for (const b of [mapProyek, catatan, kartuKode]) buangBenda(b);
    mapProyek = catatan = kartuKode = null;
    if (siswa === k) siswa = null;
    k.hapus();
    dipanggil = null;
    teksTerminal = '';
    gambarTerminal();
    gambarAntrean();
    fokus('luas');
    pemeriksa.aktivitas = null;
    mulaiIdle();
  }

  // -------------------------------------------------------------------
  // Papan & layar (digambar ke kanvas → tekstur)
  // -------------------------------------------------------------------
  function papan(namaLulus) {
    const terbaru = namaLulus.slice(-6);
    const { ctx, tekstur } = papanKanvas;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 300);
    ctx.fillStyle = '#555555';
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SUDAH LULUS', 300, 28);
    ctx.font = '24px monospace';
    terbaru.forEach((nama, i) => {
      const x = 24 + (i % 3) * 192, y = 58 + Math.floor(i / 3) * 118;
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.fillRect(x + 4, y + 5, 176, 104);
      ctx.fillStyle = WARNA_CATATAN[i];
      ctx.fillRect(x, y, 176, 104);
      ctx.fillStyle = '#333333';
      ctx.fillText(nama.length > 10 ? nama.slice(0, 9) + '…' : nama, x + 88, y + 54);
    });
    tekstur.needsUpdate = true;
    nyalaLed = Math.min(6, namaLulus.length);
  }

  let teksLayar = '';
  function gambarLayar(garisScan) {
    const { ctx, tekstur } = layarKanvas;
    ctx.fillStyle = teksLayar ? '#f4f7ff' : '#3a4258';
    ctx.fillRect(0, 0, 256, 136);
    if (teksLayar) {
      ctx.fillStyle = '#1b2030';
      ctx.font = 'bold 26px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(teksLayar, 128, 70);
    }
    if (garisScan !== undefined) {
      ctx.fillStyle = 'rgba(79,140,255,.18)';
      ctx.fillRect(0, garisScan * 136 - 4, 256, 8);
    }
    tekstur.needsUpdate = true;
  }

  function layar(teks) {
    teksLayar = teks.length > 18 ? teks.slice(0, 17) + '…' : teks;
    gambarLayar();
  }

  // Monitor Developer: editor kode gelap; baris bertambah saat ia mengetik, kursor berkedip
  const WARNA_KODE = ['#c678dd', '#61afef', '#98c379', '#e5c07b', '#abb2bf'];
  function gambarLayarDev() {
    const { ctx, tekstur } = layarDevKanvas;
    ctx.fillStyle = '#1e222a';
    ctx.fillRect(0, 0, 256, 136);
    const baris = developer.aktivitas === 'ketik' ? 3 + Math.floor(waktu * 2) % 6 : 6;
    for (let i = 0; i < baris; i++) {
      const lekuk = [0, 1, 1, 2, 1, 0][i] * 16;
      ctx.fillStyle = WARNA_KODE[i % WARNA_KODE.length];
      ctx.fillRect(14 + lekuk, 14 + i * 18, 40 + ((i * 53) % 110), 9);
    }
    if (kedipKursorTerakhir) {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(14 + (baris < 6 ? 60 : 150), 14 + (baris - 1) * 18, 6, 11);
    }
    tekstur.needsUpdate = true;
  }

  // Terminal: log berjalan saat memeriksa, pesan akhir (OK / WAKTU HABIS / ERROR), atau kursor siaga
  let teksTerminal = '';
  const LOG_TERMINAL = ['$ python app.py', ' * Running', 'GET /  200', 'GET /profil', 'POST /tambah', '302 → /', 'cek template', 'test_client()'];
  function gambarTerminal() {
    const { ctx, tekstur } = terminalKanvas;
    ctx.fillStyle = '#0f1a14';
    ctx.fillRect(0, 0, 192, 128);
    ctx.font = 'bold 15px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if (serverSibuk) {
      const mulai = Math.floor(waktu * 3);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i === 5 ? '#b8ffcf' : '#4be38a';
        ctx.fillText(LOG_TERMINAL[(mulai + i) % LOG_TERMINAL.length], 8, 8 + i * 19);
      }
    } else if (teksTerminal) {
      const ok = teksTerminal === 'OK';
      ctx.fillStyle = ok ? '#4be38a' : '#ff6b6b';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const [i, b] of pecah(teksTerminal, 10).entries()) ctx.fillText(b, 96, 50 + i * 28);
    } else if (kedipKursorTerakhir) {
      ctx.fillStyle = '#4be38a';
      ctx.fillText('>_', 8, 8);
    }
    tekstur.needsUpdate = true;
  }

  // Layar antrean di ruang tunggu: murid yang dipanggil, atau bergantian jumlah menunggu / pengingat
  function gambarAntrean() {
    const { ctx, tekstur } = antreanKanvas;
    ctx.fillStyle = '#16324f';
    ctx.fillRect(0, 0, 400, 192);
    ctx.fillStyle = '#244a72';
    ctx.fillRect(0, 0, 400, 44);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(dipanggil ? 'SILAKAN MASUK' : 'ANTREAN', 200, 23);
    if (dipanggil) {
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 40px sans-serif';
      const n = dipanggil.nama;
      ctx.fillText(n.length > 14 ? n.slice(0, 13) + '…' : n, 200, 100);
      ctx.fillStyle = '#c8d8f0';
      ctx.font = '22px sans-serif';
      ctx.fillText(jumlahMenunggu ? `${jumlahMenunggu} lagi menunggu` : 'Antrean terakhir', 200, 158);
    } else if (halamanAntreanTerakhir === 1) {
      ctx.fillStyle = '#c8d8f0';
      ctx.font = '28px sans-serif';
      ctx.fillText('Siapkan proyekmu,', 200, 95);
      ctx.fillText('tunggu dipanggil.', 200, 135);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 72px sans-serif';
      ctx.fillText(String(jumlahMenunggu), 200, 104);
      ctx.fillStyle = '#c8d8f0';
      ctx.font = '22px sans-serif';
      ctx.fillText('menunggu', 200, 160);
    }
    tekstur.needsUpdate = true;
  }

  function reset() {
    hentikanIdle();
    if (siswa) { siswa.hapus(); siswa = null; }
    for (const m of muridTunggu.values()) { buangBenda(m.laptop); m.k.hapus(); m.pergi = true; }
    muridTunggu.clear();
    for (const b of [...bendaDibawa]) buangBenda(b);
    mapProyek = kartuKode = catatan = null;
    dipanggil = null;
    janjiPulang = null;
    lirikServer = null;
    jumlahMenunggu = 0;
    for (const k of [pemeriksa, qa, developer]) { k.ikon(null); k.gelembung.replaceChildren(); k.setEkspresi('normal'); k.rute = []; k.toleh = 0; }
    pemeriksa.pos = { ...TEMPAT.meja };
    qa.pos = { ...TEMPAT.pojokQA };
    developer.pos = { ...TEMPAT.mejaDev };
    pemeriksa.arah = pemeriksa.arahTarget = ARAH_MEJA;
    developer.arah = developer.arahTarget = ARAH_MEJA;
    developer.duduk = true;
    qa.arah = qa.arahTarget = 0;
    teksTerminal = '';
    serverAktif(false);
    pintu(false);
    pintu(false, pintuMasuk);
    Object.assign(fokusKini, FOKUS.luas);
    fokus('luas');
    layar('');
    gambarAntrean();
    mulaiIdle();
  }

  /** Saat kantor disembunyikan (beralih ke 2D), berhenti menggambar tetapi logika tetap jalan. */
  function jeda(ya) { dijeda = ya; }
  function tampil(ya) { akar.style.display = ya ? '' : 'none'; if (ya) ukurUlang(); }

  papan([]);
  layar('');
  gambarAntrean();
  gambarTerminal();
  gambarLayarDev();
  ukurUlang();
  mulaiIdle();
  return { datang, periksa, kabar, hasil, antrean, papan, layar, reset, jeda, tampil, pemeriksa, qa, developer };
}
