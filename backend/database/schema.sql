CREATE DATABASE IF NOT EXISTS bank_sampah
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE bank_sampah;

CREATE TABLE IF NOT EXISTS akun (
  id CHAR(36) PRIMARY KEY,
  peran ENUM('pengelola', 'peserta') NOT NULL,
  nama VARCHAR(100) NOT NULL,
  identitas VARCHAR(100) NOT NULL,
  kelas VARCHAR(80) NULL,
  whatsapp VARCHAR(24) NOT NULL,
  notifikasi_dalam_aplikasi BOOLEAN NOT NULL DEFAULT TRUE,
  hash_kata_sandi VARCHAR(255) NOT NULL,
  wajib_ganti_kata_sandi BOOLEAN NOT NULL DEFAULT FALSE,
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  diperbarui_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_akun_identitas (identitas),
  INDEX idx_akun_peran_aktif (peran, aktif)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sesi (
  hash_token CHAR(64) PRIMARY KEY,
  akun_id CHAR(36) NOT NULL,
  kedaluwarsa_pada TIMESTAMP(3) NOT NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_sesi_akun FOREIGN KEY (akun_id)
    REFERENCES akun(id) ON DELETE CASCADE,
  INDEX idx_sesi_akun_kedaluwarsa (akun_id, kedaluwarsa_pada),
  INDEX idx_sesi_kedaluwarsa (kedaluwarsa_pada)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jenis_sampah (
  id CHAR(36) PRIMARY KEY,
  nama VARCHAR(80) NOT NULL,
  satuan ENUM('kg', 'liter') NOT NULL,
  harga_per_satuan_arsip BIGINT NULL,
  ikon VARCHAR(24) NULL,
  url_gambar VARCHAR(500) NULL,
  tipe_gambar ENUM('image/jpeg', 'image/png', 'image/webp') NULL,
  data_gambar MEDIUMBLOB NULL,
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  dibuat_oleh CHAR(36) NOT NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  diperbarui_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_jenis_sampah_pembuat FOREIGN KEY (dibuat_oleh)
    REFERENCES akun(id),
  INDEX idx_jenis_sampah_aktif_nama (aktif, nama)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pengajuan_setoran (
  id CHAR(36) PRIMARY KEY,
  peserta_id CHAR(36) NOT NULL,
  status ENUM('menunggu', 'disetujui', 'ditolak', 'dibatalkan')
    NOT NULL DEFAULT 'menunggu',
  catatan VARCHAR(500) NOT NULL DEFAULT '',
  ditinjau_oleh CHAR(36) NULL,
  ditinjau_pada TIMESTAMP(3) NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  diperbarui_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pengajuan_setoran_peserta FOREIGN KEY (peserta_id)
    REFERENCES akun(id),
  CONSTRAINT fk_pengajuan_setoran_peninjau FOREIGN KEY (ditinjau_oleh)
    REFERENCES akun(id),
  INDEX idx_pengajuan_setoran_peserta_dibuat (peserta_id, dibuat_pada),
  INDEX idx_pengajuan_setoran_status_dibuat (status, dibuat_pada)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rincian_setoran (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  setoran_id CHAR(36) NOT NULL,
  jenis_sampah_id CHAR(36) NULL,
  nama_jenis_sampah VARCHAR(80) NOT NULL,
  satuan ENUM('kg', 'liter') NOT NULL,
  jumlah DECIMAL(12, 3) NOT NULL,
  harga_per_satuan_arsip BIGINT NULL,
  nominal_arsip BIGINT NULL,
  CONSTRAINT fk_rincian_setoran_pengajuan FOREIGN KEY (setoran_id)
    REFERENCES pengajuan_setoran(id) ON DELETE CASCADE,
  CONSTRAINT fk_rincian_setoran_jenis_sampah FOREIGN KEY (jenis_sampah_id)
    REFERENCES jenis_sampah(id) ON DELETE SET NULL,
  INDEX idx_rincian_setoran_setoran (setoran_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS foto_setoran (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  setoran_id CHAR(36) NOT NULL,
  url_gambar VARCHAR(500) NULL,
  nama_berkas VARCHAR(255) NOT NULL DEFAULT 'foto.jpg',
  tipe_konten ENUM('image/jpeg', 'image/png', 'image/webp') NOT NULL DEFAULT 'image/jpeg',
  data_gambar MEDIUMBLOB NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_foto_setoran_pengajuan FOREIGN KEY (setoran_id)
    REFERENCES pengajuan_setoran(id) ON DELETE CASCADE,
  INDEX idx_foto_setoran_setoran (setoran_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS arsip_pengajuan_pencairan (
  id CHAR(36) PRIMARY KEY,
  peserta_id CHAR(36) NOT NULL,
  nominal BIGINT NOT NULL,
  jenis_tujuan ENUM('bank', 'dompet_digital') NOT NULL,
  lembaga VARCHAR(60) NOT NULL,
  nama_pemilik_rekening VARCHAR(100) NOT NULL,
  nomor_rekening VARCHAR(24) NOT NULL,
  status ENUM('menunggu', 'diproses', 'dibayar', 'ditolak', 'dibatalkan')
    NOT NULL DEFAULT 'menunggu',
  catatan VARCHAR(500) NOT NULL DEFAULT '',
  ditinjau_oleh CHAR(36) NULL,
  ditinjau_pada TIMESTAMP(3) NULL,
  dibayar_oleh CHAR(36) NULL,
  dibayar_pada TIMESTAMP(3) NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  diperbarui_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_arsip_pengajuan_pencairan_peserta FOREIGN KEY (peserta_id)
    REFERENCES akun(id),
  CONSTRAINT fk_arsip_pengajuan_pencairan_peninjau FOREIGN KEY (ditinjau_oleh)
    REFERENCES akun(id),
  CONSTRAINT fk_arsip_pengajuan_pencairan_pembayar FOREIGN KEY (dibayar_oleh)
    REFERENCES akun(id),
  INDEX idx_arsip_pencairan_peserta_dibuat (peserta_id, dibuat_pada),
  INDEX idx_arsip_pencairan_status_dibuat (status, dibuat_pada)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS arsip_transaksi_saldo (
  id CHAR(36) PRIMARY KEY,
  peserta_id CHAR(36) NOT NULL,
  jenis ENUM('setoran', 'penyesuaian', 'pencairan') NOT NULL,
  nominal BIGINT NOT NULL,
  keterangan VARCHAR(240) NOT NULL,
  referensi VARCHAR(80) NULL,
  setoran_id CHAR(36) NULL,
  pengajuan_pencairan_id CHAR(36) NULL,
  dibuat_oleh CHAR(36) NOT NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_arsip_transaksi_saldo_peserta FOREIGN KEY (peserta_id)
    REFERENCES akun(id),
  CONSTRAINT fk_arsip_transaksi_saldo_setoran FOREIGN KEY (setoran_id)
    REFERENCES pengajuan_setoran(id),
  CONSTRAINT fk_arsip_transaksi_saldo_pencairan FOREIGN KEY (pengajuan_pencairan_id)
    REFERENCES arsip_pengajuan_pencairan(id),
  CONSTRAINT fk_arsip_transaksi_saldo_pembuat FOREIGN KEY (dibuat_oleh)
    REFERENCES akun(id),
  INDEX idx_arsip_transaksi_saldo_peserta_dibuat (peserta_id, dibuat_pada),
  INDEX idx_arsip_transaksi_saldo_jenis_dibuat (jenis, dibuat_pada)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifikasi (
  id CHAR(36) PRIMARY KEY,
  penerima_id CHAR(36) NOT NULL,
  judul VARCHAR(120) NOT NULL,
  pesan VARCHAR(500) NOT NULL,
  jenis ENUM('setoran', 'saldo', 'sistem') NOT NULL,
  id_terkait CHAR(36) NULL,
  dibaca_pada TIMESTAMP(3) NULL,
  dibuat_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_notifikasi_penerima FOREIGN KEY (penerima_id)
    REFERENCES akun(id) ON DELETE CASCADE,
  INDEX idx_notifikasi_penerima_dibaca_dibuat (penerima_id, dibaca_pada, dibuat_pada)
) ENGINE=InnoDB;
