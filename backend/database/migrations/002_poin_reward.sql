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

CREATE TABLE IF NOT EXISTS katalog_reward (
  id CHAR(36) PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  keterangan VARCHAR(300) NOT NULL DEFAULT '',
  jenis ENUM('barang', 'uang') NOT NULL,
  poin_dibutuhkan BIGINT UNSIGNED NOT NULL,
  stok INT UNSIGNED NULL,
  nominal_uang BIGINT UNSIGNED NULL,
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  dibuat_oleh CHAR(36) NOT NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  diperbarui_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_katalog_reward_poin CHECK (poin_dibutuhkan > 0),
  CONSTRAINT chk_katalog_reward_jenis CHECK (
    (jenis = 'barang' AND nominal_uang IS NULL) OR
    (jenis = 'uang' AND nominal_uang > 0 AND stok IS NULL)
  ),
  CONSTRAINT fk_katalog_reward_pembuat FOREIGN KEY (dibuat_oleh)
    REFERENCES akun(id),
  INDEX idx_katalog_reward_aktif_jenis (aktif, jenis)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pengajuan_penukaran (
  id CHAR(36) PRIMARY KEY,
  peserta_id CHAR(36) NOT NULL,
  reward_id CHAR(36) NULL,
  nama_reward VARCHAR(100) NOT NULL,
  jenis_reward ENUM('barang', 'uang') NOT NULL,
  poin_dibutuhkan BIGINT UNSIGNED NOT NULL,
  nominal_uang BIGINT UNSIGNED NULL,
  status ENUM('menunggu', 'disetujui', 'ditolak', 'selesai', 'dibatalkan')
    NOT NULL DEFAULT 'menunggu',
  catatan VARCHAR(500) NOT NULL DEFAULT '',
  ditinjau_oleh CHAR(36) NULL,
  ditinjau_pada TIMESTAMP(3) NULL,
  diserahkan_oleh CHAR(36) NULL,
  diserahkan_pada TIMESTAMP(3) NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  diperbarui_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_pengajuan_penukaran_poin CHECK (poin_dibutuhkan > 0),
  CONSTRAINT chk_pengajuan_penukaran_uang CHECK (
    (jenis_reward = 'barang' AND nominal_uang IS NULL) OR
    (jenis_reward = 'uang' AND nominal_uang > 0)
  ),
  CONSTRAINT fk_pengajuan_penukaran_peserta FOREIGN KEY (peserta_id)
    REFERENCES akun(id),
  CONSTRAINT fk_pengajuan_penukaran_reward FOREIGN KEY (reward_id)
    REFERENCES katalog_reward(id) ON DELETE SET NULL,
  CONSTRAINT fk_pengajuan_penukaran_peninjau FOREIGN KEY (ditinjau_oleh)
    REFERENCES akun(id),
  CONSTRAINT fk_pengajuan_penukaran_penyerah FOREIGN KEY (diserahkan_oleh)
    REFERENCES akun(id),
  INDEX idx_pengajuan_penukaran_peserta_dibuat (peserta_id, dibuat_pada),
  INDEX idx_pengajuan_penukaran_status_dibuat (status, dibuat_pada)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transaksi_poin (
  id CHAR(36) PRIMARY KEY,
  peserta_id CHAR(36) NOT NULL,
  jenis ENUM('setoran', 'penukaran', 'penyesuaian') NOT NULL,
  jumlah BIGINT NOT NULL,
  keterangan VARCHAR(240) NOT NULL,
  setoran_id CHAR(36) NULL,
  pengajuan_penukaran_id CHAR(36) NULL,
  dibuat_oleh CHAR(36) NOT NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_transaksi_poin_bukan_nol CHECK (jumlah <> 0),
  CONSTRAINT fk_transaksi_poin_peserta FOREIGN KEY (peserta_id)
    REFERENCES akun(id),
  CONSTRAINT fk_transaksi_poin_setoran FOREIGN KEY (setoran_id)
    REFERENCES pengajuan_setoran(id),
  CONSTRAINT fk_transaksi_poin_penukaran FOREIGN KEY (pengajuan_penukaran_id)
    REFERENCES pengajuan_penukaran(id),
  CONSTRAINT fk_transaksi_poin_pembuat FOREIGN KEY (dibuat_oleh)
    REFERENCES akun(id),
  INDEX idx_transaksi_poin_peserta_dibuat (peserta_id, dibuat_pada),
  INDEX idx_transaksi_poin_jenis_dibuat (jenis, dibuat_pada)
) ENGINE=InnoDB;
