// Shopee Mall Readiness – Criteria page scripts

'use strict';

// ========== DATA KO GATE ==========
const koData = [
    {
        title: "Pháp lý – Ủy quyền",
        desc: "Giấy phép kinh doanh, nhãn hiệu, chứng từ phân phối/nhập khẩu, chứng từ chất lượng (nếu ngành bắt buộc).",
        failExamples: [
            "GPKD hết hạn hoặc không hợp lệ",
            "Không có giấy ủy quyền sử dụng nhãn hiệu",
            "Thiếu chứng từ nhập khẩu cho hàng ngoại",
            "Ngành bắt buộc (thực phẩm, mỹ phẩm) thiếu giấy ATTP/CBMP"
        ],
        prepare: [
            "Chuẩn bị GPKD còn hạn ≥ 6 tháng",
            "Đăng ký nhãn hiệu hoặc có hợp đồng ủy quyền",
            "Lưu trữ hoá đơn/chứng từ nhập khẩu rõ ràng",
            "Xin cấp giấy ATTP/CBMP nếu thuộc ngành yêu cầu"
        ]
    },
    {
        title: "Website thương hiệu (VNNIC)",
        desc: "Tên miền đăng ký qua VNNIC, còn hạn ≥ 1 năm, website hoạt động và chứng minh thương hiệu.",
        failExamples: [
            "Không có website hoặc website không hoạt động",
            "Tên miền không đăng ký VNNIC",
            "Tên miền hết hạn hoặc còn < 1 năm",
            "Website không hiển thị rõ thương hiệu/sản phẩm"
        ],
        prepare: [
            "Đăng ký tên miền qua VNNIC",
            "Gia hạn tên miền ≥ 1 năm",
            "Xây dựng website chuyên nghiệp, rõ ràng",
            "Đảm bảo website hoạt động ổn định"
        ]
    },
    {
        title: "Vi phạm nghiêm trọng",
        desc: "Không có lịch sử hàng giả/nhái mức nặng, vi phạm bản quyền nặng, hoặc sản phẩm bị gỡ do vi phạm nặng.",
        failExamples: [
            "Bị phát hiện bán hàng giả/nhái mức nặng",
            "Vi phạm bản quyền/nội dung nặng (cảnh báo từ Shopee)",
            "Sản phẩm bị gỡ hàng loạt do vi phạm chính sách nghiêm trọng",
            "Lịch sử khiếu nại về chất lượng/giả mạo nhiều"
        ],
        prepare: [
            "Kiểm tra kỹ nguồn gốc sản phẩm trước khi bán",
            "Không bán hàng nhái, hàng không rõ nguồn gốc",
            "Tuân thủ chính sách bản quyền và nội dung",
            "Xử lý khiếu nại khách hàng nhanh chóng, chuyên nghiệp"
        ]
    },
    {
        title: "Sao Quả Tạ",
        desc: "Trong 4 tuần gần nhất, số Sao Quả Tạ phải ≤ 2. Nếu > 2 → KO fail.",
        failExamples: [
            "Nhận > 2 Sao Quả Tạ trong 4 tuần gần nhất",
            "Thường xuyên giao hàng trễ/sai hàng",
            "Nhiều đơn bị huỷ do lỗi shop",
            "Phản hồi chat chậm/không phản hồi"
        ],
        prepare: [
            "Theo dõi và cải thiện LSR, NFR, NRR",
            "Giảm tỷ lệ đơn trễ, đơn huỷ",
            "Phản hồi chat nhanh (<12h)",
            "Đảm bảo hàng đúng mô tả, giao đúng hạn"
        ]
    }
];

// ========== DATA SCORING MODEL ==========
const scoringData = [
    {
        group: "Vận hành",
        weight: 50,
        kpis: [
            { id: "OP-01", name: "Tỷ lệ giao hàng trễ (LSR)", desc: "Mục tiêu ≤ 8% (100đ); ngưỡng ≤ 12% (50đ)", weightFinal: 5.2, tooltip: "Chấm theo MRSM_WSM_v2: ≤8%→100; 8–12%→50; >12%→0." },
            { id: "OP-02", name: "Tỷ lệ đơn hàng không thành công (NFR)", desc: "Mục tiêu ≤ 8% (100đ); ngưỡng ≤ 12% (50đ)", weightFinal: 5.2, tooltip: "Chấm theo MRSM_WSM_v2: ≤8%→100; 8–12%→50; >12%→0." },
            { id: "OP-03", name: "Tỷ lệ trả hàng/hoàn tiền", desc: "Mục tiêu ≤ 2% (100đ); ngưỡng ≤ 5% (50đ)", weightFinal: 5.2, tooltip: "Chấm theo MRSM_WSM_v2: ≤2%→100; 2–5%→50; >5%→0." },
            { id: "OP-04", name: "Tỷ lệ giao hàng nhanh", desc: "Mục tiêu ≥ 95% (100đ); ngưỡng ≥ 80% (50đ)", weightFinal: 5.2, tooltip: "Lưu ý: OP-04 đồng thời là Soft KO ở cổng (ngưỡng gate hiển thị ở trang Soft KO). Scoring: ≥95%→100; 80–95%→50; <80%→0." },

            { id: "CS-01", name: "Tỷ lệ phản hồi Chat", desc: "Mục tiêu ≥ 80% (100đ); ngưỡng ≥ 60% (50đ)", weightFinal: 4.95, tooltip: "Chấm theo MRSM_WSM_v2: ≥80%→100; 60–80%→50; <60%→0." },
            { id: "CS-02", name: "Thời gian phản hồi Chat (giờ)", desc: "Mục tiêu ≤ 4h (100đ); ngưỡng ≤ 8h (50đ)", weightFinal: 4.95, tooltip: "Chấm theo MRSM_WSM_v2: ≤4h→100; 4–8h→50; >8h→0." },

            { id: "PEN-01", name: "Điểm phạt Sao Quả Tạ", desc: "Mục tiêu ≤ 0 (100đ); ngưỡng ≤ 2 (50đ)", weightFinal: 7.2, tooltip: "PEN-01 đồng thời là Soft KO ở cổng (ngưỡng gate hiển thị ở trang Soft KO). Scoring: ≤0→100; 0–2→50; >2→0." },

            { id: "CO-01", name: "Tỷ lệ hàng đặt trước (%)", desc: "Mục tiêu ≤ 5% (100đ); ngưỡng ≤ 10% (50đ)", weightFinal: 4.95, tooltip: "Chấm theo MRSM_WSM_v2: ≤5%→100; 5–10%→50; >10%→0." },
            { id: "CO-02", name: "Không vi phạm cộng đồng", desc: "Đạt: 100đ; Không đạt: 0đ", weightFinal: 7.2, tooltip: "Chấm nhị phân theo MRSM_WSM_v2: TRUE→100; FALSE→0 (không phải Hard KO; Hard KO xử lý ở trang KO Gate)." },
        ],
    },
    {
        group: "Thương hiệu",
        weight: 20,
        kpis: [
            { id: "BR-01", name: "Website ổn định (domain check)", desc: "Reachable: 100đ; Không xác minh được: 50đ", weightFinal: 6.28, tooltip: "Custom rule: URL hợp lệ + best-effort fetch. Reachable→100; otherwise→50; invalid→0." },
            { id: "BR-02", name: "Hiện diện MXH (followers + post link)", desc: "Đủ 2 điều kiện: 100đ; đủ 1 điều kiện: 50đ", weightFinal: 6.86, tooltip: "Custom rule: Followers ≥ 5,000 (1đk) + Link bài đăng hợp lệ (1đk). 2/2→100; 1/2→50; 0/2→0." },
            { id: "BR-03", name: "Độ phủ Offline (địa chỉ cửa hàng)", desc: "Có địa chỉ: 100đ; Không có: 0đ", weightFinal: 6.86, tooltip: "Custom rule: NONEMPTY_TEXT. Có địa chỉ→100; trống→0." },
        ],
    },
    {
        group: "Danh mục",
        weight: 15,
        kpis: [
            { id: "CAT-01", name: "Số lượng sản phẩm hoạt động (SKU)", desc: "Mục tiêu ≥ 50 (100đ); ngưỡng ≥ 5 (50đ)", weightFinal: 1.68, tooltip: "Chấm theo MRSM_WSM_v2: ≥50→100; 5–50→50; <5→0." },
            { id: "CAT-02", name: "Ảnh đạt chuẩn (white bg + lifestyle)", desc: "Đủ 2 ảnh đạt: 100đ; đủ 1 ảnh: 50đ", weightFinal: 3.36, tooltip: "Custom rule: phân tích ảnh (heuristics). 2/2 đạt→100; 1/2→50; 0/2→0. Có cơ chế dùng draft filename khi browser không phục hồi file input." },
            { id: "CAT-03", name: "Sản phẩm bị khóa/xóa", desc: "Không bị khóa/xóa: 100đ; Có: 0đ", weightFinal: 5.05, tooltip: "Binary theo MRSM_WSM_v2: TRUE→100; FALSE→0." },
            { id: "CAT-04", name: "Các vi phạm khác", desc: "Không vi phạm: 100đ; Có: 0đ", weightFinal: 4.91, tooltip: "Binary theo MRSM_WSM_v2: TRUE→100; FALSE→0 (không phải Hard KO; Hard KO xử lý ở trang KO Gate)." },
        ],
    },
    {
        group: "Quy mô",
        weight: 15,
        kpis: [
            { id: "SC-01", name: "Doanh số 4w (Triệu VNĐ)", desc: "Mục tiêu ≥ 50 (100đ); ngưỡng ≥ 30 (50đ)", weightFinal: 3.92, tooltip: "Chấm theo MRSM_WSM_v2: ≥50→100; 30–50→50; <30→0." },
            { id: "SC-02", name: "Số đơn hàng 4w", desc: "Mục tiêu ≥ 300 (100đ); ngưỡng ≥ 100 (50đ)", weightFinal: 7.5, tooltip: "SC-02 đồng thời là Soft KO ở cổng (ngưỡng gate hiển thị ở trang Soft KO). Scoring: ≥300→100; 100–300→50; <100→0." },
            { id: "SC-03", name: "Tăng trưởng doanh số (%)", desc: "Mục tiêu ≥ 5% (100đ); ngưỡng ≥ 0% (50đ)", weightFinal: 3.59, tooltip: "Chấm theo MRSM_WSM_v2: ≥5%→100; 0–5%→50; <0%→0." },
        ],
    },
];
// ========== RENDER KO GATE ==========
function renderKOGate() {
    const grid = document.getElementById('koGrid');
    koData.forEach(ko => {
        const card = document.createElement('div');
        card.className = 'ko-card';
        card.innerHTML = `
      <div class="ko-badge">⚡ KO</div>
      <h3>${ko.title}</h3>
      <p>${ko.desc}</p>
      <h4>Ví dụ FAIL:</h4>
      <ul>${ko.failExamples.map(ex => `<li>${ex}</li>`).join('')}</ul>
      <div class="consequence">Hậu quả: Fail → MRSM_Final = 0 / Not Ready</div>
      <h4>Cần chuẩn bị:</h4>
      <ul>${ko.prepare.map(pr => `<li>${pr}</li>`).join('')}</ul>
    `;
        grid.appendChild(card);
    });
}

// ========== RENDER SCORING MODEL ==========
function renderScoring() {
    const container = document.getElementById('scoringGroups');
    scoringData.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'scoring-group';
        groupDiv.innerHTML = `
      <div class="group-header">
        <h3>${group.group}</h3>
        <span class="weight-badge">${group.weight}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${group.weight}%"></div>
      </div>
      <table class="kpi-table">
        <thead>
          <tr>
            <th style="width:30%">KPI</th>
            <th style="width:45%">Mô tả / Ngưỡng</th>
            <th style="width:25%; text-align:right">Weight Final</th>
          </tr>
        </thead>
        <tbody>
          ${group.kpis.map(kpi => `
            <tr>
              <td><strong>${kpi.name}</strong><span class="tooltip" title="${kpi.tooltip}">i</span></td>
              <td>${kpi.desc}</td>
              <td style="text-align:right; font-weight:700; color:var(--brand)">${kpi.weightFinal}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
        container.appendChild(groupDiv);
    });
}
// ========== SEARCH ==========
function setupSearch() {
    const input = document.getElementById('searchInput');
    const targets = Array.from(document.querySelectorAll('.ko-card, .scoring-group'));

    function applyFilter(raw) {
        const query = (raw || '').trim().toLowerCase();
        if (!query) {
            targets.forEach(el => el.classList.remove('is-hidden'));
            return;
        }
        targets.forEach(el => {
            const hay = (el.textContent || '').toLowerCase();
            el.classList.toggle('is-hidden', !hay.includes(query));
        });
    }

    input.addEventListener('input', (e) => applyFilter(e.target.value));

    // Ctrl/Cmd+K: focus search
    window.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toLowerCase().includes('mac');
        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (mod && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            input.focus();
        }
    });
}
// ========== SCROLL FUNCTIONS ==========
function scrollToSection(id) {
    document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
}
// ========== GO HOME ==========
function goHome() {
    window.location.href = "Homepage.html";
}
// ========== BACK TO TOP ==========
window.addEventListener('scroll', () => {
    const btn = document.getElementById('backToTop');
    if (window.scrollY > 300) {
        btn.classList.add('show');
    } else {
        btn.classList.remove('show');
    }
});
// ========== NAV ACTIVE ==========
function setupNavActive() {
    const navLinks = Array.from(document.querySelectorAll('.nav-list a'));
    const sections = Array.from(document.querySelectorAll('main .section'));

    function setActive(id) {
        navLinks.forEach(a => {
            const href = a.getAttribute('href') || '';
            a.classList.toggle('active', href === `#${id}`);
        });
    }

    // Click: smooth scroll
    navLinks.forEach(a => {
        a.addEventListener('click', (e) => {
            const href = a.getAttribute('href') || '';
            if (!href.startswith || !href.startsWith('#')) return;
            const id = href.slice(1);
            const el = document.getElementById(id);
            if (!el) return;
            e.preventDefault();
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.replaceState(null, '', href);
        });
    });

    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            const visible = entries
                .filter(en => en.isIntersecting)
                .sort((a, b) => (b.intersectionRatio - a.intersectionRatio));
            if (visible[0]) setActive(visible[0].target.id);
        }, {
            root: null,
            threshold: [0.15, 0.25, 0.35, 0.5, 0.65],
            rootMargin: '-20% 0px -65% 0px'
        });

        sections.forEach(sec => io.observe(sec));
    } else {
        // Fallback: simple scroll spy
        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(sec => {
                const top = sec.offsetTop;
                if (window.scrollY >= top - 120) current = sec.id;
            });
            if (current) setActive(current);
        });
    }
}

// ========== INIT ==========
renderKOGate();
renderScoring();
setupSearch();
setupNavActive();
