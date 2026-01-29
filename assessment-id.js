// assessment-id.js
// Quản lý assessment_id xuyên suốt nhiều page
// Ưu tiên: query param → sessionStorage → tạo mới

const KEY = "current_assessment_id";

// Lấy assessment_id hiện tại hoặc tạo mới nếu chưa có
export function getOrCreateAssessmentId() {
    // 1) ưu tiên query param
    const url = new URL(window.location.href);
    const qid = url.searchParams.get("assessment_id");
    if (qid && qid.trim()) {
        const id = qid.trim();
        sessionStorage.setItem(KEY, id);
        return id;
    }

    // 2)  Nếu không có query → lấy từ sessionStorage
    const sid = sessionStorage.getItem(KEY);
    if (sid && sid.trim()) return sid.trim();

    // 3) Nếu chưa có gì → tạo assessment_id mới
    const newId = `A_${Date.now()}`;
    sessionStorage.setItem(KEY, newId);
    return newId;
}

// Gắn assessment_id vào URL khi chuyển page 
// Hỗ trợ URL đã có query sẵnexport function withAssessmentId(href, assessmentId) {
try {
    const base = new URL(href, window.location.origin);
    base.searchParams.set("assessment_id", assessmentId);
    return base.pathname + "?" + base.searchParams.toString();
} catch {
    // fallback for relative urls without origin parsing
    const sep = href.includes("?") ? "&" : "?";
    return `${href}${sep}assessment_id=${encodeURIComponent(assessmentId)}`;
}

