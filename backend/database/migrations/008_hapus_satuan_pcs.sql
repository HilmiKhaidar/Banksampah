USE bank_sampah;

UPDATE jenis_sampah
SET aktif = FALSE
WHERE satuan = 'buah' AND aktif = TRUE;
