# Hexa Pinball

Prototipe hybrid-casual: **Hexa Sort × pinball** (SORT × ARCADE_HOOK, fusi lewat transformasi objek). Hexa Sort di bawah, ruang pinball di atas. 10 tile sewarna tidak hilang: memampat, berubah jadi bola, naik pipa, lalu ditembak plunger ke meja. Bola cuma merusak target sewarna. Satu pita target habis, sinar turun, satu sel hex yang kegembok kebuka. Papan mulai dengan 14 sel yang bisa dipakai + 5 kegembok, jadi **ruang adalah mata uangnya**.

Ini rekonstruksi dari catatan 7 Sep 2026 (file aslinya terhapus). Vite + TypeScript + Phaser 3, tanpa physics engine (solver lingkaran sendiri, ber-seed, bisa di-step). Semua art dan suara procedural.

## Cara main

- Drag stack dari baki ke sel hex kosong. Bisa juga tap stack, lalu tap sel.
- Stack bertetangga yang warna atasnya sama saling gabung, berantai (combo).
- 10 tile atau lebih sewarna di atas sebuah stack berubah jadi satu bola dan ditembak ke meja.
- Bola cuma merusak pita yang warnanya sama. Hit sewarna beruntun oleh satu bola makin keras (1, 2, 3).
- Pita habis: sinar turun dan membuka satu sel kegembok (+1 sel).
- Chip warna di bawah progress bar: warna yang dicoret tidak dibutuhkan meja. Tetap sah dimainkan dan tetap jadi bola, tapi bolanya tidak merusak apa-apa.
- **Menang**: kelima pita habis. **Kalah**: papan penuh dan tidak ada bola atau sinar yang masih bisa membuka sel. Tidak ada timer.

Level: 1 Warm Up, 2 Dead Colour, 3 Tight Board. Lompat langsung pakai `?level=2`. Tombol ↻ restart (atau tombol R), ♪ mute.

## Menjalankan

```bash
npm install
npm run dev        # http://localhost:5191
npm run build      # tsc + vite build ke dist/ (base './', bisa dibuka dari subfolder)
npm run validate   # 29 assertion headless, termasuk 9 tes penerimaan dari brief
npm run inspect    # peta panas lalu lintas bola, 160 peluncuran, meja utuh
```

Harness di browser: `window.__hxp` dengan `place(slot)`, `placeAt(cell, slot)`, `ball(colour, viaPipe)`, `unlock(cell)`, `step(n)`, `state()`, plus `pause()`, `resume()`, `level(n)`. Contoh: `__hxp.pause(); __hxp.place(0); __hxp.step(120); __hxp.state()`.

Hasil terakhir:

- `validate`: 29/29 lolos. Bot greedy menang 16/16 seed di tiap level (~45, ~55, ~67 penempatan). Bot acak: L1 16/16, L2 9/16, L3 0/16, jadi penempatan memang bisa salah.
- `inspect`: first-hit terbanyak di satu target 26%, sentuhan terbanyak 51%, target paling sepi tetap 13%, 98% bola sampai ke sisi kiri, 0 bola balik ke lorong plunger.

## Catatan rekonstruksi

Pilihan di bagian yang catatannya diam, dan bagian yang sengaja beda:

- **Papan**: hex radius 2 (19 sel) = 14 terbuka + 5 kegembok, di semua level. Sel kegembok dibuka berurutan (bawah, kiri, kanan, kiri atas, kanan atas).
- **Aturan gabung**: tile selalu mengalir *ke* stack yang sedang di-resolve, dimulai dari stack yang baru ditaruh. Tetangga yang warna atasnya berubah ikut di-resolve (berantai). Top run 10+ keluar jadi satu bola. Aturan ini murni graf integer, jadi papan 100% deterministik.
- **Baki**: 3 stack, diisi ulang setelah ketiganya terpakai. Tinggi stack 3 sampai 5 tile, 1 sampai 3 run warna, dari RNG ber-seed.
- **Meja**: tanpa flipper, pemain cuma mengontrol amunisi (warna). Kekuatan plunger diacak dengan seed. Mulut lorong plunger diberi gerbang satu arah, bumper cuma di bagian bawah (koridor masuk bersih).
- **"5 pita berselang-seling"** ditafsirkan sebagai 5 baris target (5, 4, 5, 4, 5) yang posisinya selang-seling. Satu pita = satu grup warna = satu sel kegembok.
- **HP dipool per pita**: hit sewarna di target mana pun di pita itu mengurangi HP pita. Versi HP per target bikin akhir level jadi grinding (target pojok cuma kena sekitar 10% bola).
- **Pita yang habis jadi pasak abu-abu** yang tetap memantulkan bola, supaya bentuk meja (dan peta panasnya) sama sepanjang level.
- **Target sewarna memantul seperti pop bumper**, dan hit beruntun oleh satu bola damage 1, 2, 3 (maksimal 3). Ini eskalasi combo dari aturan juice Irvan, sekaligus bikin meja "murah hati" seperti temuan aslinya.
- **HP**: L1 24 (pemanasan), L2 34 (angka dari catatan), L3 tetap 34 tapi papannya lebih ketat (5 warna, 2 warna mati, 2 stack sampah di awal). Sesuai temuan: panjang level diatur lewat papan, bukan lewat target.
- **Kalah overflow menunggu meja**: kalau papan penuh tapi masih ada bola atau sinar di jalan, game menunggu dulu (pesan "Waiting on the table").
- **Determinisme**: catatan asli bilang pinball di browser ikut frame delta. Di sini browser juga fixed-step (akumulator 60 Hz), jadi simulasinya identik dengan validator. Yang tetap beda cuma kapan input pemain masuk.
- **Temuan HP tidak sepenuhnya terulang**: aslinya 34 → 41 HP cuma nambah 1 bola. Di sini (`validate`, bagian info) L1 +0.3 bola, tapi L2 dan L3 sekitar +4 bola. Meja rekonstruksi ini lebih pelit dari aslinya di L2/L3, walau panjang level tetap paling ditentukan pasokan warna dari papan.
- **Validator ramping**: 29 assertion, bukan 182, tapi sembilan tes penerimaan (A1 sampai A9) tetap ada.
- **Retry** memakai seed baru (seed level + 101 × percobaan) supaya tidak hafalan. Harness dan validator memakai seed level.
