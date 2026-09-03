/**
 * stage4.js（第4段階：結果報告・費用申請・取得実績への集約）
 *
 * 実装する内容：
 *   1. 試験結果報告（新入社員向け「#/report」）
 *      - 承認済みの受験申請だけが結果報告の対象
 *      - 合否型は「合格／不合格」、スコア型（TOEIC）は「取得点数」を入力
 *      - 実際の受験費用・領収書提出有無を入力（合格／目標達成の場合は取得日も入力）
 *      - 同じ受験申請に結果を二重登録できない
 *      - 合否に関係なく examReports（受験履歴）へ保存し、元の申請を「結果報告済み」に更新
 *   2. 費用申請の自動判定（画面表示から分離した関数）
 *      条件：会社負担対象 / 受験申請が承認済み / 上限回数未満 / 合否・点数条件 / 領収書提出済み
 *   3. 資格取得実績・報奨金の記録
 *      - 合否型で合格した場合だけ achievementRecords へ作成
 *      - 報奨金（報奨金額 > 0）があれば予定額を記録（領収書は報奨金の条件ではない）
 *   4. 費用申請の承認・却下（上司向け「#/money-approvals」）
 *      - 承認時にも回数上限を再確認する（上限到達時は承認不可）
 *      - 同じ費用申請を二重承認できない
 *
 * 方針：
 *   - 「金額と回数の判定処理」は画面表示処理から分離した関数
 *     （evaluateReimbursement / countUsedApprovals など）にまとめる。
 *   - 業務ロジックは DOM に依存させず、自動テストがブラウザなしで実行できるようにする。
 */

"use strict";

const Stage4 = CERT_FLOW.Stage4 = {};

// デモで「自分（新入社員）」として操作する架空の固定社員ID
Stage4.CURRENT_EMPLOYEE_ID = "EMP001";

// 費用申請のステータス表示名
Stage4.REIMBURSEMENT_STATUS_LABELS = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下"
};

/* ===================== 日付と回数の計算（共通） ===================== */

/**
 * 入社日に「months」か月を加算した日付を「YYYY-MM-DD」で返す。
 * この日は期間に含まない（期末の翌日）。
 * 例：2026-04-01 ＋ 3か月 → 2026-07-01
 *
 * @param {string} joinedDate - 入社日（YYYY-MM-DD）
 * @param {number} months     - 加算する月数
 * @returns {string} 期限日（YYYY-MM-DD）
 */
Stage4.calcPeriodEnd = function (joinedDate, months) {
  const parts = String(joinedDate).split("-").map(Number);
  const year = parts[0];
  const month = parts[1] - 1;
  const day = parts[2] || 1;
  const end = new Date(year, month + months, day);
  const m = String(end.getMonth() + 1).padStart(2, "0");
  const day2 = String(end.getDate()).padStart(2, "0");
  return end.getFullYear() + "-" + m + "-" + day2;
};

/**
 * 受験日が属する「年度」を返す（年度開始月が startMonth のとき）。
 * 例：startMonth=4 の場合、2026-05-10 → 2026年度 / 2027-02-10 → 2026年度
 *
 * @param {string} dateStr - 「YYYY-MM-DD」形式の日付
 * @param {number} startMonth - 年度の開始月（1〜12）
 * @returns {number} 年度
 */
Stage4.fiscalYearOf = function (dateStr, startMonth) {
  const parts = String(dateStr).split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  return month >= startMonth ? year : year - 1;
};

/**
 * 「当月までの利用回数」を数える。
 * - countScope === "quotaGroup"：同じ年度・同じグループ（quotaGroup）で合算
 * - それ以外：同じ資格（qualificationId）単独で集計
 * 数える対象は「同じ社員の承認済み費用申請」だけ。
 *
 * @param {Object} data - 保存データ全体
 * @param {Object} qualification - 資格制度マスタの1件
 * @param {string} employeeId - 社員ID
 * @param {string} examDate   - 現在の受験日（年度の特定に使う）
 * @returns {number} 利用回数
 */
Stage4.countUsedApprovals = function (data, qualification, employeeId, examDate) {
  const approved = data.reimbursementRequests.filter(function (m) {
    return m.applicantId === employeeId && m.status === "approved";
  });

  if (qualification.countScope === "quotaGroup") {
    const year = Stage4.fiscalYearOf(examDate, qualification.fiscalYearStartMonth || 4);
    return approved.filter(function (m) {
      const q = data.qualifications.find(function (x) { return x.id === m.qualificationId; });
      return q && q.quotaGroup === qualification.quotaGroup &&
        Stage4.fiscalYearOf(m.examDate, qualification.fiscalYearStartMonth || 4) === year;
    }).length;
  }

  return approved.filter(function (m) {
    return m.qualificationId === qualification.id;
  }).length;
};

/**
 * 点数入力（スコア型）で目標を達成したかを判定する。
 *
 * @param {Object} qualification - 資格制度マスタの1件
 * @param {Object} report        - 結果報告
 * @returns {boolean} 達成なら true
 */
function isScoreAchieved(qualification, report) {
  return typeof report.score === "number" && report.score >= qualification.targetScore;
}

/**
 * 結果報告の「合格／達成」を判定する（実績の要否に使う）。
 *
 * @param {Object} qualification - 資格制度マスタの1件
 * @param {Object} report        - 結果報告
 * @returns {boolean} 合格（または目標達成）なら true
 */
function reportPassed(qualification, report) {
  if (qualification.resultType === "score") {
    return isScoreAchieved(qualification, report);
  }
  return report.pass === true;
}

/* ===================== 費用申請の自動判定（画面に依存しない） ===================== */

/**
 * 費用申請の対象判定を行う。次の順序で確認し、最初に満たされなかった条件の理由を返す。
 *   1. この結果から費用申請を作成済みでないか（二重作成の防止）
 *   2. 会社負担対象か（ruleType）
 *   3. 制度の条件を満たすか（入社後期間・合否・目標点数）
 *   4. 負担上限回数未満か
 *   5. 領収書が提出済みか
 *
 * @param {Object} data   - 保存データ全体
 * @param {Object} report - 結果報告（examReportsの1件）
 * @returns {{eligible: boolean, reason?: string}} 対象なら eligible=true
 */
Stage4.evaluateReimbursement = function (data, report) {
  const qualification = data.qualifications.find(function (q) {
    return q.id === report.qualificationId;
  });
  if (!qualification) {
    return { eligible: false, reason: "資格が見つかりません。" };
  }

  // 1. 二重作成の防止
  if (data.reimbursementRequests.some(function (m) { return m.examReportId === report.id; })) {
    return { eligible: false, reason: "この結果の費用申請はすでに作成されています。" };
  }

  const employee = data.employees.find(function (e) { return e.id === report.applicantId; });

  // 2・3. ruleType ごとの対象条件（受験日に基づく）
  switch (qualification.ruleType) {
    case "notEligible":
      return { eligible: false, reason: "会社負担対象外の資格です" };
    case "withinJoiningPeriod":
      if (employee && employee.joinedDate) {
        const end = Stage4.calcPeriodEnd(employee.joinedDate, qualification.periodMonths);
        const within = employee.joinedDate <= report.examDate && report.examDate < end;
        if (!within) {
          return {
            eligible: false,
            reason: "入社後" + qualification.periodMonths + "か月を過ぎた受験のため対象外です"
          };
        }
      }
      break;
    case "passRequired":
      if (report.pass !== true) {
        return { eligible: false, reason: "合格条件を満たしていません" };
      }
      break;
    case "scoreRequired":
      if (!isScoreAchieved(qualification, report)) {
        return { eligible: false, reason: "会社指定の目標点数に達していません" };
      }
      break;
    case "annualCategoryLimit":
      // 条件そのものは「合否問わず」なので、回数（4）と年度（以降）で確認する
      break;
    default:
      break;
  }

  // 4. 負担上限回数未満か
  if (qualification.maxCount !== null && qualification.maxCount !== undefined) {
    const used = Stage4.countUsedApprovals(data, qualification, report.applicantId, report.examDate);
    if (used >= qualification.maxCount) {
      const reason = qualification.countScope === "quotaGroup"
        ? "対象年度の" + (qualification.quotaGroup || "グループ") + "の上限回数に達しています"
        : "負担回数の上限に達しています";
      return { eligible: false, reason: reason };
    }
  }

  // 5. 領収書が提出済みか
  if (!report.receiptSubmitted) {
    return { eligible: false, reason: "領収書が未提出です" };
  }

  return { eligible: true };
};

/* ===================== 結果報告の保存処理（画面に依存しない） ===================== */

/**
 * 結果報告を作成し、受験履歴・元申請・取得実績・費用申請を更新する。
 *
 * @param {Object} data  - 保存データ全体（この中を更新する）
 * @param {Object} input - 入力内容
 *   { examApplicationId, pass, score, actualCost, receiptSubmitted, acquiredDate, reportDate }
 * @returns {{error: string|null, messages?: string[], reportId?: string, passed?: boolean, eligible?: boolean, reason?: string, reimbursementId?: string|null}}
 */
Stage4.createExamReport = function (data, input) {
  const app = data.examApplications.find(function (a) {
    return a.id === input.examApplicationId;
  });
  if (!app) {
    return { error: "受験申請が見つかりません。" };
  }
  if (data.examReports.some(function (r) { return r.examApplicationId === app.id; })) {
    return { error: "この受験申請はすでに結果報告済みです。（二重登録はできません）" };
  }
  if (app.status === "pending") {
    return { error: "この受験申請はまだ承認されていません。" };
  }
  if (app.status === "rejected") {
    return { error: "却下された受験申請は結果報告できません。" };
  }
  if (app.status !== "approved") {
    return { error: "この受験申請は結果報告の対象ではありません。" };
  }

  const qualification = data.qualifications.find(function (q) {
    return q.id === app.qualificationId;
  });
  if (!qualification) {
    return { error: "資格が見つかりません。" };
  }

  // ---- 入力チェック ----
  const actualCost = Number(input.actualCost);
  if (input.actualCost === "" || input.actualCost === null || input.actualCost === undefined ||
      !Number.isInteger(actualCost) || actualCost < 0) {
    return { error: "実際の受験費用は 0 以上の整数を入力してください。" };
  }

  let pass = null;
  let score = null;
  if (qualification.resultType === "score") {
    score = Number(input.score);
    if (input.score === "" || input.score === null || input.score === undefined ||
        !Number.isInteger(score) || score < 0) {
      return { error: "取得点数は 0 以上の整数を入力してください。" };
    }
  } else {
    if (input.pass === null || input.pass === undefined) {
      return { error: "合格か不合格かを選択してください。" };
    }
    pass = input.pass === true;
  }

  if (input.receiptSubmitted === null || input.receiptSubmitted === undefined) {
    return { error: "領収書の提出状況を選択してください。" };
  }

  const passed = reportPassed(qualification, { pass: pass, score: score });

  // 合格の場合は取得日が必要（スコア型は取得実績を作らないため不要）
  let acquiredDate = (input.acquiredDate || "").toString();
  if (passed && qualification.resultType !== "score") {
    const requiredDate = acquiredDate.trim();
    if (!requiredDate) {
      return { error: "合格の場合は取得日を入力してください。" };
    }
    if (requiredDate > CERT_FLOW.todayStr()) {
      return { error: "取得日に未来の日付は指定できません。" };
    }
    acquiredDate = requiredDate;
  } else {
    acquiredDate = "";
  }

  const receiptSubmitted = input.receiptSubmitted === true;

  // ---- 保存処理 ----
  // 1) 受験履歴（examReports）へ保存（合否に関係なく）
  const report = {
    id: CERT_FLOW.generateId("ER", data.examReports),
    examApplicationId: app.id,
    qualificationId: app.qualificationId,
    applicantId: app.applicantId,
    examDate: app.examDate,
    resultType: qualification.resultType,
    pass: pass,
    score: score,
    actualCost: actualCost,
    receiptSubmitted: receiptSubmitted,
    reportDate: input.reportDate
  };
  data.examReports.push(report);

  // 2) 元の受験申請を「結果報告済み」に更新
  app.status = "completed";

  const messages = ["結果を報告し、受験履歴に保存しました。"];

  // 3) 取得実績（合否型で合格した場合だけ作成）
  let rewardNote = "";
  if (qualification.resultType !== "score" && passed) {
    const rewardEligible = qualification.rewardAmount > 0;
    data.achievementRecords.push({
      id: CERT_FLOW.generateId("AR", data.achievementRecords),
      qualificationId: qualification.id,
      applicantId: app.applicantId,
      examReportId: report.id,
      achievedDate: acquiredDate,
      rewardEligible: rewardEligible,
      rewardAmount: rewardEligible ? qualification.rewardAmount : 0,
      rewardStatus: rewardEligible ? "scheduled" : ""
    });
    messages.push("資格取得実績に登録しました。");
    if (rewardEligible) {
      rewardNote = "（報奨金予定額 " + qualification.rewardAmount + "円 を記録）";
      messages.push("報奨金予定額を記録しました。（" + qualification.rewardAmount + "円）");
    } else {
      rewardNote = "（報奨金なし）";
    }
  } else if (qualification.resultType === "score") {
    if (passed) {
      // スコア型（TOEIC）は「スコア実績」として受験履歴で管理する（取得実績には入れない）
      messages.push("会社の目標点数を達成しました（スコア実績として受験履歴に記録）。");
    }
  } else {
    messages.push("不合格のため、資格取得実績には登録しません。");
  }

  // 4) 費用申請の自動判定
  const evalResult = Stage4.evaluateReimbursement(data, report);
  let reimbursementId = null;
  if (evalResult.eligible) {
    const reimbursement = {
      id: CERT_FLOW.generateId("RR", data.reimbursementRequests),
      examReportId: report.id,
      examApplicationId: app.id,
      qualificationId: qualification.id,
      applicantId: app.applicantId,
      examDate: app.examDate,
      amount: actualCost, // 実際の受験費用を申請額とする
      status: "pending",  // 承認待ち
      rejectionReason: null,
      createdDate: input.reportDate,
      approvedDate: null
    };
    data.reimbursementRequests.push(reimbursement);
    reimbursementId = reimbursement.id;
    messages.push("費用負担条件を満たしたため、費用申請（" + reimbursement.amount + "円）を作成しました。");
  } else {
    messages.push("費用申請は作成されません。理由：" + evalResult.reason);
  }

  return {
    error: null,
    messages: messages,
    reportId: report.id,
    passed: passed,
    eligible: evalResult.eligible,
    reason: evalResult.reason,
    reimbursementId: reimbursementId,
    rewardNote: rewardNote
  };
};

/* ===================== 費用申請の承認・却下（画面に依存しない） ===================== */

/**
 * 費用申請を承認する。
 * 承認する時点で回数上限を再確認し、上限に達していれば承認不可。
 * 処理済みの費用申請は再承認できない（二重承認の防止）。
 *
 * @param {Object} data   - 保存データ全体
 * @param {string} mId    - 費用申請ID
 * @param {string} decidedDate - 判定日（YYYY-MM-DD）
 * @returns {{error: string|null}} 成否
 */
Stage4.approveReimbursement = function (data, mId, decidedDate) {
  const m = data.reimbursementRequests.find(function (x) { return x.id === mId; });
  if (!m) {
    return { error: "費用申請が見つかりません。" };
  }
  if (m.status !== "pending") {
    return {
      error: "この費用申請はすでに処理済み（" +
        (Stage4.REIMBURSEMENT_STATUS_LABELS[m.status] || m.status) +
        "）のため、承認できません。"
    };
  }
  const qualification = data.qualifications.find(function (q) { return q.id === m.qualificationId; });
  if (!qualification) {
    return { error: "資格が見つかりません。" };
  }
  if (qualification.maxCount !== null && qualification.maxCount !== undefined) {
    const used = Stage4.countUsedApprovals(data, qualification, m.applicantId, m.examDate);
    if (used >= qualification.maxCount) {
      return { error: "負担回数の上限に達しているため、この費用申請は承認できません。" };
    }
  }
  m.status = "approved";
  m.approvedDate = decidedDate;
  return { error: null };
};

/**
 * 費用申請を却下する。却下理由は必須。
 *
 * @param {Object} data   - 保存データ全体
 * @param {string} mId    - 費用申請ID
 * @param {string} reason - 却下理由
 * @returns {{error: string|null}} 成否
 */
Stage4.rejectReimbursement = function (data, mId, reason) {
  const m = data.reimbursementRequests.find(function (x) { return x.id === mId; });
  if (!m) {
    return { error: "費用申請が見つかりません。" };
  }
  if (m.status !== "pending") {
    return {
      error: "この費用申請はすでに処理済み（" +
        (Stage4.REIMBURSEMENT_STATUS_LABELS[m.status] || m.status) +
        "）のため、却下できません。"
    };
  }
  const trimmed = (reason || "").trim();
  if (!trimmed) {
    return { error: "却下する場合は理由を入力してください。" };
  }
  m.status = "rejected";
  m.rejectionReason = trimmed;
  return { error: null };
};

/**
 * 対象の社員の費用申請を返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {string} employeeId - 社員ID
 * @returns {Array} その社員の費用申請（新しい順）
 */
Stage4.getReimbursementsOf = function (data, employeeId) {
  return data.reimbursementRequests
    .filter(function (m) {
      return m.applicantId === employeeId;
    })
    .slice()
    .reverse();
};

/* ===================== 画面描画（共通ヘルパー） ===================== */

/**
 * 結果の表示テキスト（合格／不合格／点数）を返す。
 *
 * @param {Object} data   - 保存データ全体
 * @param {Object} report - 結果報告
 * @returns {string} 例："合格" / "不合格" / "760点（目標730点）"
 */
function resultText(data, report) {
  if (report.resultType === "score") {
    const q = data.qualifications.find(function (x) { return x.id === report.qualificationId; });
    const target = q ? q.targetScore : "-";
    return report.score + "点（目標 " + target + "点）";
  }
  return report.pass ? "合格" : "不合格";
}

/**
 * 受験履歴（自分の成果）をHTML文字列にして返す。
 *
 * @param {Object} data    - 保存データ全体
 * @param {Array}  reports - 結果報告の配列
 * @returns {string} HTML文字列
 */
function renderOwnExamHistory(data, reports) {
  if (!reports.length) {
    return '<p class="empty-text">まだ受験履歴はありません。</p>';
  }
  return reports.map(function (r) {
    const q = data.qualifications.find(function (x) { return x.id === r.qualificationId; });
    const qName = q ? q.name : r.qualificationId;
    // 達成判定（スコア型は目標点数以上かどうか、合否型は合格かどうか）
    const overallOk = r.resultType === "score"
      ? (typeof r.score === "number" && !!q && r.score >= q.targetScore)
      : (r.pass === true);
    const badgeCls = overallOk ? "badge-ok" : "badge-danger";
    return (
      '<div class="list-row">' +
        '<div class="list-row-head">' +
          '<span class="list-title">' + CERT_FLOW.escapeHtml(qName) + "</span>" +
          '<span class="badge ' + badgeCls + '">' +
            resultText(data, r) + "</span>" +
        "</div>" +
        '<div class="list-row-sub">受験日：' + CERT_FLOW.escapeHtml(r.examDate) +
        '<div class="list-row-sub">受験日：' + CERT_FLOW.escapeHtml(r.examDate) +
          "／実費：" + CERT_FLOW.escapeHtml(String(r.actualCost)) + "円" +
          "／領収書：" + (r.receiptSubmitted ? "提出済み" : "未提出") +
          "／報告日：" + CERT_FLOW.escapeHtml(r.reportDate || "-") + "</div>" +
      "</div>"
    );
  }).join("");
}

/**
 * 自分の費用申請一覧をHTML文字列にして返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {Array}  list - 費用申請の配列
 * @returns {string} HTML文字列
 */
function renderOwnReimbursements(data, list) {
  if (!list.length) {
    return '<p class="empty-text">まだ費用申請はありません。</p>';
  }
  return list.map(function (m) {
    const q = data.qualifications.find(function (x) { return x.id === m.qualificationId; });
    const qName = q ? q.name : m.qualificationId;
    const label = Stage4.REIMBURSEMENT_STATUS_LABELS[m.status] || m.status;
    const extra = m.status === "rejected"
      ? '<div class="list-row-sub">却下理由：' + CERT_FLOW.escapeHtml(m.rejectionReason || "（理由未入力）") + "</div>"
      : "";
    return (
      '<div class="list-row">' +
        '<div class="list-row-head">' +
          '<span class="list-title">' + CERT_FLOW.escapeHtml(qName) + "</span>" +
          '<span class="badge ' + examStatusClass(m.status) + '">' + label + "</span>" +
        "</div>" +
        '<div class="list-row-sub">金額：' + CERT_FLOW.escapeHtml(String(m.amount)) + "円／受験日：" + CERT_FLOW.escapeHtml(m.examDate) + "</div>" +
        extra +
      "</div>"
    );
  }).join("");
}

/* ===================== 画面描画（結果報告） ===================== */

/**
 * 結果報告カード（1件分）を返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {Object} app  - 受験申請（承認済み・未報告）
 * @returns {string} HTML文字列
 */
function reportCardHtml(data, app) {
  const q = data.qualifications.find(function (x) { return x.id === app.qualificationId; });
  const qName = q ? q.name : app.qualificationId;
  const isScore = q && q.resultType === "score";

  const resultInput = isScore
    ? '<div class="form-group"><label>取得点数 <em>（必須）</em></label>' +
        '<input type="number" class="form-input" name="rp-score" min="0" step="1" placeholder="例：760" />' +
        '<p class="hint-text">会社の目標点数：' + (q ? q.targetScore : "-") + "点</p></div>"
    : '<div class="form-group"><label>合否 <em>（必須）</em></label>' +
        '<div class="inline-options">' +
          '<label><input type="radio" name="rp-pass" value="true" /> 合格</label>' +
          '<label><input type="radio" name="rp-pass" value="false" /> 不合格</label>' +
        "</div></div>";

  return (
    '<div class="card approval-card" id="rc-' + CERT_FLOW.escapeHtml(app.id) + '">' +
      '<div class="list-row-head">' +
        '<span class="list-title">' + CERT_FLOW.escapeHtml(qName) + "</span>" +
        '<span class="badge badge-ok">承認済み</span>' +
      "</div>" +
      '<div class="list-row-sub">受験日：' + CERT_FLOW.escapeHtml(app.examDate) +
        "／予定費用：" + CERT_FLOW.escapeHtml(String(app.expectedCost)) + "円</div>" +
      '<div class="list-row-sub">受験目的：' + CERT_FLOW.escapeHtml(app.purpose) + "</div>" +
      '<form class="report-form" data-app-id="' + CERT_FLOW.escapeHtml(app.id) + '" novalidate>' +
        resultInput +
        '<div class="form-group"><label>実際の受験費用（円） <em>（必須）</em></label>' +
          '<input type="number" class="form-input" name="rp-cost" min="0" step="1" placeholder="例：7500" />' +
        "</div>" +
        '<div class="form-group"><label>領収書 <em>（必須）</em></label>' +
          '<div class="inline-options">' +
            '<label><input type="radio" name="rp-receipt" value="true" /> 提出済み</label>' +
            '<label><input type="radio" name="rp-receipt" value="false" /> 未提出</label>' +
          "</div></div>" +
        '<div class="form-group"><label>取得日 <em>（合格／目標達成の場合に必須）</em></label>' +
          '<input type="date" class="form-input" name="rp-acquired" />' +
        "</div>" +
        '<div class="form-actions">' +
          '<button type="submit" class="btn btn-primary">結果を報告する</button>' +
        "</div>" +
      "</form>" +
    "</div>"
  );
}

/**
 * 新入社員向け「試験結果報告」画面を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 * @param {Object|null} msg - 直前の操作結果メッセージ（{text, type}）
 */
Stage4.renderReport = function (content, route, msg) {
  const data = CERT_FLOW.loadData();
  const employeeId = Stage4.CURRENT_EMPLOYEE_ID;

  // 結果報告できる申請＝承認済み・未報告
  const reportable = data.examApplications.filter(function (a) {
    return a.applicantId === employeeId &&
      a.status === "approved" &&
      !data.examReports.some(function (r) { return r.examApplicationId === a.id; });
  });
  const myReports = data.examReports.filter(function (r) {
    return r.applicantId === employeeId;
  }).slice().reverse();
  const myReimbursements = Stage4.getReimbursementsOf(data, employeeId);

  const messageHtml = msg
    ? '<div class="message message-' + msg.type + '">' + CERT_FLOW.escapeHtml(msg.text) + "</div>"
    : "";

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    messageHtml +
    '<section class="card">' +
      '<h3 class="section-title">結果報告する受験申請（' + reportable.length + '件）</h3>' +
      (reportable.length
        ? '<div class="approval-list">' + reportable.map(function (a) { return reportCardHtml(data, a); }).join("") + "</div>"
        : '<p class="empty-text">結果報告できる受験申請はありません。</p>') +
    "</section>" +
    '<section class="card">' +
      '<h3 class="section-title">自分の受験履歴</h3>' +
      '<div id="own-history">' + renderOwnExamHistory(data, myReports) + "</div>" +
    "</section>" +
    '<section class="card">' +
      '<h3 class="section-title">自分の費用申請</h3>' +
      '<div id="own-reimbursements">' + renderOwnReimbursements(data, myReimbursements) + "</div>" +
    "</section>";

  // 各フォームの送信処理（結果の報告）
  content.querySelectorAll(".report-form").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const appId = form.dataset.appId;
      const app = data.examApplications.find(function (a) { return a.id === appId; });
      const q = data.qualifications.find(function (x) { return x.id === app.qualificationId; });

      const passInput = form.querySelector('input[name="rp-pass"]:checked');
      const passVal = passInput ? passInput.value : "";
      const scoreInput = form.querySelector('input[name="rp-score"]');
      const costInput = form.querySelector('input[name="rp-cost"]');
      const receiptInput = form.querySelector('input[name="rp-receipt"]:checked');
      const acquiredInput = form.querySelector('input[name="rp-acquired"]');

      const input = {
        examApplicationId: appId,
        pass: passVal === "true" ? true : (passVal === "false" ? false : null),
        score: scoreInput ? Number(scoreInput.value) : null,
        actualCost: costInput ? costInput.value : "",
        receiptSubmitted: receiptInput ? (receiptInput.value === "true") : null,
        acquiredDate: acquiredInput ? acquiredInput.value : "",
        reportDate: CERT_FLOW.todayStr()
      };

      const result = Stage4.createExamReport(data, input);
      if (result.error) {
        Stage4.renderReport(content, route, { text: result.error, type: "error" });
        return;
      }
      CERT_FLOW.saveData(data);
      Stage4.renderReport(content, route, {
        text: result.messages.join(" "),
        type: "success"
      });
    });
  });
};

/* ===================== 画面描画（費用申請の承認） ===================== */

/**
 * 費用申請の承認フォーム（1件分）を返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {Object} m    - 費用申請
 * @returns {string} HTML文字列
 */
function reimbursementCardHtml(data, m) {
  const q = data.qualifications.find(function (x) { return x.id === m.qualificationId; });
  const qName = q ? q.name : m.qualificationId;
  const report = data.examReports.find(function (r) { return r.id === m.examReportId; });
  const resultLine = report
    ? "／結果：" + resultText(data, report)
    : "";
  return (
    '<div class="card approval-card" id="rm-' + CERT_FLOW.escapeHtml(m.id) + '">' +
      '<div class="list-row-head">' +
        '<span class="list-title">' + CERT_FLOW.escapeHtml(qName) + "</span>" +
        '<span class="badge badge-warn">承認待ち</span>' +
      "</div>" +
      '<div class="list-row-sub">申請者：' + CERT_FLOW.escapeHtml(findEmployeeName(data, m.applicantId)) +
        "／受験日：" + CERT_FLOW.escapeHtml(m.examDate) +
        resultLine + "</div>" +
      '<div class="list-row-sub">申請金額：' + CERT_FLOW.escapeHtml(String(m.amount)) + "円</div>" +
      '<div class="approval-form">' +
        '<div class="form-group"><label>却下理由（却下する場合に必須）</label>' +
          '<textarea class="form-input rm-reason" rows="2" placeholder="却下する場合は理由を入力してください"></textarea>' +
        "</div>" +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-success" data-money-action="approve" data-money-action-id="' + CERT_FLOW.escapeHtml(m.id) + '">承認</button> ' +
          '<button type="button" class="btn btn-danger" data-money-action="reject" data-money-action-id="' + CERT_FLOW.escapeHtml(m.id) + '">却下</button>' +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

/**
 * 処理済み（承認／却下）の費用申請1件をHTML文字列にして返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {Object} m    - 費用申請
 * @returns {string} HTML文字列
 */
function reimbursementHistoryRowHtml(data, m) {
  const q = data.qualifications.find(function (x) { return x.id === m.qualificationId; });
  const qName = q ? q.name : m.qualificationId;
  const label = Stage4.REIMBURSEMENT_STATUS_LABELS[m.status] || m.status;
  const extra = m.status === "rejected"
    ? '<div class="list-row-sub">却下理由：' + CERT_FLOW.escapeHtml(m.rejectionReason || "（理由未入力）") + "</div>"
    : "";
  return (
    '<div class="list-row">' +
      '<div class="list-row-head">' +
        '<span class="list-title">' + CERT_FLOW.escapeHtml(qName) + "</span>" +
        '<span class="badge ' + examStatusClass(m.status) + '">' + label + "</span>" +
      "</div>" +
      '<div class="list-row-sub">申請者：' + CERT_FLOW.escapeHtml(findEmployeeName(data, m.applicantId)) +
        "／金額：" + CERT_FLOW.escapeHtml(String(m.amount)) + "円" +
        "／受験日：" + CERT_FLOW.escapeHtml(m.examDate) +
        (m.approvedDate ? "／承認日：" + CERT_FLOW.escapeHtml(m.approvedDate) : "") + "</div>" +
      extra +
    "</div>"
  );
}

/**
 * 上司向け「費用申請承認一覧」画面を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 * @param {Object|null} msg - 直前の操作結果メッセージ（{text, type}）
 */
Stage4.renderMoneyApprovals = function (content, route, msg) {
  const data = CERT_FLOW.loadData();
  const pending = data.reimbursementRequests.filter(function (m) {
    return m.status === "pending";
  });
  const decided = data.reimbursementRequests.filter(function (m) {
    return m.status !== "pending";
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
        ? '<div class="approval-list">' + pending.map(function (m) { return reimbursementCardHtml(data, m); }).join("") + "</div>"
        : '<p class="empty-text">承認待ちの費用申請はありません。</p>') +
    "</section>" +
    '<section class="card">' +
      '<h3 class="section-title">処理済み（承認／却下）</h3>' +
      (decided.length
        ? '<div class="approval-history">' + decided.map(function (m) { return reimbursementHistoryRowHtml(data, m); }).join("") + "</div>"
        : '<p class="empty-text">処理済みの費用申請はありません。</p>') +
    "</section>";

  // 承認／却下ボタンの処理
  content.querySelectorAll("[data-money-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.dataset.moneyActionId;
      const action = btn.dataset.moneyAction;
      const card = document.getElementById("rm-" + id);

      if (action === "approve") {
        const result = Stage4.approveReimbursement(data, id, CERT_FLOW.todayStr());
        if (result.error) {
          Stage4.renderMoneyApprovals(content, route, { text: result.error, type: "error" });
          return;
        }
        CERT_FLOW.saveData(data);
        Stage4.renderMoneyApprovals(content, route, {
          text: "費用申請 " + id + " を承認しました。",
          type: "success"
        });
      } else {
        const reason = card.querySelector(".rm-reason").value;
        const result = Stage4.rejectReimbursement(data, id, reason);
        if (result.error) {
          Stage4.renderMoneyApprovals(content, route, { text: result.error, type: "error" });
          return;
        }
        CERT_FLOW.saveData(data);
        Stage4.renderMoneyApprovals(content, route, {
          text: "費用申請 " + id + " を却下しました。",
          type: "success"
        });
      }
    });
  });
};

/* ===================== 描画関数の登録 ===================== */

// 実装済みの画面を app.js（renderView）から呼び出せるように登録する
CERT_FLOW.App.registerViewRenderer("report", Stage4.renderReport);
CERT_FLOW.App.registerViewRenderer("money-approvals", Stage4.renderMoneyApprovals);
