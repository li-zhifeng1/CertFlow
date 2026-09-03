/**
 * stage5.js（第5段階：ダッシュボード・一覧・デザイン・最終確認）
 *
 * 実装する内容：
 *   1. 新入社員用ダッシュボード（#/top）
 *      申請中／承認済み／結果未報告／取得資格／費用申請中 などの件数と、直近の受験予定
 *   2. 上司用承認待ちダッシュボード（#/supervisor）
 *      制度確認待ち／受験申請承認待ち／費用申請承認待ち／当月の資格取得件数
 *   3. 一覧（それぞれ検索・ステータス絞り込み・0件メッセージ）
 *      - 自分の申請履歴（#/my-history）制度確認／受験／費用申請のタブ
 *      - 自分の資格取得実績（#/my-achievements）報奨金予定額の合計付き
 *      - 全員の受験履歴・資格取得実績・費用申請履歴（#/all-history、上司向け）
 *
 * デザインは白・紺・薄いグレー中心、承認待ち=黄／承認済み=緑／却下=赤（css/style.css）。
 *
 * 方針：
 *   - 件数の集計（employeeSummary / supervisorSummary）は画面に依存しない関数にし、
 *     自動テストで確認できるようにする。
 */

"use strict";

const Stage5 = CERT_FLOW.Stage5 = {};

// デモで「自分（新入社員）」として操作する架空の固定社員ID
Stage5.CURRENT_EMPLOYEE_ID = "EMP001";

/* ===================== 件数の集計（画面に依存しない） ===================== */

/**
 * 新入社員ダッシュボード用に、自分の件数をまとめる。
 *
 * @param {Object} data - 保存データ全体
 * @param {string} employeeId - 社員ID
 * @returns {Object} 各件数
 */
Stage5.employeeSummary = function (data, employeeId) {
  const checkPending = data.qualificationCheckRequests.filter(function (r) {
    return r.applicantId === employeeId && r.status === "pending";
  }).length;
  const examPending = data.examApplications.filter(function (a) {
    return a.applicantId === employeeId && a.status === "pending";
  }).length;
  // 承認済み（結果報告済みの再掲を含む）／結果未報告
  const examApprovedTotal = data.examApplications.filter(function (a) {
    return a.applicantId === employeeId &&
      (a.status === "approved" || a.status === "completed");
  }).length;
  const examUnreported = data.examApplications.filter(function (a) {
    if (a.applicantId !== employeeId || a.status !== "approved") {
      return false;
    }
    return !data.examReports.some(function (r) { return r.examApplicationId === a.id; });
  }).length;
  const reimbPending = data.reimbursementRequests.filter(function (m) {
    return m.applicantId === employeeId && m.status === "pending";
  }).length;
  const achievements = data.achievementRecords.filter(function (x) {
    return x.applicantId === employeeId;
  });
  const achievedCount = achievements.length;
  const rewardTotal = achievements.reduce(function (sum, x) {
    return sum + (x.rewardStatus === "scheduled" && x.rewardAmount > 0 ? x.rewardAmount : 0);
  }, 0);
  return {
    checkPending: checkPending,
    examPending: examPending,
    examApprovedTotal: examApprovedTotal,
    examUnreported: examUnreported,
    reimbPending: reimbPending,
    achievedCount: achievedCount,
    rewardTotal: rewardTotal
  };
};

/**
 * 上司ダッシュボード用に、承認待ち件数と当月の資格取得件数をまとめる。
 *
 * @param {Object} data - 保存データ全体
 * @returns {Object} 各件数
 */
Stage5.supervisorSummary = function (data) {
  const checkPending = data.qualificationCheckRequests.filter(function (r) {
    return r.status === "pending";
  }).length;
  const examPending = data.examApplications.filter(function (a) {
    return a.status === "pending";
  }).length;
  const reimbPending = data.reimbursementRequests.filter(function (m) {
    return m.status === "pending";
  }).length;

  // 「当月」＝今日の YYYY-MM で始まる取得日
  const monthPrefix = CERT_FLOW.todayStr().slice(0, 7);
  const monthAchievements = data.achievementRecords.filter(function (x) {
    return x.achievedDate && String(x.achievedDate).indexOf(monthPrefix) === 0;
  }).length;

  return {
    checkPending: checkPending,
    examPending: examPending,
    reimbPending: reimbPending,
    monthAchievements: monthAchievements
  };
};

/**
 * 一覧の行データを、キーワードとステータスで絞り込む。
 *
 * @param {Array}  rows    - 行データ [{ searchText, status, html }]
 * @param {string} keyword - 検索キーワード（searchText に部分一致）
 * @param {string} status  - 絞り込みステータス（"all" は絞り込まない）
 * @returns {Array} 絞り込み後の行データ
 */
Stage5.filterRows = function (rows, keyword, status) {
  const kw = (keyword || "").trim().toLowerCase();
  return rows.filter(function (row) {
    if (status && status !== "all" && row.status !== status) {
      return false;
    }
    if (kw && row.searchText.toLowerCase().indexOf(kw) === -1) {
      return false;
    }
    return true;
  });
};

/* ===================== 画面描画（共通ヘルパー） ===================== */

/**
 * 数値カードをHTML文字列にして返す。
 *
 * @param {string} value - 数値（そのまま表示）
 * @param {string} label - ラベル
 * @returns {string} HTML文字列
 */
function statCardHtml(value, label) {
  return (
    '<div class="stat-card">' +
      '<div class="stat-value">' + value + "</div>" +
      '<div class="stat-label">' + label + "</div>" +
    "</div>"
  );
}

/**
 * タブのHTML文字列を返す。
 *
 * @param {Array}  tabs  - [{ id, label }]
 * @param {string} base  - タブのURL（例："/my-history"）
 * @param {string} current - 現在のタブID
 * @returns {string} HTML文字列
 */
function tabsHtml(tabs, base, current) {
  return '<nav class="tabs">' + tabs.map(function (t) {
    const active = t.id === current ? " is-active" : "";
    return '<a class="tab-button' + active + '" href="' + base + '?tab=' + t.id + '">' + t.label + "</a>";
  }).join("") + "</nav>";
}

/**
 * 空の一覧メッセージを返す。
 *
 * @param {string} message - 表示する文章
 * @returns {string} HTML文字列
 */
function emptyMessageHtml(message) {
  return '<p class="empty-text">' + message + "</p>";
}

/* ===================== 画面描画（新入社員ダッシュボード） ===================== */

/**
 * 直近の受験予定（未来の受験日を持つ承認済み申請）をHTML文字列にして返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {string} employeeId - 社員ID
 * @returns {string} HTML文字列
 */
function renderUpcomingExams(data, employeeId) {
  const today = CERT_FLOW.todayStr();
  const upcoming = data.examApplications
    .filter(function (a) {
      return a.applicantId === employeeId && a.status === "approved" && a.examDate >= today;
    })
    .slice()
    .sort(function (a, b) { return a.examDate < b.examDate ? -1 : 1; })
    .slice(0, 3);
  if (!upcoming.length) {
    return emptyMessageHtml("直近の受験予定はありません。");
  }
  return upcoming.map(function (a) {
    const q = data.qualifications.find(function (x) { return x.id === a.qualificationId; });
    return (
      '<div class="list-row">' +
        '<div class="list-row-head"><span class="list-title">' + CERT_FLOW.escapeHtml(q ? q.name : a.qualificationId) + "</span></div>" +
        '<div class="list-row-sub">受験日：' + CERT_FLOW.escapeHtml(a.examDate) + "／予定費用：" + CERT_FLOW.escapeHtml(String(a.expectedCost)) + "円</div>" +
      "</div>"
    );
  }).join("");
}

/**
 * 新入社員用ダッシュボード（#/top）を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 */
Stage5.renderTopDashboard = function (content, route) {
  const data = CERT_FLOW.loadData();
  const s = Stage5.employeeSummary(data, Stage5.CURRENT_EMPLOYEE_ID);

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    '<div class="stats-grid">' +
      statCardHtml(s.checkPending, "制度確認申請中") +
      statCardHtml(s.examPending, "受験申請 承認待ち") +
      statCardHtml(s.examApprovedTotal, "受験申請 承認済み") +
      statCardHtml(s.examUnreported, "結果未報告") +
      statCardHtml(s.reimbPending, "費用申請中") +
      statCardHtml(s.achievedCount, "取得資格数") +
      statCardHtml(s.rewardTotal.toLocaleString() + "円", "報奨金予定額合計") +
    "</div>" +
    '<section class="card">' +
      '<h3 class="section-title">直近の受験予定</h3>' +
      '<div>' + renderUpcomingExams(data, Stage5.CURRENT_EMPLOYEE_ID) + "</div>" +
    "</section>" +
    '<section class="card stat-actions">' +
      '<a class="btn btn-primary" href="#/qualifications">資格制度から受験申請する</a> ' +
      '<a class="btn" href="#/report">結果報告へ</a> ' +
      '<a class="btn" href="#/my-history?tab=exam">自分の申請履歴へ</a>' +
    "</section>";
};

/* ===================== 画面描画（上司ダッシュボード） ===================== */

/**
 * 上司用承認待ちダッシュボード（#/supervisor）を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 */
Stage5.renderSupervisorDashboard = function (content, route) {
  const data = CERT_FLOW.loadData();
  const s = Stage5.supervisorSummary(data);

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    '<div class="stats-grid">' +
      statCardHtml(s.checkPending, "制度確認待ち") +
      statCardHtml(s.examPending, "受験申請承認待ち") +
      statCardHtml(s.reimbPending, "費用申請承認待ち") +
      statCardHtml(s.monthAchievements, "当月の資格取得件数") +
    "</div>" +
    '<section class="card stat-actions">' +
      '<a class="btn btn-primary" href="#/check-approvals">制度確認の承認へ</a> ' +
      '<a class="btn" href="#/exam-approvals">受験申請の承認へ</a> ' +
      '<a class="btn" href="#/money-approvals">費用申請の承認へ</a> ' +
      '<a class="btn" href="#/all-history">全員の受験履歴・実績へ</a>' +
    "</section>";
};

/* ===================== 一覧（自分の申請履歴） ===================== */

/**
 * 申請履歴の行データを作る（制度確認／受験／費用申請の3種）。
 *
 * @param {Object} data - 保存データ全体
 * @param {string} employeeId - 社員ID
 * @returns {Object} { check, exam, money } それぞれ行配列 { searchText, status, html }
 */
function buildHistoryRows(data, employeeId) {
  const qName = function (id) {
    const q = data.qualifications.find(function (x) { return x.id === id; });
    return q ? q.name : id;
  };

  const checkRows = data.qualificationCheckRequests
    .filter(function (r) { return r.applicantId === employeeId; })
    .map(function (r) {
      const label = Stage2.STATUS_LABELS[r.status] || r.status;
      const extra = r.status === "rejected"
        ? '／却下理由：' + CERT_FLOW.escapeHtml(r.rejectionReason || "-")
        : (r.status === "approved"
          ? '／上限：' + (r.maxCount === null ? "上限なし" : r.maxCount + "回") +
            '／報奨金：' + (r.rewardEligible ? r.rewardAmount + "円" : "なし")
          : "");
      return {
        searchText: (r.qualificationName + " " + r.category + " " + r.reason).toLowerCase(),
        status: r.status,
        html:
          '<div class="list-row">' +
            '<div class="list-row-head">' +
              '<span class="list-title">' + CERT_FLOW.escapeHtml(r.qualificationName) + "</span>" +
              '<span class="badge ' + examStatusClass(r.status) + '">' + label + "</span>" +
            "</div>" +
            '<div class="list-row-sub">カテゴリ：' + CERT_FLOW.escapeHtml(r.category || "-") +
              "／申請日：" + CERT_FLOW.escapeHtml(r.createdDate || "-") + "</div>" +
            '<div class="list-row-sub">申請理由：' + CERT_FLOW.escapeHtml(r.reason) + extra + "</div>" +
          "</div>"
      };
    });

  const examRows = data.examApplications
    .filter(function (a) { return a.applicantId === employeeId; })
    .map(function (a) {
      const label = Stage3.EXAM_STATUS_LABELS[a.status] || a.status;
      const rejected = a.status === "rejected" ? '／却下理由：' + CERT_FLOW.escapeHtml(a.rejectionReason || "-") : "";
      return {
        searchText: (qName(a.qualificationId) + " " + a.examDate + " " + a.purpose).toLowerCase(),
        status: a.status,
        html:
          '<div class="list-row">' +
            '<div class="list-row-head">' +
              '<span class="list-title">' + CERT_FLOW.escapeHtml(qName(a.qualificationId)) + "</span>" +
              '<span class="badge ' + examStatusClass(a.status) + '">' + label + "</span>" +
            "</div>" +
            '<div class="list-row-sub">受験日：' + CERT_FLOW.escapeHtml(a.examDate) +
              "／予定費用：" + CERT_FLOW.escapeHtml(String(a.expectedCost)) + "円</div>" +
            '<div class="list-row-sub">受験目的：' + CERT_FLOW.escapeHtml(a.purpose) + rejected + "</div>" +
          "</div>"
      };
    });

  const moneyRows = data.reimbursementRequests
    .filter(function (m) { return m.applicantId === employeeId; })
    .map(function (m) {
      const label = Stage4.REIMBURSEMENT_STATUS_LABELS[m.status] || m.status;
      const rejected = m.status === "rejected" ? '／却下理由：' + CERT_FLOW.escapeHtml(m.rejectionReason || "-") : "";
      return {
        searchText: (qName(m.qualificationId) + " " + m.amount).toLowerCase(),
        status: m.status,
        html:
          '<div class="list-row">' +
            '<div class="list-row-head">' +
              '<span class="list-title">' + CERT_FLOW.escapeHtml(qName(m.qualificationId)) + "</span>" +
              '<span class="badge ' + examStatusClass(m.status) + '">' + label + "</span>" +
            "</div>" +
            '<div class="list-row-sub">金額：' + CERT_FLOW.escapeHtml(String(m.amount)) + "円／受験日：" + CERT_FLOW.escapeHtml(m.examDate) + rejected + "</div>" +
          "</div>"
      };
    });

  return { check: checkRows, exam: examRows, money: moneyRows };
}

/**
 * 絞り込みバー（検索・ステータス）を描画する。
 *
 * @param {string} inputId - 検索ボックスのID
 * @param {string} selectId - ステータス選択のID
 * @returns {string} HTML文字列
 */
function filterBarHtml(inputId, selectId) {
  return (
    '<div class="toolbar">' +
      '<input type="search" id="' + inputId + '" class="form-input" placeholder="キーワードで検索" />' +
      '<select id="' + selectId + '" class="form-select"><option value="all">ステータス：すべて</option></select>' +
    "</div>"
  );
}

/**
 * 一覧の絞り込み・描画処理をまとめて設定する。
 *
 * @param {HTMLElement} content - 画面全体の要素
 * @param {string} listId  - 一覧の表示先ID
 * @param {string} inputId - 検索ボックスID
 * @param {string} selectId - ステータス選択ID
 * @param {Array}  rows    - 行データ
 * @param {Object} statusLabels - { 値: 表示名 }（選択肢の生成用）
 * @returns {Function} 絞り込みを再実行して描画する関数
 */
function setupListFilter(content, listId, inputId, selectId, rows, statusLabels) {
  // ステータス選択肢を作る（全般的な順序を保つ）
  const order = ["pending", "approved", "rejected", "completed"];
  const used = order.filter(function (s) {
    return rows.some(function (r) { return r.status === s; });
  });
  const select = document.getElementById(selectId);
  used.forEach(function (s) {
    const label = statusLabels[s] || s;
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = "ステータス：" + label;
    select.appendChild(opt);
  });

  function apply() {
    const keyword = document.getElementById(inputId).value;
    const status = document.getElementById(selectId).value;
    const filtered = Stage5.filterRows(rows, keyword, status);
    const list = document.getElementById(listId);
    if (!filtered.length) {
      list.innerHTML = emptyMessageHtml("該当する履歴はありません。");
      return;
    }
    list.innerHTML = filtered.map(function (r) { return r.html; }).join("");
  }

  document.getElementById(inputId).addEventListener("input", apply);
  select.addEventListener("change", apply);
  apply();
  return apply;
}

/**
 * 自分の申請履歴（#/my-history）を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 */
Stage5.renderMyHistory = function (content, route) {
  const data = CERT_FLOW.loadData();
  const tab = App.currentQuery.tab || "check";
  const rows = buildHistoryRows(data, Stage5.CURRENT_EMPLOYEE_ID);

  const tabs = [
    { id: "check", label: "制度確認申請" },
    { id: "exam", label: "受験申請" },
    { id: "money", label: "費用申請" }
  ];

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    tabsHtml(tabs, "/my-history", tab) +
    '<div class="card"><div id="history-filter">' + filterBarHtml("h-history-search", "h-history-status") + "</div>" +
    '<div id="history-list"></div></div>';

  const statusLabels = {
    pending: (tab === "check" ? "確認待ち" : "承認待ち"),
    approved: "承認済み",
    rejected: "却下",
    completed: "結果報告済み"
  };
  const currentRows = rows[tab] || [];
  setupListFilter(content, "history-list", "h-history-search", "h-history-status", currentRows, statusLabels);
};

/* ===================== 自分の資格取得実績 ===================== */

/**
 * 自分の資格取得実績（#/my-achievements）を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 */
Stage5.renderMyAchievements = function (content, route) {
  const data = CERT_FLOW.loadData();
  const achievements = data.achievementRecords.filter(function (x) {
    return x.applicantId === Stage5.CURRENT_EMPLOYEE_ID;
  }).slice().reverse();
  const total = achievements.reduce(function (sum, x) {
    return sum + (x.rewardStatus === "scheduled" && x.rewardAmount > 0 ? x.rewardAmount : 0);
  }, 0);

  const listHtml = achievements.length
    ? '<div class="card-grid">' + achievements.map(function (x) {
        const q = data.qualifications.find(function (eq) { return eq.id === x.qualificationId; });
        const rewardText = x.rewardAmount > 0 ? ("報奨金予定 " + x.rewardAmount + "円") : "報奨金なし";
        return (
          '<div class="card qualif-card">' +
            '<div class="qualif-head"><h3>' + CERT_FLOW.escapeHtml(q ? q.name : x.qualificationId) + "</h3>" +
            '<span class="badge badge-ok">取得済み</span></div>' +
            '<dl class="qualif-detail">' +
              "<dt>取得日</dt><dd>" + CERT_FLOW.escapeHtml(x.achievedDate || "-") + "</dd>" +
              "<dt>報奨金</dt><dd>" + rewardText + "</dd>" +
            "</dl>" +
          "</div>"
        );
      }).join("") + "</div>"
    : emptyMessageHtml("資格取得実績はまだありません。");

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    '<div class="stats-grid">' +
      statCardHtml(achievements.length, "取得資格数") +
      statCardHtml(total.toLocaleString() + "円", "報奨金予定額合計") +
    "</div>" +
    '<section class="card"><h3 class="section-title">取得した資格</h3><div>' + listHtml + "</div></section>";
};

/* ===================== 全員の受験履歴・資格取得実績（上司） ===================== */

/**
 * 全員分の一覧 行データを作る。
 *
 * @param {Object} data - 保存データ全体
 * @returns {Object} { reports, achievements, money }
 */
function buildAllRows(data) {
  const reportRows = data.examReports.slice().reverse().map(function (r) {
    const q = data.qualifications.find(function (x) { return x.id === r.qualificationId; });
    const overallOk = r.resultType === "score"
      ? (typeof r.score === "number" && !!q && r.score >= q.targetScore)
      : (r.pass === true);
    return {
      searchText: ((q ? q.name : r.qualificationId) + " " + findEmployeeName(data, r.applicantId)).toLowerCase(),
      status: overallOk ? "ok" : "ng",
      html:
        '<div class="list-row">' +
          '<div class="list-row-head">' +
            '<span class="list-title">' + CERT_FLOW.escapeHtml(q ? q.name : r.qualificationId) + "</span>" +
            '<span class="badge ' + (overallOk ? "badge-ok" : "badge-danger") + '">' +
              (r.resultType === "score" ? r.score + "点" : (r.pass ? "合格" : "不合格")) + "</span>" +
          "</div>" +
          '<div class="list-row-sub">' + CERT_FLOW.escapeHtml(findEmployeeName(data, r.applicantId)) +
            "／受験日：" + CERT_FLOW.escapeHtml(r.examDate) +
            "／実費：" + CERT_FLOW.escapeHtml(String(r.actualCost)) + "円" +
            "／領収書：" + (r.receiptSubmitted ? "提出済み" : "未提出") +
            "／報告日：" + CERT_FLOW.escapeHtml(r.reportDate || "-") + "</div>" +
        "</div>"
    };
  });

  const achievementRows = data.achievementRecords.slice().reverse().map(function (x) {
    const q = data.qualifications.find(function (eq) { return eq.id === x.qualificationId; });
    return {
      searchText: ((q ? q.name : x.qualificationId) + " " + findEmployeeName(data, x.applicantId)).toLowerCase(),
      status: "ok",
      html:
        '<div class="list-row">' +
          '<div class="list-row-head">' +
            '<span class="list-title">' + CERT_FLOW.escapeHtml(q ? q.name : x.qualificationId) + "</span>" +
            '<span class="badge badge-ok">取得済み</span>' +
          "</div>" +
          '<div class="list-row-sub">' + CERT_FLOW.escapeHtml(findEmployeeName(data, x.applicantId)) +
            "／取得日：" + CERT_FLOW.escapeHtml(x.achievedDate || "-") +
            "／報奨金：" + (x.rewardAmount > 0 ? x.rewardAmount + "円" : "なし") + "</div>" +
        "</div>"
    };
  });

  const moneyRows = data.reimbursementRequests.slice().reverse().map(function (m) {
    const q = data.qualifications.find(function (x) { return x.id === m.qualificationId; });
    const label = Stage4.REIMBURSEMENT_STATUS_LABELS[m.status] || m.status;
    const rejectText = m.status === "rejected" ? "／却下理由：" + CERT_FLOW.escapeHtml(m.rejectionReason || "-") : "";
    return {
      searchText: ((q ? q.name : m.qualificationId) + " " + findEmployeeName(data, m.applicantId)).toLowerCase(),
      status: m.status,
      html:
        '<div class="list-row">' +
          '<div class="list-row-head">' +
            '<span class="list-title">' + CERT_FLOW.escapeHtml(q ? q.name : m.qualificationId) + "</span>" +
            '<span class="badge ' + examStatusClass(m.status) + '">' + label + "</span>" +
          "</div>" +
          '<div class="list-row-sub">' + CERT_FLOW.escapeHtml(findEmployeeName(data, m.applicantId)) +
            "／金額：" + CERT_FLOW.escapeHtml(String(m.amount)) + "円" +
            "／受験日：" + CERT_FLOW.escapeHtml(m.examDate) + rejectText + "</div>" +
        "</div>"
    };
  });

  return { reports: reportRows, achievements: achievementRows, money: moneyRows };
}

/**
 * 全員の受験履歴・資格取得実績・費用申請履歴（#/all-history、上司向け）を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 */
Stage5.renderAllHistory = function (content, route) {
  const data = CERT_FLOW.loadData();
  const tab = App.currentQuery.tab || "reports";
  const rows = buildAllRows(data);

  const tabs = [
    { id: "reports", label: "受験履歴" },
    { id: "achievements", label: "資格取得実績" },
    { id: "money", label: "費用申請履歴" }
  ];

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    tabsHtml(tabs, "/all-history", tab) +
    '<div class="card"><div id="all-filter">' + filterBarHtml("a-all-search", "a-all-status") + "</div>" +
    '<div id="all-list"></div></div>';

  const statusLabels = {
    ok: "合格／達成",
    ng: "不合格／未達",
    pending: "承認待ち",
    approved: "承認済み",
    rejected: "却下"
  };
  const currentRows = rows[tab] || [];
  setupListFilter(content, "all-list", "a-all-search", "a-all-status", currentRows, statusLabels);
};

/* ===================== 描画関数の登録 ===================== */

// 実装済みの画面を app.js（renderView）から呼び出せるように登録する
CERT_FLOW.App.registerViewRenderer("top", Stage5.renderTopDashboard);
CERT_FLOW.App.registerViewRenderer("supervisor", Stage5.renderSupervisorDashboard);
CERT_FLOW.App.registerViewRenderer("my-history", Stage5.renderMyHistory);
CERT_FLOW.App.registerViewRenderer("my-achievements", Stage5.renderMyAchievements);
CERT_FLOW.App.registerViewRenderer("all-history", Stage5.renderAllHistory);
