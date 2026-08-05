# Integrasi Provider AI (Gemini, OpenAI, dll)

## Aturan Utama: Jangan Asumsikan Ketersediaan Model

**Kasus nyata yang melatarbelakangi aturan ini:** dropdown pemilihan model pernah menampilkan SEMUA model yang secara umum ada di provider (misal Gemini), padahal API key yang dipakai user (misal free tier) sebenarnya tidak bisa mengakses sebagian model tersebut. Akibatnya user bisa pilih model yang kelihatan ada di UI tapi gagal dipakai — membingungkan, karena tidak ada indikasi mana yang beneran bisa diakses.

Aturan ke depannya:

1. **Verifikasi, jangan hardcode.** Daftar model yang ditampilkan ke user HARUS berdasarkan hasil pemanggilan endpoint resmi provider (Gemini: ListModels; OpenAI: `GET /v1/models`) menggunakan API key yang sedang aktif — bukan daftar statis yang ditulis manual di kode.
2. **Refresh saat key berubah.** Setiap kali user memasukkan/mengganti API key, daftar model yang tersedia harus di-refresh dari provider, bukan pakai cache dari key sebelumnya.
3. **Gagal secara jelas, bukan diam-diam fallback.** Kalau pemanggilan list-model gagal (network error, key invalid), tampilkan error yang jelas ke user. JANGAN diam-diam fallback ke daftar hardcoded lama yang tidak terverifikasi — itu justru mengembalikan bug yang sama.
4. **Deteksi model yang jadi tidak valid.** Kalau user sudah pernah pilih model default tapi ternyata model itu hilang dari hasil list-model terbaru (misal key diganti, atau provider deprecate model tersebut), beri peringatan jelas — jangan biarkan app diam-diam terus memakai model yang sudah tidak valid.
5. **Tangani error rate-limit/quota secara spesifik.** Kalau provider mengembalikan error karena kuota habis atau rate limit, tampilkan pesan yang membedakan ini dari error API key salah — pesan generik "AI tidak merespons" tidak cukup jelas untuk user menentukan langkah selanjutnya.

## Kenapa Aturan Ini Penting

Provider AI (Gemini, OpenAI) sering punya perbedaan akses antar tier (free vs paid/billing-enabled), dan daftar model yang tersedia bisa berubah dari waktu ke waktu (model baru rilis, model lama di-deprecate). Kode yang menghardcode daftar model akan selalu basi cepat atau lambat — solusi yang benar adalah selalu tanya ke provider-nya langsung, bukan menyimpan asumsi di kode.
