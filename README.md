# Prototype Inkubasi

Kumpulan 28 greybox prototype dari masa inkubasi (September - Oktober 2026). Semua bisa dimainin di browser, dan tiap game punya link sendiri. Paling enak dimainin di HP, mode portrait.

**Hub:** https://irvanfaturohman.github.io/inkubasi-prototypes/

Link tiap game: `https://irvanfaturohman.github.io/inkubasi-prototypes/<nama-folder>/`, misalnya `.../magnet-factory/` atau `.../cubeaway/`.

## Asal kode

| Label | Artinya | Game |
|---|---|---|
| Versi asli dari artifact | Prototype satu file yang dulu dibikin sebagai artifact claude.ai, disalin apa adanya. Teks riset pasar (angka download, revenue, CPI) dihapus dari 4 halaman awal. | Belt Lab, Four Deep, Clack, Marble TD Factory, Fire Truck Flow, Knock-On Factory, Grain Rush, Slice Falls, Molten Line, Squeeze Street, Suds Line, Rinse & Shine, Shine Reveal, Pet Spa, Treat Pusher, Rubber Duck Bath, Root Tree, Cubeaway, Pop Deck, Crawl Deck |
| Dipulihin dari kode asli | File-nya kehapus dari laptop, lalu disusun ulang persis dari riwayat pengerjaan. Isinya sama kayak versi aslinya. | Popcorn Pop!, Harvest Circuit, Toy Block Demolition, Kota Bercabang (dari commit 262fda5 repo loop-builders) |
| Dibikin ulang dari catatan desain | Kode aslinya hilang total, jadi game-nya ditulis ulang dari catatan desain yang tersisa. Aturan mainnya mengikuti catatan, detailnya bisa beda. Lihat "Catatan rekonstruksi" di README tiap game. | Magnet Factory, Toy Factory Sort, Hexa Pinball, Arrow Orbit |

## Struktur

- `games/<nama>/`: game yang punya project Vite sendiri (`npm install`, `npm run dev`, `npm run build`).
- `artifacts/<nama>/index.html`: prototype satu file, langsung bisa dibuka di browser.
- `index.html`: halaman hub.
- `scripts/build-site.sh`: build semua game dan gabungin ke `site/`.
- `scripts/deploy.sh`: build lalu push `site/` ke branch `gh-pages`.
