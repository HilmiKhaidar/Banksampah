-- --------------------------------------------------------
-- Host:                         127.0.0.1
-- Server version:               8.4.3 - MySQL Community Server - GPL
-- Server OS:                    Win64
-- HeidiSQL Version:             12.8.0.6908
-- --------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;


-- Dumping database structure for bank_sampah
CREATE DATABASE IF NOT EXISTS `bank_sampah` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `bank_sampah`;

-- Dumping structure for table bank_sampah.akun
CREATE TABLE IF NOT EXISTS `akun` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `peran` enum('pengelola','peserta') COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `identitas` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kelas` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `whatsapp` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `notifikasi_dalam_aplikasi` tinyint(1) NOT NULL DEFAULT '1',
  `hash_kata_sandi` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `wajib_ganti_kata_sandi` tinyint(1) NOT NULL DEFAULT '0',
  `aktif` tinyint(1) NOT NULL DEFAULT '1',
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `diperbarui_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_akun_identitas` (`identitas`),
  KEY `idx_akun_peran_aktif` (`peran`,`aktif`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.akun: ~4 rows (approximately)
INSERT INTO `akun` (`id`, `peran`, `nama`, `identitas`, `kelas`, `whatsapp`, `notifikasi_dalam_aplikasi`, `hash_kata_sandi`, `wajib_ganti_kata_sandi`, `aktif`, `dibuat_pada`, `diperbarui_pada`) VALUES
	('aca80348-c640-11f1-94ea-507b9dbe7987', 'peserta', 'Hilmi Khaidar N', '152023149', NULL, '', 1, 'scrypt$0682f95e118370f23fed8a9e15bfa9b5$f7826479d9d32cd15eb4c97de9a3a32911f78e5a65fb59edbbb20c2390f2b2e9b18255d77deeb0a98d19377666242e32e77af498a9e61c99a135df4f9c6d6462', 0, 1, '2026-10-12 13:27:30.208', '2026-10-12 13:29:30.918'),
	('e0ac43ca-c31b-11f1-a70c-507b9dbe7987', 'pengelola', 'Pengelola', 'pengelola', NULL, '', 1, 'scrypt$da5e08b8ca9d44c76436b25e06e26ba4$60df6d56dd52552ff5adec61cb6b7a298085f7b9680808c63974903618119c4bcc1ef7ec51430a1681dfd0de0ba5f772f0348365fafd7dfe4b3e7169a88acf58', 0, 1, '2026-10-08 13:26:32.556', '2026-10-08 13:26:32.556');

-- Dumping structure for table bank_sampah.arsip_pengajuan_pencairan
CREATE TABLE IF NOT EXISTS `arsip_pengajuan_pencairan` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `peserta_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nominal` bigint NOT NULL,
  `jenis_tujuan` enum('bank','dompet_digital') COLLATE utf8mb4_unicode_ci NOT NULL,
  `lembaga` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama_pemilik_rekening` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nomor_rekening` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('menunggu','diproses','dibayar','ditolak','dibatalkan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'menunggu',
  `catatan` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `ditinjau_oleh` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ditinjau_pada` timestamp(3) NULL DEFAULT NULL,
  `dibayar_oleh` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dibayar_pada` timestamp(3) NULL DEFAULT NULL,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `diperbarui_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_pengajuan_pencairan_peserta_dibuat` (`peserta_id`,`dibuat_pada`),
  KEY `idx_pengajuan_pencairan_status_dibuat` (`status`,`dibuat_pada`),
  KEY `fk_pengajuan_pencairan_peninjau` (`ditinjau_oleh`),
  KEY `fk_pengajuan_pencairan_pembayar` (`dibayar_oleh`),
  CONSTRAINT `fk_pengajuan_pencairan_pembayar` FOREIGN KEY (`dibayar_oleh`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_pengajuan_pencairan_peninjau` FOREIGN KEY (`ditinjau_oleh`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_pengajuan_pencairan_peserta` FOREIGN KEY (`peserta_id`) REFERENCES `akun` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.arsip_pengajuan_pencairan: ~0 rows (approximately)

-- Dumping structure for table bank_sampah.arsip_transaksi_saldo
CREATE TABLE IF NOT EXISTS `arsip_transaksi_saldo` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `peserta_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `jenis` enum('setoran','penyesuaian','pencairan','penukaran') COLLATE utf8mb4_unicode_ci NOT NULL,
  `nominal` bigint NOT NULL,
  `keterangan` varchar(240) COLLATE utf8mb4_unicode_ci NOT NULL,
  `referensi` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `setoran_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pengajuan_pencairan_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dibuat_oleh` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_transaksi_saldo_peserta_dibuat` (`peserta_id`,`dibuat_pada`),
  KEY `idx_transaksi_saldo_jenis_dibuat` (`jenis`,`dibuat_pada`),
  KEY `fk_transaksi_saldo_setoran` (`setoran_id`),
  KEY `fk_transaksi_saldo_pencairan` (`pengajuan_pencairan_id`),
  KEY `fk_transaksi_saldo_pembuat` (`dibuat_oleh`),
  CONSTRAINT `fk_transaksi_saldo_pembuat` FOREIGN KEY (`dibuat_oleh`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_transaksi_saldo_pencairan` FOREIGN KEY (`pengajuan_pencairan_id`) REFERENCES `arsip_pengajuan_pencairan` (`id`),
  CONSTRAINT `fk_transaksi_saldo_peserta` FOREIGN KEY (`peserta_id`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_transaksi_saldo_setoran` FOREIGN KEY (`setoran_id`) REFERENCES `pengajuan_setoran` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.arsip_transaksi_saldo: ~0 rows (approximately)

-- Dumping structure for table bank_sampah.foto_setoran
CREATE TABLE IF NOT EXISTS `foto_setoran` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `setoran_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `url_gambar` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nama_berkas` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'foto.jpg',
  `tipe_konten` enum('image/jpeg','image/png','image/webp') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'image/jpeg',
  `data_gambar` mediumblob,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_foto_setoran_setoran` (`setoran_id`),
  CONSTRAINT `fk_foto_setoran_pengajuan` FOREIGN KEY (`setoran_id`) REFERENCES `pengajuan_setoran` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.foto_setoran: ~0 rows (approximately)

-- Dumping structure for table bank_sampah.jenis_sampah
CREATE TABLE IF NOT EXISTS `jenis_sampah` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `satuan` enum('kg','buah','liter') COLLATE utf8mb4_unicode_ci NOT NULL,
  `poin_per_satuan` bigint unsigned NOT NULL DEFAULT '0',
  `harga_per_satuan_arsip` bigint DEFAULT NULL,
  `ikon` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `url_gambar` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tipe_gambar` enum('image/jpeg','image/png','image/webp') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `data_gambar` mediumblob,
  `aktif` tinyint(1) NOT NULL DEFAULT '1',
  `dibuat_oleh` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `diperbarui_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_jenis_sampah_aktif_nama` (`aktif`,`nama`),
  KEY `fk_jenis_sampah_pembuat` (`dibuat_oleh`),
  CONSTRAINT `fk_jenis_sampah_pembuat` FOREIGN KEY (`dibuat_oleh`) REFERENCES `akun` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.jenis_sampah: ~0 rows (approximately)
INSERT INTO `jenis_sampah` (`id`, `nama`, `satuan`, `poin_per_satuan`, `harga_per_satuan_arsip`, `ikon`, `url_gambar`, `tipe_gambar`, `data_gambar`, `aktif`, `dibuat_oleh`, `dibuat_pada`, `diperbarui_pada`) VALUES
	('f6e2ba79-f3dd-4b40-8fa2-fafc2744cb7b', 'Gelas plastik', 'kg', 1, NULL, '🥤', NULL, NULL, NULL, 1, 'e0ac43ca-c31b-11f1-a70c-507b9dbe7987', '2026-10-12 08:26:27.048', '2026-10-12 08:27:35.588');

-- Dumping structure for table bank_sampah.katalog_reward
CREATE TABLE IF NOT EXISTS `katalog_reward` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `keterangan` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `jenis` enum('barang','uang') COLLATE utf8mb4_unicode_ci NOT NULL,
  `poin_dibutuhkan` bigint unsigned NOT NULL,
  `stok` int unsigned DEFAULT NULL,
  `nominal_uang` bigint unsigned DEFAULT NULL,
  `aktif` tinyint(1) NOT NULL DEFAULT '1',
  `dibuat_oleh` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `diperbarui_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `fk_katalog_reward_pembuat` (`dibuat_oleh`),
  KEY `idx_katalog_reward_aktif_jenis` (`aktif`,`jenis`),
  CONSTRAINT `fk_katalog_reward_pembuat` FOREIGN KEY (`dibuat_oleh`) REFERENCES `akun` (`id`),
  CONSTRAINT `chk_katalog_reward_jenis` CHECK ((((`jenis` = _utf8mb4'barang') and (`nominal_uang` is null)) or ((`jenis` = _utf8mb4'uang') and (`nominal_uang` > 0) and (`stok` is null)))),
  CONSTRAINT `chk_katalog_reward_poin` CHECK ((`poin_dibutuhkan` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.katalog_reward: ~1 rows (approximately)
INSERT INTO `katalog_reward` (`id`, `nama`, `keterangan`, `jenis`, `poin_dibutuhkan`, `stok`, `nominal_uang`, `aktif`, `dibuat_oleh`, `dibuat_pada`, `diperbarui_pada`) VALUES
	('6643b54f-0eee-4da5-9483-066a0746901f', 'RER', 'ER', 'barang', 40000, 3, NULL, 1, 'e0ac43ca-c31b-11f1-a70c-507b9dbe7987', '2026-10-12 13:59:29.163', '2026-10-12 13:59:29.163');

-- Dumping structure for table bank_sampah.notifikasi
CREATE TABLE IF NOT EXISTS `notifikasi` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `penerima_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `judul` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pesan` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `jenis` enum('setoran','saldo','poin','penukaran','sistem') COLLATE utf8mb4_unicode_ci NOT NULL,
  `id_terkait` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dibaca_pada` timestamp(3) NULL DEFAULT NULL,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_notifikasi_penerima_dibaca_dibuat` (`penerima_id`,`dibaca_pada`,`dibuat_pada`),
  CONSTRAINT `fk_notifikasi_penerima` FOREIGN KEY (`penerima_id`) REFERENCES `akun` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.notifikasi: ~0 rows (approximately)
INSERT INTO `notifikasi` (`id`, `penerima_id`, `judul`, `pesan`, `jenis`, `id_terkait`, `dibaca_pada`, `dibuat_pada`) VALUES
	('454ca980-c645-11f1-94ea-507b9dbe7987', 'e0ac43ca-c31b-11f1-a70c-507b9dbe7987', 'Pengajuan setoran baru', 'Hilmi Khaidar N mengajukan setoran baru.', 'setoran', 'd5c3fcc0-e492-43b5-8e58-2a231fc4f5df', '2026-10-13 02:39:11.259', '2026-10-12 14:00:24.288');

-- Dumping structure for table bank_sampah.pengajuan_penukaran
CREATE TABLE IF NOT EXISTS `pengajuan_penukaran` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `peserta_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reward_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nama_reward` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `jenis_reward` enum('barang','uang') COLLATE utf8mb4_unicode_ci NOT NULL,
  `poin_dibutuhkan` bigint unsigned NOT NULL,
  `nominal_uang` bigint unsigned DEFAULT NULL,
  `status` enum('menunggu','disetujui','ditolak','selesai','dibatalkan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'menunggu',
  `catatan` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `ditinjau_oleh` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ditinjau_pada` timestamp(3) NULL DEFAULT NULL,
  `diserahkan_oleh` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `diserahkan_pada` timestamp(3) NULL DEFAULT NULL,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `diperbarui_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `fk_pengajuan_penukaran_reward` (`reward_id`),
  KEY `fk_pengajuan_penukaran_peninjau` (`ditinjau_oleh`),
  KEY `fk_pengajuan_penukaran_penyerah` (`diserahkan_oleh`),
  KEY `idx_pengajuan_penukaran_peserta_dibuat` (`peserta_id`,`dibuat_pada`),
  KEY `idx_pengajuan_penukaran_status_dibuat` (`status`,`dibuat_pada`),
  CONSTRAINT `fk_pengajuan_penukaran_peninjau` FOREIGN KEY (`ditinjau_oleh`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_pengajuan_penukaran_penyerah` FOREIGN KEY (`diserahkan_oleh`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_pengajuan_penukaran_peserta` FOREIGN KEY (`peserta_id`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_pengajuan_penukaran_reward` FOREIGN KEY (`reward_id`) REFERENCES `katalog_reward` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_pengajuan_penukaran_poin` CHECK ((`poin_dibutuhkan` > 0)),
  CONSTRAINT `chk_pengajuan_penukaran_uang` CHECK ((((`jenis_reward` = _utf8mb4'barang') and (`nominal_uang` is null)) or ((`jenis_reward` = _utf8mb4'uang') and (`nominal_uang` > 0))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.pengajuan_penukaran: ~1 rows (approximately)

-- Dumping structure for table bank_sampah.pengajuan_setoran
CREATE TABLE IF NOT EXISTS `pengajuan_setoran` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `peserta_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('menunggu','disetujui','ditolak','dibatalkan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'menunggu',
  `catatan` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `ditinjau_oleh` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ditinjau_pada` timestamp(3) NULL DEFAULT NULL,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `diperbarui_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_pengajuan_setoran_peserta_dibuat` (`peserta_id`,`dibuat_pada`),
  KEY `idx_pengajuan_setoran_status_dibuat` (`status`,`dibuat_pada`),
  KEY `fk_pengajuan_setoran_peninjau` (`ditinjau_oleh`),
  CONSTRAINT `fk_pengajuan_setoran_peninjau` FOREIGN KEY (`ditinjau_oleh`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_pengajuan_setoran_peserta` FOREIGN KEY (`peserta_id`) REFERENCES `akun` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.pengajuan_setoran: ~0 rows (approximately)
INSERT INTO `pengajuan_setoran` (`id`, `peserta_id`, `status`, `catatan`, `ditinjau_oleh`, `ditinjau_pada`, `dibuat_pada`, `diperbarui_pada`) VALUES
	('d5c3fcc0-e492-43b5-8e58-2a231fc4f5df', 'aca80348-c640-11f1-94ea-507b9dbe7987', 'menunggu', '', NULL, NULL, '2026-10-12 14:00:24.283', '2026-10-12 14:00:24.283');

-- Dumping structure for table bank_sampah.pengaturan_bank_sampah
CREATE TABLE IF NOT EXISTS `pengaturan_bank_sampah` (
  `id` tinyint unsigned NOT NULL,
  `poin_per_konversi` bigint unsigned DEFAULT NULL,
  `rupiah_per_konversi` bigint unsigned DEFAULT NULL,
  `diperbarui_oleh` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `diperbarui_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `fk_pengaturan_bank_sampah_pengelola` (`diperbarui_oleh`),
  CONSTRAINT `fk_pengaturan_bank_sampah_pengelola` FOREIGN KEY (`diperbarui_oleh`) REFERENCES `akun` (`id`),
  CONSTRAINT `chk_pengaturan_bank_sampah_tunggal` CHECK ((`id` = 1)),
  CONSTRAINT `chk_pengaturan_konversi` CHECK ((((`poin_per_konversi` is null) and (`rupiah_per_konversi` is null)) or ((`poin_per_konversi` > 0) and (`rupiah_per_konversi` > 0))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.pengaturan_bank_sampah: ~1 rows (approximately)
INSERT INTO `pengaturan_bank_sampah` (`id`, `poin_per_konversi`, `rupiah_per_konversi`, `diperbarui_oleh`, `diperbarui_pada`) VALUES
	(1, 1000, 1000, 'e0ac43ca-c31b-11f1-a70c-507b9dbe7987', '2026-10-13 03:33:34.621');

-- Dumping structure for table bank_sampah.rincian_setoran
CREATE TABLE IF NOT EXISTS `rincian_setoran` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `setoran_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `jenis_sampah_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nama_jenis_sampah` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `satuan` enum('kg','buah','liter') COLLATE utf8mb4_unicode_ci NOT NULL,
  `jumlah` decimal(12,3) NOT NULL,
  `poin_per_satuan` bigint unsigned DEFAULT NULL,
  `poin_didapat` bigint unsigned DEFAULT NULL,
  `harga_per_satuan_arsip` bigint DEFAULT NULL,
  `nominal_arsip` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rincian_setoran_setoran` (`setoran_id`),
  KEY `fk_rincian_setoran_jenis_sampah` (`jenis_sampah_id`),
  CONSTRAINT `fk_rincian_setoran_jenis_sampah` FOREIGN KEY (`jenis_sampah_id`) REFERENCES `jenis_sampah` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rincian_setoran_pengajuan` FOREIGN KEY (`setoran_id`) REFERENCES `pengajuan_setoran` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.rincian_setoran: ~1 rows (approximately)
INSERT INTO `rincian_setoran` (`id`, `setoran_id`, `jenis_sampah_id`, `nama_jenis_sampah`, `satuan`, `jumlah`, `poin_per_satuan`, `poin_didapat`, `harga_per_satuan_arsip`, `nominal_arsip`) VALUES
	(18, 'd5c3fcc0-e492-43b5-8e58-2a231fc4f5df', 'f6e2ba79-f3dd-4b40-8fa2-fafc2744cb7b', 'Gelas plastik', 'kg', 0.000, NULL, NULL, NULL, NULL);

-- Dumping structure for table bank_sampah.sesi
CREATE TABLE IF NOT EXISTS `sesi` (
  `hash_token` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `akun_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kedaluwarsa_pada` timestamp(3) NOT NULL,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`hash_token`),
  KEY `idx_sesi_akun_kedaluwarsa` (`akun_id`,`kedaluwarsa_pada`),
  KEY `idx_sesi_kedaluwarsa` (`kedaluwarsa_pada`),
  CONSTRAINT `fk_sesi_akun` FOREIGN KEY (`akun_id`) REFERENCES `akun` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.sesi: ~7 rows (approximately)
INSERT INTO `sesi` (`hash_token`, `akun_id`, `kedaluwarsa_pada`, `dibuat_pada`) VALUES
	('35aae3fc2ef966a078e2e1b07bdbb95c1ff47d59183000e31b0c997402cd8cb1', 'aca80348-c640-11f1-94ea-507b9dbe7987', '2026-10-20 03:38:17.465', '2026-10-13 03:38:17.465'),
	('623f6e5ec8a53d9a24ed60c68311ea5068215d04a6b98db805e6b58f6c77794f', 'e0ac43ca-c31b-11f1-a70c-507b9dbe7987', '2026-10-15 18:40:05.278', '2026-10-08 18:40:05.278');

-- Dumping structure for table bank_sampah.transaksi_poin
CREATE TABLE IF NOT EXISTS `transaksi_poin` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `peserta_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `jenis` enum('setoran','penukaran','penyesuaian') COLLATE utf8mb4_unicode_ci NOT NULL,
  `jumlah` bigint NOT NULL,
  `keterangan` varchar(240) COLLATE utf8mb4_unicode_ci NOT NULL,
  `setoran_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pengajuan_penukaran_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dibuat_oleh` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dibuat_pada` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `fk_transaksi_poin_setoran` (`setoran_id`),
  KEY `fk_transaksi_poin_penukaran` (`pengajuan_penukaran_id`),
  KEY `fk_transaksi_poin_pembuat` (`dibuat_oleh`),
  KEY `idx_transaksi_poin_peserta_dibuat` (`peserta_id`,`dibuat_pada`),
  KEY `idx_transaksi_poin_jenis_dibuat` (`jenis`,`dibuat_pada`),
  CONSTRAINT `fk_transaksi_poin_pembuat` FOREIGN KEY (`dibuat_oleh`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_transaksi_poin_penukaran` FOREIGN KEY (`pengajuan_penukaran_id`) REFERENCES `pengajuan_penukaran` (`id`),
  CONSTRAINT `fk_transaksi_poin_peserta` FOREIGN KEY (`peserta_id`) REFERENCES `akun` (`id`),
  CONSTRAINT `fk_transaksi_poin_setoran` FOREIGN KEY (`setoran_id`) REFERENCES `pengajuan_setoran` (`id`),
  CONSTRAINT `chk_transaksi_poin_bukan_nol` CHECK ((`jumlah` <> 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dumping data for table bank_sampah.transaksi_poin: ~0 rows (approximately)

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;
