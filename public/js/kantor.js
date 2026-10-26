// =====================================================================
// KANTOR PIXEL-ART — adegan pemeriksaan di proyektor.
//
//   Pemeriksa (guru) duduk di meja, QA di dekat pintu, dan setiap kiriman
//   menghadirkan karakter siswa dengan namanya. Adegannya:
//     datang()  siswa mengetuk pintu, pemeriksa membukakan, saling bicara
//     periksa() Pemeriksa membawa tugas ke server; kabar() menampilkan progres
//     hasil()   reaksi lulus (lompat + konfeti) atau ada bug (QA datang, siswa sedih),
//               lalu siswa pulang
//
//   Saat idle (tidak ada pemeriksaan), Pemeriksa dan QA melakukan aktivitas
//   ringan: minum kopi, mengobrol, mengetik, dll.
//
//   Semua digambar dengan SVG + requestAnimationFrame; nama siswa & teks gelembung
//   selalu disisipkan lewat textContent (tidak pernah sebagai markup).
// =====================================================================
const NS = 'http://www.w3.org/2000/svg';
const PX = 3;
const KECEPATAN = 85;      // piksel per detik
const KETIK_MS = 28;       // jeda per huruf pada gelembung bicara

// ---------------------------------------------------------------------
// SPRITE 12×16: 4 baris kepala (gaya rambut), 4 baris wajah (ekspresi),
// 5 baris badan, 3 baris kaki (frame jalan).
// ---------------------------------------------------------------------
export const RAMBUT = {
  pendek:  ['....HHHH....', '...HHHHHH...', '..HHHHHHHH..', '..HSSSSSSH..'],
  jambul:  ['...H.HH.H...', '...HHHHHH...', '..HHHHHHHH..', '..HSSSSSSH..'],
  panjang: ['....HHHH....', '..HHHHHHHH..', '.HHHHHHHHHH.', '.HHSSSSSSHH.'],
  rapi:    ['............', '...HHHHHH...', '..HHHHHHHH..', '..HHSSSSSH..'],
};
export const WAJAH = {
  normal: ['..SSESSESS..', '..SSSSSSSS..', '...SSMMSS...', '....SSSS....'],
  senyum: ['..SSESSESS..', '..SSSSSSSS..', '...MSSSSM...', '....MMMM....'],
  sedih:  ['..SSESSESS..', '..SSTSSSSS..', '...SMMMMS...', '....SSSS....'],
  bicara: ['..SSESSESS..', '..SSSSSSSS..', '....MMMM....', '....SMMS....'],
  kaget:  ['..SEESSEES..', '..SSSSSSSS..', '....SMMS....', '....SMMS....'],
};
export const BADAN = ['..BBBBBBBB..', '.SBBBBBBBBS.', '.SBBBBBBBBS.', '..BBBBBBBB..', '..PPPPPPPP..'];
export const KAKI = {
  diam:   ['..PPP..PPP..', '..PPP..PPP..', '..KKK..KKK..'],
  jalanA: ['..PPP..PPP..', '.PPP....PPP.', 'KKK......KKK'],
  jalanB: ['...PPPPPP...', '...PPPPPP...', '...KKKKKK...'],
};

export function baris(k) {
  const wajah = WAJAH[k.ekspresi] || WAJAH.normal;
  const muka = wajah.map((r, i) => {
    let s = k.kedip && i === 0 ? r.replace(/E/g, 'S') : r;
    // rambut panjang menjuntai di sisi wajah
    if (k.rambut === 'panjang' && i < 3) s = '.H' + s.slice(2, 10) + 'H.';
    return s;
  });
  return [...RAMBUT[k.rambut], ...muka, ...BADAN, ...KAKI[k.frame]];
}

function spriteSVG(k) {
  let s = '';
  baris(k).forEach((teks, y) => [...teks].forEach((h, x) => {
    if (h !== '.') s += `<rect x="${x * PX - 18}" y="${y * PX - 48}" width="${PX}" height="${PX}" fill="${k.warna[h]}"/>`;
  }));
  return s;
}

export const IKON = {
  pikir: `<rect x="-16" y="-12" width="32" height="18" rx="9" fill="#fff" stroke="#2b2f3a" stroke-width="1"/>${[-8,0,8].map((x,i)=>`<circle cx="${x}" cy="-3" r="2.5" fill="#4f8cff"><animate attributeName="cy" values="-3;-7;-3" dur="0.9s" begin="${i*0.2}s" repeatCount="indefinite"/></circle>`).join('')}`,
  centang: `<circle r="11" cy="-3" fill="#ffd166"/><path d="M-5 -3 L-1 2 L6 -8" stroke="#2b2f3a" stroke-width="3" fill="none"/><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="0.6s" repeatCount="indefinite"/>`,
  seru: `<circle r="10" cy="-3" fill="#e05a5a"><animate attributeName="r" values="9;12;9" dur="0.7s" repeatCount="indefinite"/></circle><rect x="-1.5" y="-10" width="3" height="8" fill="#fff"/><rect x="-1.5" y="0" width="3" height="3" fill="#fff"/>`,
  kaca: `<circle cx="-2" cy="-5" r="7" fill="#cfe8ff" stroke="#555" stroke-width="2.5"/><rect x="3" y="0" width="3" height="9" fill="#555" transform="rotate(-40 4 4)"/><animateTransform attributeName="transform" type="rotate" values="-10;10;-10" dur="1s" repeatCount="indefinite"/>`,
  kertas: `<rect x="-8" y="-12" width="16" height="20" fill="#fff" stroke="#888"/><rect x="-5" y="-8" width="10" height="2" fill="#4f8cff"/><rect x="-5" y="-4" width="8" height="2" fill="#aaa"/><rect x="-5" y="0" width="9" height="2" fill="#aaa"/>`,
  keringat: `<path d="M0 -10 Q4 -4 0 0 Q-4 -4 0 -10Z" fill="#7cc4ff"><animateTransform attributeName="transform" type="translate" values="0 0;0 6" dur="1.1s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.1s" repeatCount="indefinite"/></path>`,
  kopi: `<rect x="-5" y="-4" width="10" height="9" rx="2" fill="#6b3a1a"/><rect x="-6" y="-5" width="12" height="3" rx="1" fill="#8B5E3C"/><ellipse cx="0" cy="-5" rx="5" ry="2" fill="#3a1d0a"/><path d="M5 -1 Q9 -1 9 3 Q9 6 5 5" stroke="#6b3a1a" stroke-width="1.2" fill="none"/><path d="M-2 -10 Q0 -15 2 -10" stroke="#ccc" stroke-width="0.8" fill="none" opacity="0.5"><animate attributeName="opacity" values="0.2;0.6;0.2" dur="1.5s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;0 -3" dur="1.5s" repeatCount="indefinite"/></path>`,
  buku: `<rect x="-7" y="-9" width="14" height="16" rx="1" fill="#4a7bd0"/><rect x="-0.5" y="-9" width="1.5" height="16" fill="#2f5fb3"/><rect x="-5" y="-6" width="4" height="1.5" fill="#c8d8f8"/><rect x="2" y="-6" width="4" height="1.5" fill="#c8d8f8"/><rect x="-5" y="-3" width="3" height="1.5" fill="#a0b8e8"/><rect x="2" y="-3" width="3" height="1.5" fill="#a0b8e8"/>`,
};

// Lorong (y) dipakai untuk berpindah tempat supaya tidak menembus meja
const TEMPAT = {
  pintu: { x: 240, y: 268 }, luar: { x: 240, y: 300 },
  meja: { x: 198, y: 152 }, depanMeja: { x: 292, y: 160 },
  server: { x: 380, y: 178 }, papan: { x: 87, y: 165 },
  sampingServer: { x: 330, y: 205 }, pojokQA: { x: 452, y: 232 },
  sambutPintu: { x: 240, y: 232 },    // pemeriksa berdiri membukakan pintu
};
const LORONG_Y = 212;
export const WARNA_CATATAN = ['#ffe58a', '#bfe3c0', '#c9dcff', '#ffd0d0', '#e3cdfa', '#ffd9a8'];
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

function el(nama, atribut = {}, induk) {
  const e = document.createElementNS(NS, nama);
  for (const [k, v] of Object.entries(atribut)) e.setAttribute(k, v);
  if (induk) induk.appendChild(e);
  return e;
}

/** Penampilan siswa ditentukan dari namanya, supaya siswa yang sama selalu terlihat sama. */
export function penampilan(nama) {
  let h = 0;
  for (const c of nama) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pilih = (daftar) => daftar[(h = (h * 1103515245 + 12345) >>> 0) % daftar.length];
  return {
    rambut: pilih(['pendek', 'jambul', 'panjang', 'rapi']),
    H: pilih(['#2b1d12', '#3b2a1a', '#1d1d1d', '#5a3a22', '#4a2f1f']),
    S: pilih(['#f2c9a0', '#e5b98f', '#d4a476', '#c38f62']),
  };
}

/** Pecah teks menjadi baris ≤ maks huruf. */
export function pecah(teks, maks = 24) {
  const hasil = [];
  let barisIni = '';
  for (const kata of teks.split(/\s+/)) {
    if ((barisIni + ' ' + kata).trim().length > maks && barisIni) { hasil.push(barisIni); barisIni = kata; }
    else barisIni = (barisIni + ' ' + kata).trim();
  }
  if (barisIni) hasil.push(barisIni);
  return hasil.slice(0, 4);
}

export function buatKantor(svg) {
  svg.setAttribute('viewBox', '0 0 480 270');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.innerHTML = `
    <rect width="480" height="270" fill="#e9d9b8"/>
    <g opacity=".18">${Array.from({ length: 12 }, (_, i) => `<rect x="0" y="${40 + i * 20}" width="480" height="1" fill="#8a6f52"/>`).join('')}</g>
    <rect width="480" height="40" fill="#8a6f52"/>
    <rect x="40" y="8" width="60" height="22" fill="#a9d6f5"/><rect x="69" y="8" width="2" height="22" fill="#8a6f52"/>

    <!-- Jam dinding -->
    <circle cx="200" cy="18" r="10" fill="#fff" stroke="#6b5a45" stroke-width="1.5"/>
    <circle cx="200" cy="18" r="1" fill="#333"/>
    <line x1="200" y1="18" x2="200" y2="11" stroke="#333" stroke-width="1.2" stroke-linecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 200 18" to="360 200 18" dur="60s" repeatCount="indefinite"/>
    </line>
    <line x1="200" y1="18" x2="205" y2="18" stroke="#555" stroke-width="0.8" stroke-linecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 200 18" to="360 200 18" dur="3600s" repeatCount="indefinite"/>
    </line>

    <rect x="300" y="8" width="60" height="22" fill="#a9d6f5"/><rect x="329" y="8" width="2" height="22" fill="#8a6f52"/>
    <rect x="12" y="48" width="150" height="82" fill="#fff" stroke="#6b6b6b" stroke-width="3"/>
    <text x="87" y="60" font-size="8" text-anchor="middle" fill="#555" font-family="monospace">SUDAH LULUS</text>
    <g data-id="papan"></g>
    <rect x="175" y="75" width="110" height="34" fill="#a0764e"/>
    <rect x="175" y="109" width="110" height="6" fill="#7d5a39"/>
    <rect x="190" y="36" width="80" height="40" fill="#2b2f3a"/>
    <rect data-id="layar" x="194" y="40" width="72" height="31" fill="#3a4258"/>
    <text data-id="teks-layar" x="230" y="58" font-size="7" text-anchor="middle" fill="#1b2030" font-family="monospace"></text>
    <!-- Monitor scanline (aktif saat memeriksa) -->
    <g data-id="scanline" opacity="0">
      <rect x="194" y="40" width="72" height="2" fill="rgba(255,255,255,0.08)">
        <animateTransform attributeName="transform" type="translate" values="0 0;0 31;0 0" dur="2s" repeatCount="indefinite"/>
      </rect>
    </g>

    <!-- Kopi di meja pemeriksa -->
    <g data-id="kopi-meja">
      <rect x="247" y="86" width="7" height="6" rx="1" fill="#6b3a1a"/>
      <ellipse cx="250.5" cy="86" rx="4" ry="1.8" fill="#3a1d0a"/>
      <rect x="254" y="87" width="3" height="3" rx="1" fill="#6b3a1a" opacity=".6"/>
      <path d="M249 83 Q251 79 253 83" stroke="#d0c8b0" stroke-width="0.5" fill="none" opacity="0.3">
        <animate attributeName="opacity" values="0.1;0.35;0.1" dur="2.8s" repeatCount="indefinite"/>
        <animateTransform attributeName="transform" type="translate" values="0 0;-1 -4" dur="2.8s" repeatCount="indefinite"/>
      </path>
      <path d="M251 82 Q252 78 254 82" stroke="#d0c8b0" stroke-width="0.5" fill="none" opacity="0.2">
        <animate attributeName="opacity" values="0.05;0.3;0.05" dur="3.3s" repeatCount="indefinite"/>
        <animateTransform attributeName="transform" type="translate" values="0 0;1 -5" dur="3.3s" repeatCount="indefinite"/>
      </path>
    </g>

    <rect x="252" y="96" width="14" height="10" fill="#c94f4f"/><rect x="255" y="92" width="8" height="5" fill="#f4f4f4"/>
    <rect x="400" y="50" width="56" height="120" fill="#3b3e46"/>
    <g data-id="led"></g>
    <text x="428" y="182" font-size="8" text-anchor="middle" fill="#6b5a45" font-family="monospace">SERVER</text>
    <rect data-id="server-glow" x="398" y="48" width="60" height="124" rx="2" fill="none" stroke="#4f8cff" stroke-width="2" opacity="0"/>

    <!-- Meja kecil QA -->
    <rect x="438" y="218" width="26" height="12" fill="#a0764e"/>
    <rect x="438" y="230" width="26" height="3" fill="#7d5a39"/>
    <!-- Buku di meja QA -->
    <rect x="443" y="214" width="14" height="5" rx="1" fill="#4a7bd0"/>
    <rect x="449.5" y="214" width="1.5" height="5" fill="#2f5fb3"/>
    <!-- Kopi QA -->
    <rect x="457" y="215" width="5" height="4" rx="1" fill="#6b3a1a"/>
    <ellipse cx="459.5" cy="215" rx="3" ry="1.2" fill="#3a1d0a"/>

    <rect x="20" y="215" width="18" height="22" fill="#6aa84f"/><rect x="16" y="237" width="26" height="12" fill="#a0764e"/>
    <!-- Keset pintu -->
    <rect x="220" y="269" width="40" height="3" rx="1" fill="#a08060" opacity=".45"/>
    <rect data-id="pintu" x="215" y="255" width="50" height="15" fill="#8a6f52"/>
    <g data-id="karakter"></g>
    <g data-id="efek"></g>`;
  const bagian = (id) => svg.querySelector(`[data-id="${id}"]`);

  // -------------------------------------------------------------------
  // Karakter
  // -------------------------------------------------------------------
  function buatKarakter({ nama, baju, celana = '#2f3a55', rambut = 'pendek', H = '#3b2a1a', S = '#f2c9a0', mulai, warnaLabel = '#2b2f3a' }) {
    const g = el('g', {}, bagian('karakter'));
    const bayangan = el('ellipse', { cx: 0, cy: 2, rx: 13, ry: 4, fill: 'rgba(0,0,0,0.13)' }, g);
    const badan = el('g', {}, g);
    const ikon = el('g', { transform: 'translate(16,-64)' }, g);
    const label = el('g', { transform: 'translate(0,-56)' }, g);
    const gelembung = el('g', {}, g);
    const k = {
      g, badan, bayangan, gelembung, pos: { ...mulai }, rute: [], selesai: null, kiri: false, waktuFrame: 0,
      frame: 'diam', ekspresi: 'normal', kedip: false, rambut, lompat: 0, napas: Math.random() * 6,
      squash: 0,
      warna: { H, S, E: '#1d1d1d', M: '#a94f4a', B: baju, P: celana, K: '#4a3020', T: '#6ab0ff' },
    };
    k.gambar = () => { badan.innerHTML = spriteSVG(k); };
    k.setFrame = (f) => { if (k.frame !== f) { k.frame = f; k.gambar(); } };
    k.setEkspresi = (e) => {
      if (k.ekspresi !== e) {
        k.ekspresi = e; k.gambar();
        k.squash = 0.15;
      }
    };
    k.ikon = (n) => { clearTimeout(k.timerIkon); ikon.innerHTML = n ? `<g>${IKON[n]}</g>` : ''; };
    k.tampil = (ya) => { g.style.display = ya ? '' : 'none'; };
    k.hapus = () => { clearInterval(k.timerKedip); g.remove(); };
    k.setNama = (teks) => {
      label.innerHTML = '';
      if (!teks) return;
      const pendek = teks.length > 16 ? teks.slice(0, 15) + '…' : teks;
      const lebar = pendek.length * 4.3 + 10;
      el('rect', { x: -lebar / 2, y: -9, width: lebar, height: 11, rx: 3, fill: warnaLabel, opacity: '.88' }, label);
      const t = el('text', { x: 0, y: -1, 'font-size': 7, 'text-anchor': 'middle', fill: '#fff', 'font-family': 'monospace', 'font-weight': 'bold' }, label);
      t.textContent = pendek;
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

  const semua = new Set();
  const pemeriksa = buatKarakter({ nama: 'Pemeriksa', baju: '#4a7bd0', rambut: 'rapi', mulai: TEMPAT.meja, warnaLabel: '#2f5fb3' });
  const qa = buatKarakter({ nama: 'QA', baju: '#8e5bd0', rambut: 'jambul', H: '#1d1d1d', mulai: TEMPAT.pojokQA, warnaLabel: '#6a3fb0' });
  let siswa = null;

  // -------------------------------------------------------------------
  // Gerak: requestAnimationFrame + interpolasi
  // -------------------------------------------------------------------
  let terakhir = performance.now();
  let debuCooldown = 0;
  function tick(now) {
    const dt = Math.max(0, Math.min((now - terakhir) / 1000, 0.1));
    terakhir = now;
    debuCooldown = Math.max(0, debuCooldown - dt);
    for (const k of semua) {
      let dyBadan = 0;
      let sxBadan = 1, syBadan = 1;
      if (k.rute.length) {
        const tj = k.rute[0], dx = tj.x - k.pos.x, dy = tj.y - k.pos.y, d = Math.hypot(dx, dy);
        if (d < 1) {
          k.rute.shift();
          if (!k.rute.length) { k.setFrame('diam'); const s = k.selesai; k.selesai = null; s && s(); }
        } else {
          const m = Math.min(KECEPATAN * dt, d);
          k.pos.x += dx / d * m; k.pos.y += dy / d * m;
          if (Math.abs(dx) > .5) k.kiri = dx < 0;
          k.waktuFrame += dt;
          if (k.waktuFrame > .22) {
            k.waktuFrame = 0;
            k.setFrame(k.frame === 'jalanA' ? 'jalanB' : 'jalanA');
            if (debuCooldown <= 0) { debuLangkah(k.pos.x, k.pos.y); debuCooldown = 0.15; }
          }
          dyBadan = k.frame === 'jalanA' ? -1 : 0;
        }
      } else {
        k.napas += dt;
        dyBadan = Math.sin(k.napas * 2.2) > 0.6 ? -1 : 0;
      }
      if (k.lompat > 0) {
        k.lompat = Math.max(0, k.lompat - dt);
        dyBadan -= Math.abs(Math.sin(k.lompat * Math.PI * 3)) * 9;
      }
      if (k.squash > 0) {
        k.squash = Math.max(0, k.squash - dt);
        const t = k.squash / 0.15;
        const fase = Math.sin(t * Math.PI * 1.5);
        sxBadan = 1 + fase * 0.08;
        syBadan = 1 - fase * 0.08;
      }
      if (k.bayangan) {
        const lift = Math.max(0, -dyBadan);
        k.bayangan.setAttribute('rx', (13 - lift * 0.4).toFixed(1));
        k.bayangan.setAttribute('ry', (4 - lift * 0.15).toFixed(1));
        k.bayangan.setAttribute('opacity', Math.max(0.04, 0.13 - lift * 0.01).toFixed(2));
      }
      k.g.setAttribute('transform', `translate(${k.pos.x.toFixed(1)},${k.pos.y.toFixed(1)})`);
      const flip = k.kiri ? ' scale(-1,1)' : '';
      if (sxBadan !== 1 || syBadan !== 1) {
        k.badan.setAttribute('transform', `translate(0,${dyBadan.toFixed(1)}) scale(${sxBadan.toFixed(3)},${syBadan.toFixed(3)})${flip}`);
      } else {
        k.badan.setAttribute('transform', `translate(0,${dyBadan.toFixed(1)})${flip}`);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function jalan(k, tujuan) {
    const t = TEMPAT[tujuan];
    if (k.selesai) { const s = k.selesai; k.selesai = null; s(); }
    if (Math.hypot(t.x - k.pos.x, t.y - k.pos.y) < 1) return Promise.resolve();
    k.rute = Math.abs(t.y - k.pos.y) < 12 && Math.abs(t.x - k.pos.x) < 90
      ? [{ x: t.x, y: t.y }]
      : [{ x: k.pos.x, y: LORONG_Y }, { x: t.x, y: LORONG_Y }, { x: t.x, y: t.y }];
    return new Promise((r) => { k.selesai = r; });
  }

  const hadap = (k, ke) => { k.kiri = ke.pos.x < k.pos.x; };

  // -------------------------------------------------------------------
  // Gelembung bicara
  // -------------------------------------------------------------------
  let nomorUcap = 0;
  async function ucap(k, teks, { tahan = 1500, ekspresiAkhir } = {}) {
    const id = ++nomorUcap;
    k.ucapId = id;
    const barisTeks = pecah(teks);
    const lebar = Math.max(...barisTeks.map((b) => b.length)) * 4.3 + 12;
    const tinggi = barisTeks.length * 9 + 8;
    let x = -lebar / 2;
    if (k.pos.x + x < 4) x = 4 - k.pos.x;
    if (k.pos.x + x + lebar > 476) x = 476 - k.pos.x - lebar;
    const yAtas = -71 - tinggi;
    k.gelembung.innerHTML = '';
    el('rect', { x, y: yAtas, width: lebar, height: tinggi, rx: 5, fill: '#fff', stroke: '#2b2f3a', 'stroke-width': 1.2 }, k.gelembung);
    el('path', { d: `M-4 ${yAtas + tinggi - 0.6} L0 ${yAtas + tinggi + 6} L4 ${yAtas + tinggi - 0.6}Z`, fill: '#fff', stroke: '#2b2f3a', 'stroke-width': 1.2 }, k.gelembung);
    el('rect', { x: -3.4, y: yAtas + tinggi - 1.6, width: 6.8, height: 2.2, fill: '#fff' }, k.gelembung);
    const teksEl = barisTeks.map((_, i) => el('text', {
      x: x + 6, y: yAtas + 11 + i * 9, 'font-size': 7, fill: '#1d1d1d', 'font-family': 'monospace',
    }, k.gelembung));
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
    if (k.ucapId === id) k.gelembung.innerHTML = '';
  }

  function gelembungTetap(k, teks) {
    k.ucapId = ++nomorUcap;
    const barisTeks = pecah(teks, 26);
    const lebar = Math.max(...barisTeks.map((b) => b.length)) * 4.3 + 12;
    const tinggi = barisTeks.length * 9 + 8;
    let x = -lebar / 2;
    if (k.pos.x + x + lebar > 476) x = 476 - k.pos.x - lebar;
    if (k.pos.x + x < 4) x = 4 - k.pos.x;
    const yAtas = -71 - tinggi;
    k.gelembung.innerHTML = '';
    el('rect', { x, y: yAtas, width: lebar, height: tinggi, rx: 5, fill: '#f2f6ff', stroke: '#4f8cff', 'stroke-width': 1.2, 'stroke-dasharray': '3 2' }, k.gelembung);
    barisTeks.forEach((b, i) => {
      const t = el('text', { x: x + 6, y: yAtas + 11 + i * 9, 'font-size': 7, fill: '#2a4d8f', 'font-family': 'monospace' }, k.gelembung);
      t.textContent = b;
    });
  }

  // -------------------------------------------------------------------
  // Efek
  // -------------------------------------------------------------------
  function debuLangkah(x, y) {
    const g = el('g', {}, bagian('efek'));
    for (let i = 0; i < 4; i++) {
      const dx = (Math.random() - 0.5) * 14;
      const ukuran = 1 + Math.random() * 1.5;
      const c = el('circle', { cx: x + dx, cy: y, r: ukuran, fill: '#c4b89a', opacity: '0.5' }, g);
      const dur = (0.35 + Math.random() * 0.25).toFixed(2);
      el('animate', { attributeName: 'cy', values: `${y};${y - 6 - Math.random() * 5}`, dur: `${dur}s`, fill: 'freeze', begin: 'indefinite' }, c);
      el('animate', { attributeName: 'opacity', values: '0.5;0', dur: `${dur}s`, fill: 'freeze', begin: 'indefinite' }, c);
      el('animate', { attributeName: 'r', values: `${ukuran};0.5`, dur: `${dur}s`, fill: 'freeze', begin: 'indefinite' }, c);
    }
    g.querySelectorAll('animate').forEach((a) => a.beginElement());
    setTimeout(() => g.remove(), 600);
  }

  function konfeti(x, y) {
    const g = el('g', {}, bagian('efek'));
    const warna = ['#ff6b6b', '#ffd166', '#4be38a', '#4f8cff', '#e3cdfa', '#ff9f43'];
    for (let i = 0; i < 26; i++) {
      const sudut = (Math.PI * 2 * i) / 26 + Math.random() * 0.3;
      const jarak = 35 + Math.random() * 40;
      const tx = Math.cos(sudut) * jarak, ty = Math.sin(sudut) * jarak * 0.7 - 20;
      const r = el('rect', { x: x - 1.5, y: y - 60, width: 3, height: 3, fill: warna[i % warna.length] }, g);
      const dur = (0.9 + Math.random() * 0.6).toFixed(2);
      el('animateTransform', { attributeName: 'transform', type: 'translate', values: `0 0;${tx} ${ty};${tx} ${ty + 40}`, dur: `${dur}s`, fill: 'freeze', begin: 'indefinite' }, r);
      el('animate', { attributeName: 'opacity', values: '1;1;0', dur: `${dur}s`, fill: 'freeze', begin: 'indefinite' }, r);
    }
    g.querySelectorAll('animate, animateTransform').forEach((a) => a.beginElement());
    setTimeout(() => g.remove(), 1800);
  }

  function efekLulus(k, skor) {
    const flash = el('rect', { width: 480, height: 270, fill: '#fff', opacity: '0' }, bagian('efek'));
    el('animate', { attributeName: 'opacity', values: '0;0.35;0', dur: '0.4s', fill: 'freeze', begin: 'indefinite' }, flash);
    flash.querySelectorAll('animate').forEach((a) => a.beginElement());
    setTimeout(() => flash.remove(), 450);

    const bintangG = el('g', {}, bagian('efek'));
    for (let i = 0; i < 5; i++) {
      const sudut = (Math.PI * 2 * i) / 5;
      const radius = 22;
      const bx = k.pos.x + Math.cos(sudut) * radius;
      const by = k.pos.y - 40 + Math.sin(sudut) * radius * 0.7;
      const bintang = el('text', {
        x: bx, y: by, 'font-size': '8', fill: '#ffd700',
        'text-anchor': 'middle', 'dominant-baseline': 'central',
      }, bintangG);
      bintang.textContent = '★';
      el('animateTransform', { attributeName: 'transform', type: 'rotate', from: `0 ${k.pos.x} ${k.pos.y - 40}`, to: `360 ${k.pos.x} ${k.pos.y - 40}`, dur: '1.8s', repeatCount: '2', begin: 'indefinite' }, bintang);
      el('animate', { attributeName: 'opacity', values: '0;1;1;0', dur: '3.6s', fill: 'freeze', begin: 'indefinite' }, bintang);
    }
    bintangG.querySelectorAll('animate, animateTransform').forEach((a) => a.beginElement());
    setTimeout(() => bintangG.remove(), 3700);

    if (typeof skor === 'number') {
      const skorG = el('g', {}, bagian('efek'));
      const skorTeks = el('text', {
        x: k.pos.x, y: k.pos.y - 72, 'font-size': '14', 'font-weight': 'bold',
        fill: '#1f8a52', 'text-anchor': 'middle', 'font-family': 'monospace',
      }, skorG);
      skorTeks.textContent = `${skor}`;
      el('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0;0 -18', dur: '2s', fill: 'freeze', begin: 'indefinite' }, skorTeks);
      el('animate', { attributeName: 'opacity', values: '1;1;0', dur: '2s', fill: 'freeze', begin: 'indefinite' }, skorTeks);
      skorG.querySelectorAll('animate, animateTransform').forEach((a) => a.beginElement());
      setTimeout(() => skorG.remove(), 2100);
    }
  }

  function emoteBubble(k, emoji) {
    const g = el('g', { transform: 'translate(0,-75)' }, k.g);
    el('circle', { cx: 0, cy: 0, r: 8, fill: '#fff', stroke: '#ddd', 'stroke-width': 0.8, opacity: '0.9' }, g);
    const t = el('text', { x: 0, y: 1, 'font-size': '10', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
    t.textContent = emoji;
    el('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 -75;0 -82;0 -90', dur: '1.8s', fill: 'freeze', begin: 'indefinite' }, g);
    el('animate', { attributeName: 'opacity', values: '0;1;1;0', dur: '1.8s', fill: 'freeze', begin: 'indefinite' }, g);
    g.querySelectorAll('animate, animateTransform').forEach((a) => a.beginElement());
    setTimeout(() => g.remove(), 1900);
  }

  /** Efek gelombang ketukan di pintu. */
  function efekKetuk(x, y) {
    const g = el('g', {}, bagian('efek'));
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (!g.parentNode) return;
        const arc = el('circle', { cx: x, cy: y, r: '3', fill: 'none', stroke: '#8a6f52', 'stroke-width': '1.8', opacity: '0.7' }, g);
        el('animate', { attributeName: 'r', values: '3;20', dur: '0.5s', fill: 'freeze', begin: 'indefinite' }, arc);
        el('animate', { attributeName: 'opacity', values: '0.7;0', dur: '0.5s', fill: 'freeze', begin: 'indefinite' }, arc);
        el('animate', { attributeName: 'stroke-width', values: '1.8;0.3', dur: '0.5s', fill: 'freeze', begin: 'indefinite' }, arc);
        arc.querySelectorAll('animate').forEach((a) => a.beginElement());
      }, i * 180);
    }
    // Teks TOK TOK
    const tok = el('text', {
      x, y: y - 18, 'font-size': '9', 'font-weight': 'bold',
      'text-anchor': 'middle', fill: '#6b5a45', 'font-family': 'monospace',
    }, g);
    tok.textContent = 'TOK TOK';
    el('animate', { attributeName: 'opacity', values: '0;1;1;0', dur: '1s', fill: 'freeze', begin: 'indefinite' }, tok);
    el('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0;0 -6', dur: '1s', fill: 'freeze', begin: 'indefinite' }, tok);
    tok.querySelectorAll('animate, animateTransform').forEach((a) => a.beginElement());
    setTimeout(() => g.remove(), 1100);
  }

  function pintu(terbuka) {
    const p = bagian('pintu');
    p.querySelectorAll('animate').forEach((a) => a.remove());
    const w0 = p.getAttribute('width');
    const wTarget = terbuka ? '14' : '50';
    p.setAttribute('fill', terbuka ? '#5a4632' : '#8a6f52');
    const animW = el('animate', { attributeName: 'width', from: w0, to: wTarget, dur: '0.25s', fill: 'freeze', begin: 'indefinite' }, p);
    animW.beginElement();
  }

  function serverAktif(aktif) {
    const glow = bagian('server-glow');
    if (aktif) {
      glow.innerHTML = '';
      el('animate', { attributeName: 'opacity', values: '0;0.5;0', dur: '1.5s', repeatCount: 'indefinite' }, glow);
      bagian('scanline').setAttribute('opacity', '1');
    } else {
      glow.innerHTML = '';
      glow.setAttribute('opacity', '0');
      bagian('scanline').setAttribute('opacity', '0');
    }
  }

  async function serahKertas(dari, ke) {
    const g = el('g', {}, bagian('efek'));
    g.innerHTML = `<rect x="-6" y="-8" width="12" height="16" fill="#fff" stroke="#888" stroke-width="0.8"/>
      <rect x="-3" y="-5" width="6" height="1.5" fill="#4f8cff"/>
      <rect x="-3" y="-2" width="5" height="1.5" fill="#bbb"/>
      <rect x="-3" y="1" width="4" height="1.5" fill="#bbb"/>`;
    const sx = dari.pos.x + (dari.kiri ? -12 : 12);
    const sy = dari.pos.y - 35;
    const ex = ke.pos.x + (ke.kiri ? 12 : -12);
    const ey = ke.pos.y - 35;
    const mx = (sx + ex) / 2, my = Math.min(sy, ey) - 22;
    el('animateMotion', { path: `M${sx},${sy} Q${mx},${my} ${ex},${ey}`, dur: '0.6s', fill: 'freeze', begin: 'indefinite' }, g);
    el('animateTransform', { attributeName: 'transform', type: 'rotate', values: '0;-15;10;0', dur: '0.6s', fill: 'freeze', begin: 'indefinite' }, g);
    g.querySelectorAll('animate, animateMotion, animateTransform').forEach((a) => a.beginElement());
    await tunggu(600);
    g.remove();
  }

  // -------------------------------------------------------------------
  // Sistem idle — aktivitas ringan saat tidak ada pemeriksaan
  // -------------------------------------------------------------------
  let sedangIdle = false;
  let idleBatal = false;
  let idleWakeup = null;     // callback untuk membatalkan tungguIdle
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

  /** Tunggu yang bisa dibatalkan oleh hentikanIdle(). */
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

  // --- Aksi idle individual ---

  async function idleDiam() {
    // Duduk diam, sesekali menghela napas
    if (idleBatal) return;
    await tungguIdle(2000 + Math.random() * 3000);
  }

  async function idleMinumKopi() {
    if (idleBatal) return;
    pemeriksa.ikon('kopi');
    pemeriksa.setEkspresi('senyum');
    await tungguIdle(1800);
    if (idleBatal) return;
    pemeriksa.ikon(null);
    pemeriksa.setEkspresi('normal');
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
    const idx = nomorObrolan++ % OBROLAN_IDLE.length;
    const [kataP, kataQ] = OBROLAN_IDLE[idx];
    hadap(pemeriksa, qa);
    await ucap(pemeriksa, kataP, { tahan: 600 });
    if (idleBatal) return;
    hadap(qa, pemeriksa);
    await ucap(qa, kataQ, { tahan: 600 });
    if (idleBatal) return;
    pemeriksa.setEkspresi('normal');
    qa.setEkspresi('normal');
    // Kembali menghadap meja
    pemeriksa.kiri = false;
  }

  async function idleKetik() {
    if (idleBatal) return;
    pemeriksa.kiri = false;
    pemeriksa.setEkspresi('normal');
    const teksBefore = bagian('teks-layar').textContent;
    for (let i = 0; i < 3; i++) {
      if (idleBatal) break;
      layar(TEKS_LAYAR_IDLE[Math.floor(Math.random() * TEKS_LAYAR_IDLE.length)]);
      bagian('layar').setAttribute('fill', '#f4f7ff');
      await tungguIdle(700 + Math.random() * 500);
    }
    if (!idleBatal) {
      layar('');
      pemeriksa.setEkspresi('normal');
    }
  }

  async function idleQABaca() {
    if (idleBatal) return;
    qa.ikon('buku');
    qa.setEkspresi('normal');
    await tungguIdle(2500 + Math.random() * 1500);
    if (idleBatal) return;
    qa.ikon(null);
  }

  async function idleLihatJam() {
    if (idleBatal) return;
    pemeriksa.setEkspresi('normal');
    await ucap(pemeriksa, 'Jam berapa ya…', { tahan: 800 });
    if (idleBatal) return;
    pemeriksa.setEkspresi('normal');
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

  const AKSI_IDLE = [
    { berat: 5, fn: idleDiam },
    { berat: 2, fn: idleMinumKopi },
    { berat: 2, fn: idleQAKopi },
    { berat: 2, fn: idleMengobrol },
    { berat: 1, fn: idleKetik },
    { berat: 1, fn: idleQABaca },
    { berat: 1, fn: idleLihatJam },
    { berat: 1, fn: idleRegangBadan },
  ];

  async function mulaiIdle() {
    if (sedangIdle) return;
    sedangIdle = true;
    idleBatal = false;
    // Pastikan karakter di posisi awal
    if (Math.hypot(pemeriksa.pos.x - TEMPAT.meja.x, pemeriksa.pos.y - TEMPAT.meja.y) > 2) {
      await jalan(pemeriksa, 'meja');
    }
    if (idleBatal) { sedangIdle = false; return; }
    if (Math.hypot(qa.pos.x - TEMPAT.pojokQA.x, qa.pos.y - TEMPAT.pojokQA.y) > 2) {
      await jalan(qa, 'pojokQA');
    }
    if (idleBatal) { sedangIdle = false; return; }
    while (!idleBatal) {
      const aksi = pilihBerbobot(AKSI_IDLE);
      await aksi();
      if (idleBatal) break;
      await tungguIdle(2500 + Math.random() * 3500);
    }
    sedangIdle = false;
  }

  function hentikanIdle() {
    idleBatal = true;
    if (idleWakeup) { idleWakeup(); idleWakeup = null; }
    for (const k of [pemeriksa, qa]) {
      k.rute = [];
      if (k.selesai) { const s = k.selesai; k.selesai = null; s(); }
      k.ucapId = ++nomorUcap;
      k.gelembung.innerHTML = '';
      k.ikon(null);
      k.setEkspresi('normal');
      k.setFrame('diam');
    }
  }

  // -------------------------------------------------------------------
  // Adegan
  // -------------------------------------------------------------------
  const namaDepan = (n) => {
    const d = (n || '').trim().split(/\s+/)[0] || 'Nak';
    return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
  };

  /**
   * Siswa datang: mengetuk pintu, pemeriksa membukakan, masuk, menyerahkan tugas.
   */
  async function datang(nama) {
    // Hentikan idle
    hentikanIdle();
    await tunggu(80);  // beri waktu idle loop keluar

    if (siswa) siswa.hapus();
    qa.ikon(null);
    qa.gelembung.innerHTML = '';
    qa.setEkspresi('normal');
    jalan(qa, 'pojokQA');

    const tampil = penampilan(nama);
    siswa = buatKarakter({ nama, baju: '#f4f4f4', celana: '#6b6f78', rambut: tampil.rambut, H: tampil.H, S: tampil.S, mulai: TEMPAT.luar, warnaLabel: '#c26a12' });
    siswa.ikon('kertas');

    // 1. Siswa berjalan ke depan pintu (pintu masih tertutup)
    await jalan(siswa, 'pintu');

    // 2. Siswa mengetuk pintu
    efekKetuk(240, 258);
    await tunggu(200);
    await ucap(siswa, 'Tok tok! Permisi, Pak.', { tahan: 600 });

    // 3. Pemeriksa bereaksi: kaget, melihat ke pintu
    pemeriksa.ikon('seru');
    pemeriksa.setEkspresi('kaget');
    hadap(pemeriksa, siswa);
    await tunggu(500);
    pemeriksa.ikon(null);
    pemeriksa.setEkspresi('normal');

    // 4. Pemeriksa berjalan ke pintu
    await ucap(pemeriksa, 'Iya, sebentar!', { tahan: 400 });
    await jalan(pemeriksa, 'sambutPintu');

    // 5. Pemeriksa membuka pintu
    hadap(pemeriksa, siswa);
    pintu(true);
    await tunggu(400);

    // 6. Siswa masuk (berjalan ke depan meja), pemeriksa kembali ke meja (bersamaan)
    const siswaJalan = jalan(siswa, 'depanMeja');
    await tunggu(300);   // sedikit jeda supaya terlihat bergantian
    const pemeriksaJalan = jalan(pemeriksa, 'meja');
    await tunggu(600);
    pintu(false);         // tutup pintu setelah siswa lewat
    await siswaJalan;
    await pemeriksaJalan;

    // 7. Saling menghadap & menyapa
    hadap(siswa, pemeriksa);
    hadap(pemeriksa, siswa);
    await ucap(siswa, 'Ini tugas saya, Pak.', { tahan: 800 });
    await ucap(pemeriksa, `Baik, ${namaDepan(nama)}. Bapak periksa dulu, ya.`, { tahan: 700, ekspresiAkhir: 'senyum' });

    // 8. Kertas berpindah tangan (animasi melayang)
    siswa.ikon(null);
    await serahKertas(siswa, pemeriksa);
    pemeriksa.ikon('kertas');
    siswa.setEkspresi('normal');
  }

  async function periksa() {
    pemeriksa.setEkspresi('normal');
    const ke = jalan(pemeriksa, 'server');
    siswa?.ikon('keringat');
    if (siswa) emoteBubble(siswa, '😰');
    await ke;
    pemeriksa.kiri = false;
    pemeriksa.ikon('pikir');
    serverAktif(true);
    gelembungTetap(pemeriksa, 'Menjalankan aplikasi…');
  }

  function kabar(teks) {
    gelembungTetap(pemeriksa, teks.length > 52 ? teks.slice(0, 51) + '…' : teks);
  }

  async function hasil(h) {
    serverAktif(false);
    pemeriksa.ikon(null);
    pemeriksa.gelembung.innerHTML = '';
    siswa?.ikon(null);
    if (h.lulus) {
      pemeriksa.setEkspresi('senyum');
      await jalan(pemeriksa, 'meja');
      if (siswa) hadap(pemeriksa, siswa);
      const kalimat = h.bebas
        ? `Bagus! Tidak ada bug.${typeof h.skor === 'number' ? ` Skornya ${h.skor}.` : ''}`
        : 'Bagus! Semua pemeriksaan lulus.';
      await ucap(pemeriksa, kalimat, { tahan: 500, ekspresiAkhir: 'senyum' });
      if (siswa) {
        siswa.setEkspresi('senyum');
        siswa.lompat = 1.0;
        konfeti(siswa.pos.x, siswa.pos.y);
        efekLulus(siswa, h.skor);
        emoteBubble(siswa, '🎉');
        await ucap(siswa, 'Yeay! Terima kasih, Pak!', { tahan: 700, ekspresiAkhir: 'senyum' });
      }
      ikonSementara(pemeriksa, 'centang');
    } else {
      pemeriksa.setEkspresi('kaget');
      const jumlah = h.bug ?? 0;
      const qaJalan = jalan(qa, 'sampingServer');
      await qaJalan;
      qa.kiri = false;
      qa.ikon('kaca');
      await ucap(qa, jumlah ? `Ketemu ${jumlah} bug!` : 'Ada yang belum lulus!', { tahan: 400 });
      pemeriksa.setEkspresi('normal');
      await jalan(pemeriksa, 'meja');
      if (siswa) hadap(pemeriksa, siswa);
      await ucap(pemeriksa, jumlah
        ? `Masih ada ${jumlah} bug. Lihat laporannya, ya.`
        : 'Belum lulus. Lihat laporannya, ya.', { tahan: 500 });
      if (siswa) {
        siswa.setEkspresi('sedih');
        emoteBubble(siswa, '😥');
        await ucap(siswa, 'Baik, Pak. Saya perbaiki dulu.', { tahan: 600, ekspresiAkhir: 'sedih' });
      }
      ikonSementara(pemeriksa, 'seru');
    }
    pulang();
  }

  function ikonSementara(k, nama, ms = 3500) {
    k.ikon(nama);
    clearTimeout(k.timerIkon);
    k.timerIkon = setTimeout(() => k.ikon(null), ms);
  }

  async function pulang() {
    const k = siswa;
    if (!k) return;
    await tunggu(300);
    await jalan(k, 'pintu');
    pintu(true);
    await jalan(k, 'luar');
    pintu(false);
    if (siswa === k) siswa = null;
    k.hapus();
    // Kembali ke mode idle
    mulaiIdle();
  }

  // -------------------------------------------------------------------
  // Papan & layar
  // -------------------------------------------------------------------
  function papan(namaLulus) {
    const terbaru = namaLulus.slice(-6);
    bagian('papan').innerHTML = terbaru.map((_, i) => {
      const x = 18 + (i % 3) * 48, y = 66 + Math.floor(i / 3) * 30;
      return `<rect x="${x}" y="${y}" width="44" height="26" fill="${WARNA_CATATAN[i]}"/>
        <text x="${x + 22}" y="${y + 16}" font-size="6.5" text-anchor="middle" fill="#333" font-family="monospace"></text>`;
    }).join('');
    bagian('papan').querySelectorAll('text').forEach((t, i) => {
      const nama = terbaru[i];
      t.textContent = nama.length > 10 ? nama.slice(0, 9) + '…' : nama;
    });
    const nyala = Math.min(6, namaLulus.length);
    bagian('led').innerHTML = [0, 1, 2, 3, 4, 5].map((i) => {
      const aktif = i < nyala;
      return `<rect x="410" y="${60 + i * 18}" width="36" height="12" fill="#2b2d33"/>
        <rect x="414" y="${64 + i * 18}" width="5" height="4" fill="${aktif ? '#4be38a' : '#5a5d66'}">
          ${aktif ? `<animate attributeName="opacity" values="1;.3;1" dur="${0.6 + i * 0.17}s" repeatCount="indefinite"/>` : ''}
        </rect>`;
    }).join('');
  }

  function layar(teks) {
    bagian('layar').setAttribute('fill', teks ? '#f4f7ff' : '#3a4258');
    bagian('teks-layar').textContent = teks.length > 18 ? teks.slice(0, 17) + '…' : teks;
  }

  function reset() {
    hentikanIdle();
    if (siswa) { siswa.hapus(); siswa = null; }
    for (const k of [pemeriksa, qa]) { k.ikon(null); k.gelembung.innerHTML = ''; k.setEkspresi('normal'); k.rute = []; }
    pemeriksa.pos = { ...TEMPAT.meja };
    qa.pos = { ...TEMPAT.pojokQA };
    serverAktif(false);
    layar('');
    // Mulai idle setelah reset
    mulaiIdle();
  }

  papan([]);
  mulaiIdle();
  return { datang, periksa, kabar, hasil, papan, layar, reset, pemeriksa, qa };
}
