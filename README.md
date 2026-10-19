# Prototype Inkubasi

Kumpulan greybox prototype dari masa inkubasi (September 2026) yang file aslinya sempat kehapus dari laptop. Semua bisa dimainin di browser, paling enak di HP mode portrait.

**Main:** https://irvanfaturohman.github.io/inkubasi-prototypes/

| Game | Tanggal asli | Gabungan | Asal kode |
|---|---|---|---|
| [Magnet Factory](games/magnet-factory) | 6 Sep | Magnet x loop conveyor x sort | Dibikin ulang dari catatan desain |
| [Toy Factory Sort](games/toy-factory-sort) | 7 Sep | Sort x loop conveyor (payoff-first) | Dibikin ulang dari catatan desain |
| [Hexa Pinball](games/hexa-pinball) | 7 Sep | Hexa Sort x pinball | Dibikin ulang dari catatan desain |
| [Arrow Orbit](games/arrow-orbit) | 7 Sep | Launch x incremental | Dibikin ulang dari catatan desain |
| [Popcorn Pop!](games/popcorn-pop) | 23 Sep | Idle multi-kios x mesin popcorn | Dipulihin dari kode asli |
| [Harvest Circuit](games/harvest-circuit) | 23 Sep | Galactic Merge x panen | Dipulihin dari kode asli |
| [Kota Bercabang](games/kota-bercabang) | 24 Sep | Galactic Merge x jalan bercabang | Dipulihin dari riwayat git Loop Builders (commit 262fda5) |
| [Toy Block Demolition](games/toy-block-demolition) | 28 Sep | Rasa ala Stone Grass, truk penghancur balok | Dipulihin dari kode asli |

"Dipulihin dari kode asli" artinya file-nya disusun ulang persis dari riwayat pengerjaan, jadi isinya sama kayak versi aslinya. "Dibikin ulang dari catatan desain" artinya kode aslinya udah hilang total, jadi game-nya ditulis ulang dari catatan desain yang tersisa. Aturan mainnya mengikuti catatan itu, tapi detailnya bisa beda dari versi aslinya. Bagian "Catatan rekonstruksi" di README tiap game nyebutin apa aja yang diputusin ulang.

## Struktur

- `games/<nama>/`: tiap game project Vite sendiri (`npm install`, `npm run dev`, `npm run build`).
- `index.html`: halaman hub yang ngelink ke semua game.
- `scripts/build-site.sh`: build semua game ke `site/`.
- `scripts/deploy.sh`: build lalu push `site/` ke branch `gh-pages`.
