/**
 * Market Service — IDX Market Hours & Status
 * Pasar IDX: Sesi 1 (09:00-11:30 WIB), Sesi 2 (13:30-16:00 WIB)
 */

function getMarketStatus() {
  const now = new Date();
  // Convert to WIB (UTC+7)
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const wibDate = new Date(utcMs + 7 * 3600000);
  
  const wibH = wibDate.getHours();
  const wibM = wibDate.getMinutes();
  const wibMin = wibH * 60 + wibM;
  const wibDay = wibDate.getDay(); // 0=Sun, 6=Sat
  
  const isWeekday = wibDay >= 1 && wibDay <= 5;
  const session1 = wibMin >= 540 && wibMin < 690;  // 09:00 - 11:30
  // PERBAIKAN: 960 menit = jam 16:00
  const session2 = wibMin >= 810 && wibMin < 960;  // 13:30 - 16:00
  const isOpen = isWeekday && (session1 || session2);
  
  const H = String(wibH).padStart(2, '0');
  const M = String(wibM).padStart(2, '0');
  
  let sess;
  if (isOpen) {
    sess = session1 ? 'Sesi I' : 'Sesi II';
  } else if (isWeekday && wibMin >= 690 && wibMin < 810) {
    sess = 'Istirahat';
  } else if (!isWeekday) {
    sess = 'Libur';
  } else if (wibMin < 540) {
    sess = 'Pre-Market';
  } else {
    sess = 'After-Hours';
  }
  
  // Format date WIB
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const dateStr = `${days[wibDate.getDay()]}, ${wibDate.getDate()} ${months[wibDate.getMonth()]} ${wibDate.getFullYear()}`;
  
  return {
    isOpen,
    time: `${H}:${M} WIB`,
    sess,
    dateStr,
    wibH,
    wibM,
    wibDay,
    timestamp: now.toISOString()
  };
}

module.exports = { getMarketStatus };