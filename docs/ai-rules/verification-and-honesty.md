# Verifikasi & Kejujuran

Aturan ini ada karena AI agent secara default cenderung percaya diri berlebihan — menjawab seolah yakin padahal sebenarnya menebak. Di project ini, itu tidak boleh terjadi.

## Larangan Halusinasi

- **Jangan mengarang API/method/library yang tidak ada.** Sebelum menyebut sebuah fungsi/package tersedia, cek `package.json`, `node_modules`, atau dokumentasi resmi library-nya. Kalau tidak yakin sebuah API benar-benar ada, katakan "perlu saya cek dulu" — jangan tulis kode yang memanggil sesuatu yang belum diverifikasi ada.
- **Jangan klaim "sudah fix" tanpa bukti.** Status "selesai" hanya boleh diberikan setelah: (1) build berhasil, (2) skenario yang jadi laporan bug sudah ditest ulang secara eksplisit dan hasilnya sesuai ekspektasi. Kalau belum sempat build/test, katakan itu dengan jelas — jangan menyamarkan sebagai "sudah selesai".
- **Jangan asumsikan struktur kode yang belum dilihat.** Sebelum mengedit atau merujuk sebuah file, buka dan baca isinya dulu — jangan menebak isi file berdasarkan nama file atau pola umum di project sejenis.

## Pelaporan Temuan yang Jujur

- **Semua temuan dilaporkan, bukan cuma yang diminta.** Kalau task-nya "perbaiki bug A" tapi ketemu bug B, C, D di jalan — laporkan semuanya, biar user yang putuskan mana yang mau dikerjakan sekarang.
- **Beri tingkat keparahan yang jujur**, jangan dibesar-besarkan (biar kelihatan kerja keras) atau diperhalus (biar kelihatan semua baik-baik saja). Gunakan kategori sederhana: Kritis (bisa bikin data hilang/crash/celah keamanan), Sedang (bug fungsional tapi ada workaround), Kecil (kosmetik/edge case jarang).
- **Sertakan lokasi spesifik** (nama file + baris atau nama fungsi) untuk setiap temuan — laporan tanpa lokasi tidak actionable.
- **Kalau tidak yakin sebuah pola adalah bug atau memang disengaja**, tandai sebagai "perlu dikonfirmasi", jangan diam-diam diperbaiki (bisa jadi itu memang perilaku yang diinginkan) atau diam-diam diabaikan (bisa jadi itu memang bug).

## Uncertainty Disclosure

- Kalau ada beberapa kemungkinan root cause dan tidak yakin mana yang benar, sebutkan semua kemungkinannya beserta cara memverifikasinya — jangan pilih satu secara sepihak dan menyajikannya seolah pasti.
- Kalau sebuah fix hanya mengatasi gejala yang dilaporkan tapi root cause sebenarnya masih belum sepenuhnya jelas, katakan itu secara eksplisit di laporan akhir.
