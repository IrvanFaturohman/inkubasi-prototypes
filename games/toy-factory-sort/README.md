# Toy Factory Sort

Prototype hybrid-casual SORT x LOOP_CONV, versi "payoff-first". Ini rekonstruksi dari catatan proyek 7 Sep 2026 (file aslinya hilang). Loop one-tap dari brief dipertahankan, yang diubah cuma fantasy (pabrik mainan), bentuk part (potongan mainan), animasi mesin, dan payoff (mainan jadi nyembur ke rak dispatch).

Pertanyaan yang mau dijawab: apakah rakitan mainan yang kelihatan bikin loop yang sama jadi lebih memuaskan?

## Cara main

- Ada 4 bin di atas. Tap bin untuk menjatuhkan part paling bawah. Urutan isi bin tetap.
- Part jatuh ke belt utama. Mesin di bawah belt menyedot part yang warnanya sama dengan lampu mesin.
- 3 slot penuh: mesin ngunci kira-kira 1 detik, goyang, merakit, lalu mainan jadi terlempar ke rak DISPATCH.
- Tiap mesin punya tiket NEXT: setelah satu mainan selesai, mesin ganti ke order berikutnya.
- Part yang lewat tanpa diambil jatuh ke RETURN LINE, naik lift, lalu balik ke belt utama.
- Gauge BELT LOAD menunjukkan isi belt. Tap saat belt penuh = overflow = shift gagal. Belt penuh dan tidak ada part yang bisa dipakai mesin = macet = gagal juga. Tidak ada timer.
- 5 shift, kapasitas belt 10, 9, 8, 7, 6.
- Desktop: tombol 1 sampai 4 untuk tap bin, R untuk ulang. `?level=3` untuk langsung ke shift 3.

## Menjalankan

```bash
npm install
npm run dev       # buka URL yang muncul, di HP pakai alamat network
npm run build     # tsc + vite build ke dist/
npm run verify    # cek headless (butuh Google Chrome, atau set CHROME_PATH)
```

`npm run verify` menjalankan build di `vite preview`, membuka Chrome headless, lalu bot memainkan game lewat `window.__tfs`:

- semua 5 shift harus tamat, semua intake terjadi di tinggi belt, tidak ada mainan nyangkut di udara;
- tes recirculate: part sengaja dibuang supaya lewat RETURN LINE dan lift, harus jadi `riding` lagi lalu diambil mesin;
- spam tap harus berakhir gagal (overflow).

Harness tes: `__tfs.step(n)` (sinkron, 1 tick = 1/60 detik, sekali dipanggil game pindah ke mode manual), `__tfs.tap(i)`, `__tfs.state()`, plus `__tfs.level(i)` dan `__tfs.realtime()`.

## Catatan rekonstruksi

Catatan aslinya tidak menjelaskan hal di bawah ini, jadi ini keputusan saya:

1. **Layout.** Belt utama di atas, jalan kiri ke kanan, 3 mesin menggantung di bawahnya dengan hatch di permukaan belt. Di ujung kanan part jatuh lewat chute ke RETURN LINE (kanan ke kiri), lalu lift di kiri membawa naik dan menjatuhkannya lagi ke belt utama. Jadi part hasil recirculate benar-benar mendarat ulang dan `markLanded()` dipanggil lagi tiap mendarat (tanpa guard sekali-jalan).
2. **Mesin pakai antrian order warna**, bukan satu warna tetap. Ini yang bikin ada part "yang gak dibutuhin" (warnanya belum punya mesin) yang harus dibuang dulu ke belt. Order berikutnya terlihat di tiket NEXT.
3. **Pencocokan cuma warna.** Tiap warna = satu jenis mainan (Robot merah, Car biru, Duck kuning, Frog hijau, Rocket ungu, Bear pink), part-nya berbentuk dasar, badan, atau kepala. Part mengisi slot bentuknya kalau kosong, kalau tidak ke slot kosong lain. Bentuk tidak memengaruhi aturan.
4. **Level.** 4 bin di semua shift, 3 mesin. Warna 3, 4, 5, 5, 6. Mainan 6, 8, 9, 11, 12. Isi bin digenerate dari seed tetap (sama tiap dibuka) lalu dicek solver greedy supaya puncak part parkir di belt tetap di bawah kapasitas.
5. **Kondisi gagal.** Tap saat belt sudah penuh langsung overflow. Ditambah deteksi macet: belt penuh, tidak ada mesin yang sedang kerja, dan tidak ada part di belt yang bisa diambil selama 0,5 detik.
6. **Angka.** Lock 1,0 detik, ganti order 0,4 detik, belt utama 200 px/s, return line 420 px/s, satu putaran penuh sekitar 6 detik, jendela intake 16 px kiri kanan hatch, gate bin 0,25 detik (supaya dua drop tidak menumpuk).
7. **Determinisme.** Simulasi jalan di tick tetap 60 Hz, dan world Arcade di-step manual di dalam tick yang sama, jadi `step(n)` hasilnya sama walau tab di background. Semua yang menentukan gameplay (intake, lock, terbangnya mainan ke rak) dihitung di tick, bukan lewat tween. Tween cuma kosmetik dan pakai `tweens.add` bersarang, tidak pakai `tweens.chain()`.
8. **Juice.** Suara WebAudio sintetis: slot mesin menumpuk jadi akor pentatonik (1 part satu nada, 2 part akor belum selesai, 3 part lengkap), nada dasar naik seiring progres shift. Hitstop 5 tick (sekitar 83 ms) saat mainan jadi, shake sesuai besar kejadian, combo "RUSH xN" kalau mainan selesai beruntun dalam 2,6 detik (nada dan partikel ikut naik), squash and stretch saat mendarat, overshoot elastis, getar lewat `navigator.vibrate`.
9. **UI dari objek nyata pabrik**, bukan juice generik: bin plastik berlabel, lampu dan tiket work order di mesin, gauge analog BELT LOAD, header berstrip hazard, rak DISPATCH, slip dispatch untuk menang dan laporan "LINE JAMMED" untuk gagal. Partikelnya serpihan plastik warna mainan dan uap dari mesin press.
