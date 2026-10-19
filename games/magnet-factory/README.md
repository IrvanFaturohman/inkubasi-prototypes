# Magnet Factory

Prototype hybrid-casual, tag **MAGNET × LOOP_CONV × SORT**. Ini rekonstruksi dari catatan project (prototype asli 6 Sep 2026 filenya hilang). Vite + TypeScript + Phaser 3.90 (Matter.js), semua art procedural, semua suara disintesis WebAudio.

## Game-nya apa

Bola warna jalan muter di konveyor loop. Kamu seret magnet puck (gerakannya spring-follow ke jari), bola di dekatnya ketarik (`strength·(1−d/R)^2`) lalu nempel jadi kluster pegas yang goyang. Bawa kluster ke mesin yang warnanya sama, mesin nyedot bolanya satu-satu dengan nada pentatonik yang naik. 6 bola sewarna dalam satu kali suap = **OVERDRIVE**.

Trade-off sortirnya: magnet narik semua warna. Bola warna salah tetap nempel dan makan kapasitas (8 slot), jadi ngambil rakus itu cepat tapi bikin kluster kotor dan OVERDRIVE susah. Gagal cuma dari overflow (hopper meluber), nggak ada timer.

## Cara main

- Seret di layar untuk gerakin magnet (di HP magnet ada 70 px di atas jari biar nggak ketutup).
- Lewatin belt untuk ngambil bola. Titik warna di atas kluster = isi magnet.
- Bawa ke mesin yang warnanya sama. Combo naik tiap bola: nada, getar layar, dan skor naik bareng.
- Bola warna salah diam di magnet. Taruh magnet di **REJECT** (tengah loop): bola minoritas dilempar balik ke belt, -5 skor per bola.
- Gauge **BELT LOAD**: zona putih = cup belt terisi, zona merah = hopper mulai antri. Hopper lewat garis MAX = **BELT OVERFLOW**, kalah.
- Penuhi **SHIFT QUOTA** untuk clear ronde. Kalah: tap untuk ulang ronde itu.

| Ronde | Warna | Quota | Cup belt | Spawn (detik/bola) |
|---|---|---|---|---|
| 1 Warm-up | 2 | 20 | 22 | 1.5 ke 0.9 |
| 2 Third line | 3 | 26 | 24 | 1.2 ke 0.7 |
| 3 Rush hour | 3 | 34 | 24 | 1.0 ke 0.5 |
| 4 Four lines | 4 | 44 | 26 | 0.8 ke 0.4 |
| 5 Night shift | 4 | 56 | 28 | 0.7 ke 0.32 |

Belt juga makin cepat tiap ronde (70 ke 120 px/s), dan mulai ronde 2 urutan mesin diacak.

## Cara jalanin

```bash
npm install
npm run dev        # dev server
npm run build      # tsc + vite build ke dist/ (base './', aman di sub-path GitHub Pages)
npm run preview
npm run check      # cek otomatis di Chrome headless (butuh build dulu)
```

- Semua angka feel/balance ada di `src/config/GameConfig.ts`. Tekan **D** untuk panel tuning (live, ada tombol pindah ronde dan Copy JSON).
- Hook test: `window.__mf.step(n)` (n step fixed 1/60 s, sinkron, otomatis pindah ke mode manual), `setTarget(x, y)`, `state()`, `tap()`, `restart(ronde)`, `manual(false)` untuk balik real-time.
- `npm run check` jalanin Chrome headless lewat DevTools protocol (tanpa Playwright) dan cuma pakai `__mf.step`, jadi throttling requestAnimationFrame nggak ngaruh. Isinya: bola jalan di belt, bot bisa clear ronde 1, pemain diam kalah karena overflow, hitstop jalan dan pause/resume cuma di transisi, tap setelah kalah ulang ronde, clear ronde 5 masuk layar menang, panel D, plus tabel balance per ronde. Opsi: `--shots <folder>`, `--trace <ronde>`, `--balance-only --tries 3`.

## Catatan rekonstruksi

Yang diambil langsung dari catatan: Vite + Phaser 3 + Matter, spring-follow puck, rumus tarikan, kluster pegas goyang, sedot satu-satu dengan pentatonik naik, OVERDRIVE di 6 sewarna, lima ronde, juice lengkap, bola salah warna tetap nempel, angka di `GameConfig.ts`, panel `D`, dan jebakan `matter.world.resume()`.

Yang harus aku putuskan sendiri:

1. **Jebakan resume()**: Matter nggak di-autoUpdate. Sim manggil `world.step()` sendiri di loop fixed 60 Hz, dan `pause()`/`resume()` cuma dipanggil saat hitstop mulai dan selesai (dicek di `npm run check`: jumlah pause/resume sama dengan jumlah hitstop, bukan per frame).
2. **Overflow**: belt punya cup tetap. Bola baru antri di hopper dan cuma turun kalau ada cup kosong lewat di bawahnya. Hopper muat 4, bola ke-5 = kalah.
3. **Ambil bola dari belt**: cup megang bola pakai pegas, magnet harus narik lebih kuat dari pegangan cup. Hasilnya bola dalam radius 120 px kelihatan goyang ke arah magnet, tapi baru lepas di sekitar 60 px.
4. **Magnet selalu nyala**, tanpa tombol. Kalau penuh, tarikan mati dan bola yang lagi melayang balik ke belt.
5. **Kluster nggak rontok saat diseret cepat**: bola yang nempel ikut 85% percepatan puck (`cluster.carry`), pegas cuma ngurus goyangnya. Tanpa ini kluster 8 bola tinggal 1 sampai mesin.
6. **Buang bola salah = pad REJECT** di tengah loop. Yang disimpan warna mayoritas (seri: warna yang nempel duluan), sisanya dilempar balik ke cup kosong terdekat, -5 skor per bola. Kalau belt penuh, bolanya masuk hopper (bisa bikin overflow). Awalnya aku kirim semua ke hopper, tapi itu bikin kalah instan walau belt baru setengah isi, jadi diganti.
7. **Arti "6 sewarna"**: 6 bola dalam satu sesi suap di satu mesin (combo reset kalau magnet keluar dari mesin lebih dari 0.45 s). Efek OVERDRIVE juga nggak ada di catatan, jadi aku pilih: +100, skor x2 selama 3.2 s, dan mesin nyedot sampai 5 bola warnanya langsung dari belt (hadiah sortir rapi yang ngurangin tekanan overflow).
8. **Combo**: per sesi suap. Skor = 10 × combo, nada naik satu step pentatonik per bola dan nada dasarnya ikut naik sesuai progres quota, shake dan partikel ikut membesar.
9. **Hitstop** 90 ms tiap bola masuk mesin, 160 ms untuk OVERDRIVE, 0 untuk bola sedotan OVERDRIVE (biar jadi arpeggio cepat).
10. **Busur gravitasi**: semua bola terbang (ke mesin, dari hopper ke belt, lemparan REJECT) pakai lintasan balistik beneran, bukan tween linear.
11. **Feedback salah warna**: kalau bola cocok sudah habis disedot dan masih ada bola lain, bola itu kedip merah, bunyi "bonk", getar, dan teks WRONG COLOUR.
12. **UI dari objek nyata**: gauge tekanan untuk beban belt, chute hopper dengan garis MAX, pintu REJECT bergaris hazard, mesin berbentuk corong.
13. **Clear ronde**: sisa bola di belt otomatis disedot ke mesinnya sebagai selebrasi (tanpa poin). Kalah: tap untuk ulang ronde, skor balik ke awal ronde.
14. **Balance** disetel pakai bot "mirip manusia" (keputusan tiap 0.4 s, jari maks 1000 px/s, meleset sekitar 18 px): ronde 1 sampai 4 clear, ronde 5 kadang kalah. Manusia kemungkinan lebih lambat dari bot, jadi ronde 4 sampai 5 perlu playtest beneran. Tuas utamanya `spawnStart`/`spawnEnd` dan `overdrive.purgeMax`.
15. Hint teks di ronde 1, canvas di-render 2x (camera zoom) supaya tajam di HP, layar desktop ditaruh di frame HP.
