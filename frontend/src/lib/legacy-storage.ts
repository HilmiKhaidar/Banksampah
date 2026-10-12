export function clearLegacyBusinessCache() {
  window.localStorage.removeItem("sekolah-merdeka-bank-sampah:data:v1");
  window.localStorage.removeItem("sekolah-merdeka-bank-sampah:settings:v1");
}
