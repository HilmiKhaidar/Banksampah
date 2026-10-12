# Bank Sampah Sekolah Merdeka — Frontend

Frontend dibangun dengan Next.js, React, dan TypeScript. Login, sesi, akun, profil, jenis sampah, setoran, poin, katalog reward, penukaran, notifikasi, jadwal pengumpulan, preferensi notifikasi, dan foto terhubung ke backend/database.

## Menjalankan aplikasi

Dari folder proyek:

```powershell
cd frontend
npm run dev
```

Buka `http://localhost:3000`.

Validasi:

```powershell
npm run lint
npm run build
```

## Akun dan penyimpanan

- Peserta didik tidak mendaftar sendiri. Pengelola mengimpor data siswa dari CSV atau Excel `.xlsx` dengan kolom `NISN` dan `Nama`; `Kelas` bersifat opsional.
- Setiap akun hasil impor mendapat kata sandi sementara acak dan harus menggantinya setelah login pertama. Daftar kredensial hanya ditampilkan sekali setelah impor; simpan dan bagikan secara pribadi.
- Akun pengelola disiapkan melalui backend.
- Tidak ada akun atau data contoh bawaan.
- Akun, sesi, dan data bisnis (jenis sampah, setoran, poin, reward, penukaran, dan notifikasi) disimpan di database backend dan tersinkron antar perangkat.
- Nomor WhatsApp pengelola menggunakan data profil akun di database; preferensi notifikasi juga tersimpan per akun di database.
- Foto setoran dan foto jenis sampah yang diunggah disimpan di MySQL dan dapat dilihat dari perangkat lain setelah masuk.
- Profil akun hanya di-cache di memori. Cache akun/sesi versi lama dibersihkan saat inisialisasi; cache bisnis versi lama dibersihkan setelah data backend berhasil dimuat.
- Alur aplikasi aktif tidak membaca atau menulis data bisnis ke `localStorage`.

## Fitur prototipe

Dashboard tidak berisi data contoh. Pengelola dapat mengelola peserta, menetapkan tarif poin per satuan untuk tiap jenis sampah (kg/liter), memeriksa pengajuan, memasukkan berat/volume aktual, lalu menyetujui atau menolak setoran. Setoran yang disetujui menghasilkan poin berdasarkan jumlah aktual dikalikan tarif; pecahan poin dibulatkan ke bawah. Pengelola juga dapat mengelola katalog reward barang atau uang, menyetujui/menolak penukaran, dan menandai reward yang diserahkan manual sebagai selesai.

Di katalog jenis sampah, pengelola dapat memilih ikon yang disarankan otomatis dari nama sampah atau mengunggah foto sebagai visual. Foto dikompres di browser, diunggah, lalu disimpan di MySQL. Pengelola juga dapat mengatur perkiraan nilai rupiah per poin dari menu Pengaturan; peserta melihat perkiraan nominal di bawah jumlah poin dan berapa poin yang kira-kira diperlukan untuk mencapai Rp10.000. Nilai ini hanya informasi, bukan saldo uang atau pencairan tunai.

Peserta dapat memilih beberapa jenis sampah, mengunggah hingga lima foto, membatalkan pengajuan yang belum diperiksa, melihat poin dan riwayatnya, serta mengajukan penukaran reward dari katalog. Poin pada pengajuan penukaran yang masih menunggu ditahan; poin baru digunakan saat pengelola menyetujui. Penolakan melepaskan poin yang ditahan. Penyerahan barang maupun uang dilakukan manual oleh pengelola; tidak ada integrasi pembayaran.

Peserta juga dapat melihat ranking poin setoran bulan berjalan. Ranking menampilkan semua peserta aktif, memberi peringkat yang sama jika jumlah poin seri, dan tidak mengurangi skor saat poin ditukar dengan reward.

Profil menyediakan data akun, ubah kata sandi, preferensi notifikasi, pengaturan kontak WhatsApp pengelola, bantuan, dan keluar. Foto setoran dikompres di browser sebelum dikirim dan disimpan di MySQL. Data saldo/transaksi rupiah dari versi prototipe lama tidak dikonversi menjadi poin.

## Mencoba alur lokal

1. Masuk sebagai pengelola, tambahkan jenis sampah, pilih satuan kg atau liter, dan tetapkan tarif poin per satuan.
2. Tambahkan reward barang atau uang beserta biaya poinnya.
3. Sebagai pengelola, impor data siswa dan bagikan kata sandi sementara secara pribadi. Peserta login dengan NISN, mengganti kata sandi, lalu mengajukan setoran dengan jenis sampah dan foto.
4. Masuk kembali sebagai pengelola untuk memasukkan berat/jumlah aktual dan menyetujui setoran; poin akan ditambahkan otomatis.
5. Sebagai peserta, ajukan penukaran dari katalog. Pengelola menyetujui atau menolak lalu, setelah penyerahan manual, menandai penukaran selesai.

Jalankan backend dan frontend, lalu masuk dengan akun yang sudah disiapkan; tidak ada akun demo atau data uji yang dibuat otomatis.

## Struktur sumber

- `src/app/` berisi route Next.js, layout, dan stylesheet global.
- `src/components/ui/` berisi komponen antarmuka umum yang dapat dipakai lintas fitur.
- `src/features/workspace/` berisi shell aplikasi setelah autentikasi dan komposisi tampilan.
- `src/features/notifications/` dan `src/features/rewards/` berisi komponen dan stylesheet khusus untuk fitur tersebut.
- `src/lib/` berisi autentikasi, klien API, tipe data, dan validasi.

Saat menambah fitur, letakkan UI dan stylesheet spesifik di `src/features/<nama-fitur>/`; pertahankan komponen generik di `src/components/` dan aturan/operasi data di `src/lib/`. Pemisahan tampilan workspace lainnya dapat dilanjutkan bertahap agar perubahan tetap terisolasi dan mudah divalidasi.
