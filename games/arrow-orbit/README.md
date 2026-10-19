# Arrow Orbit

Prototype hybrid casual: **LAUNCH × INCREMENTAL**. Satu tap timing di meteran daya, terus
nonton 6 sampai 10 detik. Panah ruas-ruasan meluncur 50°, nancep ke tanah, mantul, nyapu
tumpukan peti, kena trampolin, berhenti. Jarak + kehancuran jadi koin, koin jadi upgrade
**POWER / BOUNCE / LENGTH**. Progress kesimpen di `localStorage`, karena progression-nya
memang core loop-nya.

Vite + TypeScript + Three.js + Rapier 3D (`@dimforge/rapier3d-compat`). Portrait 9:16,
semua gambar dan suara prosedural, nol aset, nol CDN.

## Cara main

- Panah di busur ketarik maju-mundur, ikut jarum di **meteran clicker** di bawah.
- **Tap** (atau Space) pas ujung panah masuk zona hijau. Zona merah di belakang bilah clicker
  = **CLICK!** rilis bersih, +6% kecepatan.
- Di udara gak ada kontrol. Tonton aja: pita meteran di kanan atas, turus kehancuran di
  bawahnya.
- Scorecard muncul pas panah berhenti. Tap buat nembak lagi, beli upgrade di label harga.
  - **POWER**: tarikan busur (kecepatan luncur).
  - **BOUNCE**: pantulan ujung karet + kekuatan trampolin.
  - **LENGTH**: nambah ruas panah. Lv1 3 ruas sampai Lv8 10 ruas, tiap ruas rigid body +
    collider beneran. Panah lebih berat nembus tumpukan lebih jauh.

## Jalanin

```bash
npm install
npm run dev        # dev server
npm run build      # tsc --noEmit + vite build -> dist/ (base './', aman di sub-path Pages)
npm run validate   # 152 assertion headless, sim yang sama dengan browser
npm run inspect    # sebaran titik akhir run per chunk 50 m, per band level
```

Harness di browser: `window.__ao` punya `step(n)`, `play(meter)`, `tap()`, `state()`,
`grant(n)`, `buy(id)`, plus `auto(false)` buat matiin stepping real-time supaya cuma
`step()` yang jalan.

## Catatan rekonstruksi

File aslinya hilang, ini dibangun ulang dari catatan memori. Yang dicatat diikuti; yang
gak dicatat dipilih yang paling simpel.

**Ngikutin catatan**
- Spherical joint antar ruas (bukan revolute) + pegas sudut tulis tangan buat kekakuan dan
  limit. CCD keras cuma di kepala, ruas lain soft CCD. Guard batas tiap step: body yang
  keluar koordinat waras, kecepatan gila, atau NaN langsung dibuang sebelum broad phase.
- Validator maksa jumlah collider naik per level LENGTH (Lv1 3, tiap level +1, Lv8 10).
- `npm run inspect` buat nyari "jebakan". Ramp gak boleh punya tumpukan 18 m di depannya
  (pelajaran barrel di kaki tanjakan). Efek upgrade diukur dari band level, bukan satu run.
- Dari Drill Orbit: sudut 50°, squash antisipasi 110 ms, hitstop 18 sampai 100 ms yang
  menang atas slow-mo, near-miss diputus di dalam fixed step (deterministik), area start
  turun landai, slope dibatasi, bayaran jarak sublinear (`3 · d^0.72`).

**Jebakan baru yang ketemu di build ini (rapier3d-compat 0.21)**
- Kunci translasi Z **bareng** kunci rotasi X/Y bikin friction mati total (panah ngeluncur
  tanpa ngerem). Jadi Z gak dikunci, body diproyeksiin balik ke z = 0 tiap step.
- Pegas doang gak kuat nahan rantai 10 body nge-buckle jadi zigzag 180° pas nancep. Pegasnya
  diselesaikan implisit (stabil walau kaku), plus clamp setelah step yang bagi kelebihan
  sudut ke dua ruas. Clamp versi teleport ruas ke anchor malah nyuntik energi (ekor
  kelempar), jadi gak dipakai.
- Hambatan udara eksplisit bisa membalik arah di kecepatan ekstrem, jadi dibatasi.
- Stack yang baru dibuat kebangun semua di step pertama (contact pair baru). Dibiarin satu
  step, terus ditidurin lagi.

**Pilihan sendiri (catatan gak bilang)**
- Max level: POWER 10, BOUNCE 10, LENGTH 8. Harga `base · growth^(lv-1)`.
- Peti pecah kalau momentum panah cukup; panah bayar sebagian momentum, jadi panah berat
  nyapu lebih jauh. Barrel berdiri, karena tumpukan silinder tiduran ngegelinding sendiri.
- Panah yang pelan dan mulai mundur (naik ramp, mantul dari tumpukan) langsung nancep dan
  run selesai. Jarak = titik terjauh kepala. Mundur kebaca bug.
- Trampolin punya sisi miring 22°, biar panah yang ngeluncur naik, bukan nabrak dinding.
- Lintasan 260 m pertama ditaruh tangan, sisanya seed tetap. Koin dibayar pas scorecard
  muncul (reload gak ngilangin run).
- UI diturunin dari lapangan flight archery: range card, pita meteran, turus kehancuran,
  scorecard + stempel NEW RECORD, label harga, papan jarak tiap 50 m, serpihan kayu warna
  peti, titik-titik lintasan. Gak ada angka `+100` melayang.

**Hasil ukur sekarang** (`npm run inspect`, 11 luncuran per band)
- Rata-rata jarak: Lv1 88 m, Lv3 118 m, Lv5 185 m, Lv8 311 m, Max 397 m (maks 512 m).
  Lama nonton rata-rata 5.7 sampai 10.3 detik.
- Upgrade sendiri-sendiri dari Lv3 ke Lv7: POWER +80%, BOUNCE +21%, LENGTH cuma +6% jarak
  tapi +21% koin kehancuran. LENGTH paling lemah dampaknya ke jarak, perlu dinilai.
- Catatan lama nyebut 160 sampai 1000 m di level yang sama; versi ini mentok sekitar 500 m.
- Validator sekarang 152 assertion. Dua belas tes penerimaan dari brief asli gak bisa
  direkonstruksi karena brief-nya ikut hilang.
