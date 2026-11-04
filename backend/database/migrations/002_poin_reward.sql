USE bank_sampah;

ALTER TABLE jenis_sampah
  CHANGE COLUMN harga_per_satuan harga_per_satuan_arsip BIGINT NULL,
  ADD COLUMN poin_per_satuan BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER satuan;

ALTER TABLE rincian_setoran
  CHANGE COLUMN harga_per_satuan harga_per_satuan_arsip BIGINT NULL,
  CHANGE COLUMN nominal nominal_arsip BIGINT NULL,
  ADD COLUMN poin_per_satuan BIGINT UNSIGNED NULL AFTER jumlah,
  ADD COLUMN poin_didapat BIGINT UNSIGNED NULL AFTER poin_per_satuan;

RENAME TABLE
  pengajuan_pencairan TO arsip_pengajuan_pencairan,
  transaksi_saldo TO arsip_transaksi_saldo;

ALTER TABLE notifikasi
  MODIFY jenis ENUM('setoran', 'saldo', 'poin', 'penukaran', 'sistem') NOT NULL;
