
const removeAccents = require('remove-accents');

// Danh sách từ vô nghĩa (Stop words) tiếng Việt
const STOP_WORDS = [
    "mon", "an", "co", "voi", "la", "nhung", "cai", "loai", "bi", "duoc", 
    "tai", "o", "ngon", "re", "nhat", "phan", "suat", "met", "combo", 
    "do", "thuc", "uong", "quan", "shop", "ban", "mua", "ship", "giao",
    "cho", "toi", "minh", "chung", "khach", "hang"
];

function cleanKeyword(text) {
    if (!text) return "";
    
    let normalized = removeAccents(text).toLowerCase();
    
    let words = normalized.split(/\s+/);
    
    let keywords = words.filter(w => !STOP_WORDS.includes(w) && w.length > 1);
    
    if (keywords.length === 0) return normalized;
    
    return keywords.join(" "); 
}

module.exports = { cleanKeyword };