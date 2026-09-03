/**
 * stage3.js（第3段階：受験申請と上司承認）
 *
 * 実装する内容：
 *   1. 受験申請（新入社員向け「#/exam-apply」）
 *      - 資格制度一覧から選択し、受験日・予定費用・受験目的を入力して申請
 *      - 会社負担対象外の資格では「自己負担」であることを明示
 *      - 過去の日付は受験日にできない
 *      - 同じ社員・同じ資格（qualificationId）・同じ受験日の重複申請を防止
 *   2. 受験申請の承認・却下（上司向け「#/exam-approvals」）
 *      - 承認待ちを一覧表示し、資格制度・予定費用・受験目的を確認できる
 *      - 承認／却下。却下時は理由を必須にする
 *
 * ステータス：
 *   保存は英語コード（pending / approved / rejected / completed）、
 *   表示は日本語（承認待ち / 承認済み / 却下 / 結果報告済み）。
 *   「結果報告済み（completed）」への変更は第4段階（結果報告）で行う。
 *
 * 方針：
 *   - 業務ロジック（createExamApplication など）は DOM に依存させず、
 *     自動テストがブラウザなしで実行できるようにする。
 *   - 共通部品は data.js の CERT_FLOW（todayStr / escapeHtml）を使う。
 */

"use strict";

const Stage3 = CERT_FLOW.Stage3 = {};

// デモで「自分（新入社員）」として操作する架空の固定社員ID
Stage3.CURRENT_EMPLOYEE_ID = "EMP001";

// 受験申請のステータス表示名
Stage3.EXAM_STATUS_LABELS = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  completed: "結果報告済み"
};

/* ===================== 共通の補助関数 ===================== */

/**
 * 受験申請のステータスに対応するバッジのクラス名を返す。
 *
 * @param {string} status - status（pending / approved / rejected / completed）
 * @returns {string} CSSクラス名
 */
function examStatusClass(status) {
  if (status === "approved") {
    return "badge-ok";
  }
  if (status === "rejected") {
    return "badge-danger";
  }
  if (status === "completed") {
    return "badge-info";
  }
  return "badge-warn";
}

/**
 * 申請者の名前を返す（見つからない場合は「不明」）。
 *
 * @param {Object} data - 保存データ全体
 * @param {string} employeeId - 社員ID
 * @returns {string} 社員名
 */
function findEmployeeName(data, employeeId) {
  const emp = data.employees.find(function (e) {
    return e.id === employeeId;
  });
  return emp ? emp.name : "不明";
}

/**
 * 選択した資格の負担情報をHTML文字列にして返す。
 * 会社負担対象外の資格は「自己負担」であることをはっきり表示する。
 *
 * @param {Object} data - 保存データ全体
 * @param {Object|null} q - 選択中の資格
 * @returns {string} HTML文字列
 */
function qualificationInfoHtml(data, q) {
  if (!q) {
    return '<p class="empty-text">資格を選択すると、負担条件を表示します。</p>';
  }
  const covered = q.ruleType !== "notEligible";
  const coverText = covered ? "会社負担対象" : "会社負担対象外";
  const coverCls = covered ? "badge-ok" : "badge-danger";
  const limitText = (q.maxCount === null || q.maxCount === undefined) ? "上限なし" : q.maxCount + "回";
  const conditionText = (typeof Stage2.describeCondition === "function")
    ? Stage2.describeCondition(q)
    : "";

  return (
    '<p>負担可否：<span class="badge ' + coverCls + '">' + coverText + "</span></p>" +
    "<p>負担条件：" + CERT_FLOW.escapeHtml(conditionText) + "</p>" +
    "<p>負担上限回数：" + limitText + "</p>" +
    (q.rewardEligible ? "<p>報奨金：" + q.rewardAmount + "円</p>" : "") +
    (covered ? "" :
      '<div class="message message-warn">この資格は会社負担対象外のため、自己負担（自費）での受験になります。</div>')
  );
}

/**
 * 「自分の受験申請一覧」をHTML文字列にして返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {Array}  apps - 本人の受験申請の配列
 * @returns {string} HTML文字列
 */
function renderOwnExamApps(data, apps) {
  if (!apps.length) {
    return '<p class="empty-text">まだ受験申請はありません。</p>';
  }
  return apps.map(function (a) {
    const q = data.qualifications.find(function (x) { return x.id === a.qualificationId; });
    const qName = q ? q.name : a.qualificationId;
    const label = Stage3.EXAM_STATUS_LABELS[a.status] || a.status;
    const rejectedText = a.status === "rejected"
      ? '<div class="list-row-sub">却下理由：' + CERT_FLOW.escapeHtml(a.rejectionReason || "（理由未入力）") + "</div>"
      : "";

    return (
      '<div class="list-row">' +
        '<div class="list-row-head">' +
          '<span class="list-title">' + CERT_FLOW.escapeHtml(qName) + "</span>" +
          '<span class="badge ' + examStatusClass(a.status) + '">' + label + "</span>" +
        "</div>" +
        '<div class="list-row-sub">受験日：' + CERT_FLOW.escapeHtml(a.examDate) +
          "／予定費用：" + CERT_FLOW.escapeHtml(String(a.expectedCost)) + "円</div>" +
        '<div class="list-row-sub">受験目的：' + CERT_FLOW.escapeHtml(a.purpose) + "</div>" +
        rejectedText +
      "</div>"
    );
  }).join("");
}

/* ===================== 業務ロジック（画面に依存しない） ===================== */

/**
 * 受験申請を作成する。
 * 入力チェックと重複申請の防止を行う。
 *
 * @param {Object} data  - 保存データ全体
 * @param {Object} input - 入力内容
 *   { qualificationId, examDate, expectedCost, purpose, employeeId, createdDate }
 * @returns {{error: string|null}} error が null なら成功
 */
Stage3.createExamApplication = function (data, input) {
  const qualification = data.qualifications.find(function (q) {
    return q.id === input.qualificationId;
  });
  if (!input.qualificationId || !qualification) {
    return { error: "資格を選択してください。" };
  }

  const examDate = (input.examDate || "").trim();
  if (!examDate) {
    return { error: "受験日を入力してください。" };
  }
  if (examDate < CERT_FLOW.todayStr()) {
    return { error: "過去の日付は受験日にできません。今日以降の日付を入力してください。" };
  }

  const cost = Number(input.expectedCost);
  if (input.expectedCost === "" || input.expectedCost === null || input.expectedCost === undefined ||
      !Number.isInteger(cost) || cost < 0) {
    return { error: "予定費用は 0 以上の整数を入力してください。" };
  }

  const purpose = (input.purpose || "").trim();
  if (!purpose) {
    return { error: "受験目的を入力してください。" };
  }

  // 同じ社員・同じ資格・同じ受験日で、却下されていない申請があれば重複として拒否
  const duplicated = data.examApplications.some(function (a) {
    return a.applicantId === input.employeeId &&
      a.qualificationId === input.qualificationId &&
      a.examDate === examDate &&
      a.status !== "rejected";
  });
  if (duplicated) {
    return { error: "同じ資格・同じ受験日の申請がすでにあるため、申請できません。" };
  }

  data.examApplications.push({
    id: CERT_FLOW.generateId("A", data.examApplications),
    qualificationId: input.qualificationId,
    applicantId: input.employeeId,
    examDate: examDate,
    expectedCost: cost,
    purpose: purpose,
    status: "pending", // 承認待ち
    rejectionReason: null,
    createdDate: input.createdDate,
    approvedDate: null
  });

  return { error: null };
};

/**
 * 受験申請を承認する。
 * すでに処理済みの申請は承認できない（二重承認の防止）。
 *
 * @param {Object} data   - 保存データ全体
 * @param {string} applicationId - 承認する受験申請ID
 * @param {string} decidedDate - 判定日（YYYY-MM-DD）
 * @returns {{error: string|null}} 成否
 */
Stage3.approveExamApplication = function (data, applicationId, decidedDate) {
  const app = data.examApplications.find(function (a) {
    return a.id === applicationId;
  });
  if (!app) {
    return { error: "受験申請が見つかりません。" };
  }
  if (app.status !== "pending") {
    return {
      error: "この申請はすでに処理済み（" +
        (Stage3.EXAM_STATUS_LABELS[app.status] || app.status) +
        "）のため、承認できません。"
    };
  }
  app.status = "approved";
  app.approvedDate = decidedDate;
  return { error: null };
};

/**
 * 受験申請を却下する。却下理由は必須。
 *
 * @param {Object} data   - 保存データ全体
 * @param {string} applicationId - 却下する受験申請ID
 * @param {string} reason - 却下理由
 * @returns {{error: string|null}} 成否
 */
Stage3.rejectExamApplication = function (data, applicationId, reason) {
  const app = data.examApplications.find(function (a) {
    return a.id === applicationId;
  });
  if (!app) {
    return { error: "受験申請が見つかりません。" };
  }
  if (app.status !== "pending") {
    return {
      error: "この申請はすでに処理済み（" +
        (Stage3.EXAM_STATUS_LABELS[app.status] || app.status) +
        "）のため、却下できません。"
    };
  }
  const trimmed = (reason || "").trim();
  if (!trimmed) {
    return { error: "却下する場合は理由を入力してください。" };
  }
  app.status = "rejected";
  app.rejectionReason = trimmed;
  return { error: null };
};

/**
 * 指定した社員の受験申請を返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {string} employeeId - 社員ID
 * @returns {Array} その社員の受験申請（新しい申請を上に表示）
 */
Stage3.getExamApplicationsOf = function (data, employeeId) {
  return data.examApplications
    .filter(function (a) {
      return a.applicantId === employeeId;
    })
    .slice()
    .reverse();
};

/* ===================== 画面描画 ===================== */

/**
 * 新入社員向け「受験申請」画面を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 */
Stage3.renderExamApply = function (content, route) {
  const data = CERT_FLOW.loadData();
  const presetId = App.currentQuery.qualificationId || ""; // 一覧の「受験申請」ボタンから選ばれた場合
  const myApps = Stage3.getExamApplicationsOf(data, Stage3.CURRENT_EMPLOYEE_ID);

  const optionHtml = data.qualifications.map(function (q) {
    const selected = q.id === presetId ? " selected" : "";
    return '<option value="' + CERT_FLOW.escapeHtml(q.id) + '"' + selected + ">" +
      CERT_FLOW.escapeHtml(q.name) + "（" + CERT_FLOW.escapeHtml(q.category || "未分類") + "）</option>";
  }).join("");

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    '<div class="split">' +
      '<section class="card">' +
        '<h3 class="section-title">受験申請</h3>' +
        '<form id="exam-apply-form" novalidate>' +
          '<div class="form-group"><label>資格 <em>（必須）</em></label>' +
            '<select id="ea-qualification" class="form-select"><option value="">選択してください</option>' + optionHtml + "</select>" +
          "</div>" +
          '<div id="ea-qualif-info"></div>' +
          '<div class="form-row">' +
            '<div class="form-group"><label>受験日 <em>（必須・今日以降）</em></label>' +
              '<input type="date" id="ea-date" class="form-input" min="' + CERT_FLOW.todayStr() + '" />' +
            "</div>" +
            '<div class="form-group"><label>予定費用（円） <em>（必須）</em></label>' +
              '<input type="number" id="ea-cost" class="form-input" min="0" step="1" placeholder="例：7500" />' +
            "</div>" +
          "</div>" +
          '<div class="form-group"><label>受験目的 <em>（必須）</em></label>' +
            '<textarea id="ea-purpose" class="form-input" rows="3" placeholder="例：業務で必要な知識の確認"></textarea>' +
          "</div>" +
          '<div id="ea-message"></div>' +
          '<div class="form-actions">' +
            '<button type="submit" class="btn btn-primary">受験申請を送る</button>' +
          "</div>" +
        "</form>" +
      "</section>" +
      '<section class="card">' +
        '<h3 class="section-title">自分の受験申請一覧</h3>' +
        '<div id="own-exam-apps">' + renderOwnExamApps(data, myApps) + "</div>" +
      "</section>" +
    "</div>";

  // 資格の選択に応じて負担情報を表示し直す
  const qSelect = document.getElementById("ea-qualification");
  const qInfo = document.getElementById("ea-qualif-info");
  function updateQualifInfo() {
    const q = data.qualifications.find(function (x) { return x.id === qSelect.value; });
    qInfo.innerHTML = qualificationInfoHtml(data, q);
  }
  qSelect.addEventListener("change", updateQualifInfo);
  updateQualifInfo();

  // 受験申請の送信処理
  document.getElementById("exam-apply-form").addEventListener("submit", function (event) {
    event.preventDefault();
    const input = {
      qualificationId: qSelect.value,
      examDate: document.getElementById("ea-date").value,
      expectedCost: document.getElementById("ea-cost").value,
      purpose: document.getElementById("ea-purpose").value,
      employeeId: Stage3.CURRENT_EMPLOYEE_ID,
      createdDate: CERT_FLOW.todayStr()
    };
    const result = Stage3.createExamApplication(data, input);
    const box = document.getElementById("ea-message");
    if (result.error) {
      box.innerHTML = '<div class="message message-error">' + CERT_FLOW.escapeHtml(result.error) + "</div>";
      return;
    }
    CERT_FLOW.saveData(data);
    box.innerHTML = '<div class="message message-success">受験申請を送りました。ステータスは「承認待ち」です。</div>';
    document.getElementById("exam-apply-form").reset();
    updateQualifInfo();
    // 自分の受験申請一覧を更新
    document.getElementById("own-exam-apps").innerHTML =
      renderOwnExamApps(data, Stage3.getExamApplicationsOf(data, Stage3.CURRENT_EMPLOYEE_ID));
  });
};

/**
 * 承認フォーム（受験申請1件分）を返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {Object} a    - 受験申請
 * @returns {string} HTML文字列
 */
function examApprovalCardHtml(data, a) {
  const q = data.qualifications.find(function (x) { return x.id === a.qualificationId; });
  const qName = q ? q.name : a.qualificationId;
  return (
    '<div class="card approval-card" id="ea-' + CERT_FLOW.escapeHtml(a.id) + '">' +
      '<div class="list-row-head">' +
        '<span class="list-title">' + CERT_FLOW.escapeHtml(qName) + "</span>" +
        '<span class="badge badge-warn">承認待ち</span>' +
      "</div>" +
      '<div class="list-row-sub">申請者：' + CERT_FLOW.escapeHtml(findEmployeeName(data, a.applicantId)) +
        "／受験日：" + CERT_FLOW.escapeHtml(a.examDate) +
        "／予定費用：" + CERT_FLOW.escapeHtml(String(a.expectedCost)) + "円</div>" +
      '<div class="list-row-sub">受験目的：' + CERT_FLOW.escapeHtml(a.purpose) + "</div>" +
      '<div class="approval-form">' +
        '<div class="form-group"><label>却下理由（却下する場合に必須）</label>' +
          '<textarea class="form-input ea-reason" rows="2" placeholder="却下する場合は理由を入力してください"></textarea>' +
        "</div>" +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-success" data-exam-action="approve" data-exam-action-id="' + CERT_FLOW.escapeHtml(a.id) + '">承認</button> ' +
          '<button type="button" class="btn btn-danger" data-exam-action="reject" data-exam-action-id="' + CERT_FLOW.escapeHtml(a.id) + '">却下</button>' +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

/**
 * 処理済み（承認／却下）の受験申請1件をHTML文字列にして返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {Object} a    - 受験申請
 * @returns {string} HTML文字列
 */
function examHistoryRowHtml(data, a) {
  const q = data.qualifications.find(function (x) { return x.id === a.qualificationId; });
  const qName = q ? q.name : a.qualificationId;
  const label = Stage3.EXAM_STATUS_LABELS[a.status] || a.status;
  const extra = a.status === "rejected"
    ? '<div class="list-row-sub">却下理由：' + CERT_FLOW.escapeHtml(a.rejectionReason || "（理由未入力）") + "</div>"
    : "";
  return (
    '<div class="list-row">' +
      '<div class="list-row-head">' +
        '<span class="list-title">' + CERT_FLOW.escapeHtml(qName) + "</span>" +
        '<span class="badge ' + examStatusClass(a.status) + '">' + label + "</span>" +
      "</div>" +
      '<div class="list-row-sub">申請者：' + CERT_FLOW.escapeHtml(findEmployeeName(data, a.applicantId)) +
        "／受験日：" + CERT_FLOW.escapeHtml(a.examDate) +
        "／予定費用：" + CERT_FLOW.escapeHtml(String(a.expectedCost)) + "円</div>" +
      '<div class="list-row-sub">受験目的：' + CERT_FLOW.escapeHtml(a.purpose) + "</div>" +
      extra +
    "</div>"
  );
}

/**
 * 上司向け「受験申請承認一覧」画面を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 * @param {Object|null} msg - 直前の操作結果メッセージ（{text, type}）
 */
Stage3.renderExamApprovals = function (content, route, msg) {
  const data = CERT_FLOW.loadData();
  const pending = data.examApplications.filter(function (a) {
    return a.status === "pending";
  });
  const decided = data.examApplications.filter(function (a) {
    return a.status !== "pending";
  });

  const messageHtml = msg
    ? '<div class="message message-' + msg.type + '">' + CERT_FLOW.escapeHtml(msg.text) + "</div>"
    : "";

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    messageHtml +
    '<section class="card">' +
      '<h3 class="section-title">承認待ち（' + pending.length + '件）</h3>' +
      (pending.length
        ? '<div class="approval-list">' + pending.map(function (a) { return examApprovalCardHtml(data, a); }).join("") + "</div>"
        : '<p class="empty-text">承認待ちの受験申請はありません。</p>') +
    "</section>" +
    '<section class="card">' +
      '<h3 class="section-title">処理済み（承認／却下）</h3>' +
      (decided.length
        ? '<div class="approval-history">' + decided.map(function (a) { return examHistoryRowHtml(data, a); }).join("") + "</div>"
        : '<p class="empty-text">処理済みの受験申請はありません。</p>') +
    "</section>";

  // 承認／却下ボタンの処理
  content.querySelectorAll("[data-exam-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.dataset.examActionId;
      const action = btn.dataset.examAction;
      const card = document.getElementById("ea-" + id);

      if (action === "approve") {
        const result = Stage3.approveExamApplication(data, id, CERT_FLOW.todayStr());
        if (result.error) {
          Stage3.renderExamApprovals(content, route, { text: result.error, type: "error" });
          return;
        }
        CERT_FLOW.saveData(data);
        Stage3.renderExamApprovals(content, route, {
          text: "受験申請 " + id + " を承認しました。",
          type: "success"
        });
      } else {
        const reason = card.querySelector(".ea-reason").value;
        const result = Stage3.rejectExamApplication(data, id, reason);
        if (result.error) {
          Stage3.renderExamApprovals(content, route, { text: result.error, type: "error" });
          return;
        }
        CERT_FLOW.saveData(data);
        Stage3.renderExamApprovals(content, route, {
          text: "受験申請 " + id + " を却下しました。",
          type: "success"
        });
      }
    });
  });
};

/* ===================== 描画関数の登録 ===================== */

// 実装済みの画面を app.js（renderView）から呼び出せるように登録する
CERT_FLOW.App.registerViewRenderer("exam-apply", Stage3.renderExamApply);
CERT_FLOW.App.registerViewRenderer("exam-approvals", Stage3.renderExamApprovals);
