USE bank_sampah;

ALTER TABLE jenis_sampah
  ADD COLUMN tipe_gambar ENUM('image/jpeg', 'image/png', 'image/webp') NULL AFTER url_gambar,
  ADD COLUMN data_gambar MEDIUMBLOB NULL AFTER tipe_gambar;

ALTER TABLE foto_setoran
  MODIFY COLUMN url_gambar VARCHAR(500) NULL,
  ADD COLUMN nama_berkas VARCHAR(255) NOT NULL DEFAULT 'foto.jpg' AFTER url_gambar,
  ADD COLUMN tipe_konten ENUM('image/jpeg', 'image/png', 'image/webp')
    NOT NULL DEFAULT 'image/jpeg' AFTER nama_berkas,
  ADD COLUMN data_gambar MEDIUMBLOB NULL AFTER tipe_konten;
