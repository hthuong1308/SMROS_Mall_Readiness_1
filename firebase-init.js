// firebase-init.js (ES Module) – SMROS / MRSM
// Mục đích:
// - Khởi tạo Firebase App
// - Export auth & firestore cho các ES module khác
// - Gắn backward-compatibility lên window cho script thường (non-module)
//
// Cách dùng trong HTML:
// <script type="module" src="./firebase-init.js"></script>

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

/**
 * Firebase project configuration
 * ⚠️ Lưu ý:
 * - Đây là public config (client-side) → OK theo Firebase design
 * - Security thực tế phải enforce bằng Firebase Auth + Firestore Rules
 */
const firebaseConfig = {
    apiKey: "AIzaSyD1eAoMDcjI_T8cdcAhbFFPJPMdGQlpyjk",
    authDomain: "smros-mrsm.firebaseapp.com",
    projectId: "smros-mrsm",
    storageBucket: "smros-mrsm.firebasestorage.app",
    messagingSenderId: "113773333670",
    appId: "1:113773333670:web:6dd0cf0052eefd049cb867",
};

/**
 * Khởi tạo Firebase App
 * - Chỉ nên init MỘT LẦN duy nhất trong toàn bộ frontend
 */
export const app = initializeApp(firebaseConfig);

/**
 * Firebase Authentication instance
 * - Dùng cho login, onAuthStateChanged, bảo vệ page
 */
export const auth = getAuth(app);

/**
 * Firestore Database instance
 * - Dùng cho assessment, dashboard, history, trend
 */
export const db = getFirestore(app);

/**
 * Backward compatibility
 * - Cho các file JS KHÔNG dùng ES module
 * - Ví dụ: auth-guard.js, inline script cũ
 */
window._auth = auth;
window._db = db;

/**
 * Debug / health-check flag
 * - Có thể dùng để verify Firebase đã sẵn sàng
 * - Ví dụ: if (!window.__FIREBASE_READY__) { ... }
 */
window.__FIREBASE_READY__ = true;
