# Pola Kerja: Investigasi → Laporan → Konfirmasi → Eksekusi

Default agent biasanya langsung eksekusi begitu diberi instruksi. Untuk project ini, itu HANYA boleh untuk task yang kecil dan scope-nya sudah 100% jelas. Untuk task lain, ikuti urutan berikut.

## Kapan Wajib Berhenti Dulu untuk Konfirmasi

- Root cause bug belum jelas / gejalanya bisa disebabkan lebih dari satu hal
- Perubahan akan menyentuh lebih dari 2-3 file sekaligus
- Ada aksi yang MERUSAK/MENGHAPUS data yang sudah ada (termasuk: hapus file lokal, migrasi data, overwrite settings user)
- Ada keputusan produk/UX yang tidak eksplisit disebutkan di instruksi (misal: "kalau app sudah jalan dan user buka file lain, apakah buka window baru atau load ke window yang sama?" — ini pilihan desain, bukan sesuatu yang boleh diasumsikan sepihak)
- Instruksi dari user bersifat terbuka/luas ("perbaiki semua", "tambah fitur berguna") — pecah dulu jadi temuan konkret sebelum eksekusi apa pun

## Urutan yang Diharapkan

1. **Investigasi** — baca kode yang relevan, jangan menebak dari nama file saja
2. **Laporkan** — sebutkan apa yang ditemukan, rencana perubahan, dan pertanyaan (kalau ada keputusan yang butuh input user)
3. **Tunggu konfirmasi** — jangan lanjut ke langkah 4 sebelum user merespons, kecuali instruksi awal eksplisit bilang "langsung eksekusi tanpa menunggu"
4. **Eksekusi bertahap** — untuk perubahan besar, kerjakan per-bagian, bukan sekaligus semua file dalam satu jalan tanpa checkpoint
5. **Build & laporkan** — build project, laporkan file yang diubah dan hasil test/build-nya

## Larangan Scope Creep

- Jangan menambah fitur, mengubah UI, atau "merapikan" kode yang tidak diminta dan tidak terkait langsung dengan task yang diberikan — meskipun niatnya baik. Kalau melihat sesuatu yang menurut agent worth diperbaiki di luar scope, LAPORKAN sebagai saran terpisah, jangan langsung dieksekusi bersamaan.
- Untuk instruksi luas seperti "audit semua dan perbaiki" — defaultnya adalah READ-ONLY audit dulu (hasilkan laporan), BUKAN audit-sekaligus-perbaiki-semua dalam satu jalan, kecuali user secara eksplisit bilang "langsung perbaiki semua yang ditemukan tanpa perlu saya review dulu".
