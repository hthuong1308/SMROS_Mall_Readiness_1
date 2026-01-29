// auth.js (ES Module) – Login / Register / Forgot Password
// Chức năng:
// - Xử lý đăng nhập & đăng ký với UI tách biệt
// - Hỗ trợ "Quên mật khẩu"
// - Tự động redirect về returnUrl (từ auth-guard.js)
// - Lưu profile user vào Firestore sau khi đăng ký

import { auth, db } from "./firebase-init.js";

import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    updateProfile,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

import {
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

// ========================
// DOM Elements
// ========================

// Tiêu đề & hint
const authTitle = document.getElementById("authTitle");
const authHint = document.getElementById("authHint");

// Form
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

// Switch mode
const goRegister = document.getElementById("goRegister");
const goLogin = document.getElementById("goLogin");

// Error message containers
const loginError = document.getElementById("loginError");
const regError = document.getElementById("regError");

// Login inputs
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");

// Register inputs
const regUsername = document.getElementById("regUsername");
const regFullName = document.getElementById("regFullName");
const regEmail = document.getElementById("regEmail");
const regPhone = document.getElementById("regPhone");
const regPassword = document.getElementById("regPassword");
const regPassword2 = document.getElementById("regPassword2");

// Toggle show/hide password
const toggleLoginPassword = document.getElementById("toggleLoginPassword");
const toggleRegPassword = document.getElementById("toggleRegPassword");

// Forgot password link
const forgotLink = document.getElementById("forgotLink");

// ========================
// Mode state
// ========================
// login | register
let mode = "login";

// ========================
// UI helpers
// ========================

/**
 * Hiển thị lỗi cho 1 block
 */
function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
}

/**
 * Clear lỗi
 */
function clearError(el) {
    if (!el) return;
    el.textContent = "";
    el.classList.remove("show");
}

/**
 * Chuyển mode UI giữa Login / Register
 * - Ẩn/hiện form
 * - Đổi title + hint
 * - Chỉ hiển thị "Quên mật khẩu?" ở Login
 */
function setMode(next) {
    mode = next;

    clearError(loginError);
    clearError(regError);

    if (mode === "login") {
        // Hiện form login
        loginForm.style.display = "flex";
        registerForm.style.display = "none";

        authTitle.textContent = "Đăng nhập";
        authHint.textContent = "Nếu bạn chưa có tài khoản, hãy chuyển sang Đăng ký.";

        // Chỉ login mới có quên mật khẩu
        if (forgotLink) forgotLink.style.display = "inline-flex";
    } else {
        loginForm.style.display = "none";
        registerForm.style.display = "flex";

        authTitle.textContent = "Đăng ký";
        authHint.textContent = "Tạo tài khoản xong bạn sẽ được đăng nhập tự động.";

        if (forgotLink) forgotLink.style.display = "none";
    }
}

// ========================
// UI events
// ========================

// Chuyển sang đăng ký
goRegister?.addEventListener("click", () => setMode("register"));

// Quay lại đăng nhập
goLogin?.addEventListener("click", () => setMode("login"));

// Bật / tắt hiển thị mật khẩu ở form Login
toggleLoginPassword?.addEventListener("click", () => {
    loginPassword.type =
        loginPassword.type === "password" ? "text" : "password";
    toggleLoginPassword.textContent =
        loginPassword.type === "password" ? "👁️" : "🙈";
});

// Bật / tắt hiển thị mật khẩu ở form Register
toggleRegPassword?.addEventListener("click", () => {
    regPassword.type =
        regPassword.type === "password" ? "text" : "password";
    toggleRegPassword.textContent =
        regPassword.type === "password" ? "👁️" : "🙈";
});

// ========================
// Redirect helper
// ========================

/**
 * Lấy returnUrl nếu có (từ auth-guard.js)
 * Fallback → Homepage.html
 */
function getReturnUrl() {
    const url = new URL(window.location.href);
    return url.searchParams.get("returnUrl") || "Homepage.html";
}

// ========================
// Login submit
// ========================

loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError(loginError);

    try {
        await signInWithEmailAndPassword(
            auth,
            loginEmail.value.trim(),
            loginPassword.value
        );

        // Login thành công → quay về page gốc
        window.location.href = getReturnUrl();
    } catch (err) {
        // Hiển thị lỗi nếu login thất bại
        showError(
            loginError,
            err?.message || "Đăng nhập thất bại. Vui lòng thử lại."
        );
    }
});

// ========================
// Forgot password
// ========================
// Chỉ hoạt động ở mode login

forgotLink?.addEventListener("click", async () => {
    if (mode !== "login") return;

    clearError(loginError);

    const email = loginEmail.value.trim();
    if (!email) {
        showError(loginError, "Nhập email trước khi gửi link khôi phục.");
        loginEmail.focus();
        return;
    }

    try {
        await sendPasswordResetEmail(auth, email);
        showError(
            loginError,
            "Đã gửi email khôi phục. Vui lòng kiểm tra hộp thư (và Spam)."
        );
    } catch (err) {
        showError(
            loginError,
            err?.message || "Không gửi được email khôi phục. Vui lòng thử lại."
        );
    }
});

// ========================
// Register submit
// ========================

registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError(regError);

    const username = regUsername.value.trim();
    const fullName = regFullName.value.trim();
    const email = regEmail.value.trim();
    const phone = regPhone.value.trim();
    const p1 = regPassword.value;
    const p2 = regPassword2.value;

    // Basic validation
    if (p1.length < 6) {
        return showError(regError, "Mật khẩu tối thiểu 6 ký tự.");
    }
    if (p1 !== p2) {
        return showError(regError, "Mật khẩu xác nhận không khớp.");
    }

    try {
        // Tạo user Firebase Auth
        const cred = await createUserWithEmailAndPassword(auth, email, p1);

        // Set displayName (dùng cho UI greeting)
        await updateProfile(cred.user, {
            displayName:
                fullName ||
                username ||
                email.split("@")[0]
        });

        // Lưu profile user vào Firestore
        await setDoc(
            doc(db, "users", cred.user.uid, "profile", "main"),
            {
                uid: cred.user.uid,
                username,
                fullName,
                email,
                phone,
                role: "user",
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            },
            { merge: true }
        );

        // Đăng ký xong → redirect
        window.location.href = getReturnUrl();
    } catch (err) {
        showError(
            regError,
            err?.message || "Đăng ký thất bại. Vui lòng thử lại."
        );
    }
});

// ========================
// Auth state guard
// ========================

/**
 * Nếu đã login rồi mà vẫn vào trang auth
 * → tự động redirect (tránh loop)
 */
onAuthStateChanged(auth, (user) => {
    if (user && mode === "login") {
        window.location.href = getReturnUrl();
    }
});

// ========================
// Init
// ========================

// Mặc định load ở mode login
setMode("login");
