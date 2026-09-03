/**
 * stage2.js（第2段階：資格制度一覧・検索・未登録資格の制度確認申請）
 *
 * 実装する内容：
 *   1. 資格制度一覧と検索・絞り込み（新入社員向け「#/qualifications」）
 *   2. 未登録資格の制度確認申請（新入社員向け「#/check-request」）
 *   3. 制度確認申請の承認・却下（上司向け「#/check-approvals」）と資格マスタへの追加
 *
 * 方針：
 *   - データを更新する業務ロジック（createCheckRequest / approveCheckRequest など）は
 *     DOM（画面）に依存させない。自動テストがブラウザなしで実行できるようにする。
 *   - データの読み書きは既存の CERT_FLOW（data.js）の仕組みを使う。
 *   - 画面描画は App.registerViewRenderer へ登録し、app.js 側から呼び出される。
 *
 * ステータスの扱い：
 *   保存は英語（pending / approved / rejected）、表示は日本語
 *   （確認待ち / 承認済み / 却下）で対応付ける。
 */

"use strict";

const Stage2 = CERT_FLOW.Stage2 = {};

// デモで「自分（新入社員）」として操作する架空の固定社員ID
Stage2.CURRENT_EMPLOYEE_ID = "EMP001";

// ステータスの表示名
Stage2.STATUS_LABELS = {
  pending: "確認待ち",
  approved: "承認済み",
  rejected: "却下"
};

/* ===================== 共通の補助関数 ===================== */

/**
 * 今日の日付を「YYYY-MM-DD」形式で返す。
 *
 * @returns {string} 例："2026-09-02"
 */
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

/**
 * 画面に表示する文字列を安全な文字列へ変換する（XSS対策）。
 * 例：< や & などがHTMLとして解釈されないようにする。
 *
 * @param {*} value - 変換したい値
 * @returns {string} 変換後の文字列
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * ステータスに対応するバッジのクラス名を返す。
 *
 * @param {string} status - status（pending / approved / rejected など）
 * @returns {string} CSSクラス名
 */
function statusClass(status) {
  if (status === "approved") {
    return "badge-ok";
  }
  if (status === "rejected") {
    return "badge-danger";
  }
  return "badge-warn";
}

/**
 * 上限回数の値を表示用テキストへ変換する。
 *
 * @param {number|null} maxCount - 上限回数（null は上限なし）
 * @returns {string} 例："2回" / "上限なし"
 */
function describeLimitValue(maxCount) {
  if (maxCount === null || maxCount === undefined) {
    return "上限なし";
  }
  return maxCount + "回";
}

/* ===================== 業務ロジック（画面に依存しない） ===================== */

/**
 * 資格一覧をキーワード・カテゴリ・会社負担可否で絞り込む。
 * カテゴリは絞り込みにのみ使い、重複判定などには使わない。
 *
 * @param {Array}  qualifications - 資格マスタの配列
 * @param {string} keyword   - 資格名の部分一致キーワード
 * @param {string} category  - カテゴリ（"すべて" なら絞り込まない）
 * @param {string} coverage  - "eligible" / "notEligible" / それ以外は絞り込まない
 * @returns {Array} 絞り込み後の配列
 */
Stage2.filterQualifications = function (qualifications, keyword, category, coverage) {
  const kw = (keyword || "").trim().toLowerCase();
  return qualifications.filter(function (q) {
    if (kw && q.name.toLowerCase().indexOf(kw) === -1) {
      return false;
    }
    if (category && category !== "すべて" && q.category !== category) {
      return false;
    }
    const isCovered = q.ruleType !== "notEligible";
    if (coverage === "eligible" && !isCovered) {
      return false;
    }
    if (coverage === "notEligible" && isCovered) {
      return false;
    }
    return true;
  });
};

/**
 * 資格の「費用負担条件」を日本語の説明文として返す（一覧表示用）。
 *
 * @param {Object} q - 資格制度マスタの1件
 * @returns {string} 例："合格時のみ会社負担"
 */
Stage2.describeCondition = function (q) {
  if (!q) {
    return "";
  }
  switch (q.ruleType) {
    case "notEligible":
      return "会社負担対象外";
    case "withinJoiningPeriod":
      if (q.periodMonths) {
        return "入社後" + q.periodMonths + "か月以内の受験が対象";
      }
      return "合否問わず";
    case "annualCategoryLimit": {
      const group = q.quotaGroup ? "（" + q.quotaGroup + "グループ）" : "";
      return "グループ合算" + group + "で年度ごとに" + q.maxCount + "回（年度初めにリセット）";
    }
    case "passRequired":
      return "合格時のみ会社負担";
    case "scoreRequired":
      return "会社指定の目標点数（" + q.targetScore + "点）以上";
    default:
      return "";
  }
};

/**
 * ある社員の「承認済み費用申請」の件数を数える（回数確認用）。
 * 第2段階では費用申請がまだ存在しないため、実質 0 件になる。
 * 第4段階（費用申請）を実装したときにこの関数を再利用する。
 *
 * @param {Object} data       - 保存データ全体
 * @param {string} qualificationId - 集計する資格ID
 * @param {string} employeeId  - 社員ID
 * @returns {number} 件数
 */
Stage2.countApprovedReimbursements = function (data, qualificationId, employeeId) {
  return data.reimbursementRequests.filter(function (m) {
    return m.qualificationId === qualificationId &&
      m.applicantId === employeeId &&
      m.status === "approved";
  }).length;
};

/**
 * 残り回数を求める（資格単独の回数制限がある場合のみ）。
 *
 * @param {Object} data - 保存データ全体
 * @param {Object} q    - 資格制度マスタの1件
 * @param {string} employeeId - 社員ID
 * @returns {number|null} 残り回数（上限なしなら null）
 */
Stage2.getRemainingCount = function (data, q, employeeId) {
  if (q.maxCount === null || q.maxCount === undefined) {
    return null;
  }
  const used = Stage2.countApprovedReimbursements(data, q.id, employeeId);
  return Math.max(0, q.maxCount - used);
};

/**
 * 未登録資格の制度確認申請を作成する。
 * 同じ資格名で「確認待ち」の申請がすでにあれば作成しない（重複防止）。
 *
 * @param {Object} data  - 保存データ全体（この中へ申請を追加する）
 * @param {Object} input - 入力内容 { qualificationName, category, qualificationDescription, reason, employeeId, createdDate }
 * @returns {{error: string|null}} error が null なら成功
 */
Stage2.createCheckRequest = function (data, input) {
  const qualificationName = (input.qualificationName || "").trim();
  const category = (input.category || "").trim();
  const reason = (input.reason || "").trim();

  if (!qualificationName) {
    return { error: "資格名を入力してください。" };
  }
  if (!category) {
    return { error: "カテゴリを入力してください。" };
  }
  if (!reason) {
    return { error: "申請理由を入力してください。" };
  }

  // 同じ資格名の「確認待ち」申請がすでにある場合は重複として拒否
  const duplicated = data.qualificationCheckRequests.some(function (r) {
    return r.qualificationName === qualificationName && r.status === "pending";
  });
  if (duplicated) {
    return { error: "同じ資格名の申請がすでに「確認待ち」のため、申請できません。" };
  }

  data.qualificationCheckRequests.push({
    id: CERT_FLOW.generateId("C", data.qualificationCheckRequests),
    qualificationName: qualificationName,
    category: category,
    qualificationDescription: (input.qualificationDescription || "").trim(),
    reason: reason,
    applicantId: input.employeeId,
    status: "pending", // 確認待ち
    createdDate: input.createdDate,
    // ↓ 以下は上司が承認するときに設定する（未承認では null / 初期値）
    ruleType: null,
    resultType: "passFail",
    periodMonths: null,
    maxCount: null,
    countScope: "qualification",
    quotaGroup: null,
    resetCycle: "none",
    fiscalYearStartMonth: 4,
    resultRequired: false,
    targetScore: null,
    rewardEligible: false,
    rewardAmount: 0,
    managerComment: "",
    decisionDate: null,
    rejectionReason: null,
    resultQualificationId: null
  });

  return { error: null };
};

/**
 * 制度確認申請を承認し、決定に従った資格をマスタへ追加する。
 * すでに処理済み（承認済み／却下）の申請は承認できない（二重承認の防止）。
 *
 * @param {Object} data   - 保存データ全体
 * @param {string} requestId - 承認する申請ID
 * @param {Object} settings - 承認時の設定
 *   companyCovered : "eligible"（対象）/"notEligible"（対象外）
 *   maxCount       : 負担上限回数（空欄なら null＝上限なし）
 *   condition      : "any"（合否問わず）/"passRequired"（合格時のみ）
 *   rewardAmount   : 報奨金額（0 なら報奨金なし）
 *   comment        : 上司コメント
 *   decidedDate    : 判定日（YYYY-MM-DD）
 * @returns {{error: string|null, qualificationId?: string}} 成否
 */
Stage2.approveCheckRequest = function (data, requestId, settings) {
  const request = data.qualificationCheckRequests.find(function (r) {
    return r.id === requestId;
  });
  if (!request) {
    return { error: "申請が見つかりません。" };
  }
  if (request.status !== "pending") {
    return {
      error: "この申請はすでに処理済み（" +
        (Stage2.STATUS_LABELS[request.status] || request.status) +
        "）のため、承認できません。"
    };
  }

  const covered = settings.companyCovered === "eligible";

  // 会社負担対象の場合だけ、上限回数と報奨金額を設定する
  let maxCount = null;
  let rewardAmount = 0;
  if (covered) {
    if (settings.maxCount !== null && settings.maxCount !== undefined && settings.maxCount !== "") {
      const limit = Number(settings.maxCount);
      if (!Number.isInteger(limit) || limit < 0) {
        return { error: "負担上限回数は 0 以上の整数を入力してください。（空欄の場合は上限なし）" };
      }
      maxCount = limit;
    }
    const reward = Number(settings.rewardAmount);
    if (!Number.isInteger(reward) || reward < 0) {
      return { error: "報奨金額は 0 以上の整数を入力してください。" };
    }
    rewardAmount = reward;
  }

  const passRequired = covered && settings.condition === "passRequired";
  const ruleType = covered
    ? (passRequired ? "passRequired" : "withinJoiningPeriod")
    : "notEligible";

  // 承認した資格をマスタへ追加
  const qualification = {
    id: CERT_FLOW.generateId("Q", data.qualifications),
    name: request.qualificationName,
    category: request.category || "その他",
    description: request.qualificationDescription || "制度確認申請の承認により追加（架空）",
    ruleType: ruleType,
    resultType: "passFail",
    periodMonths: null, // 第2段階の承認画面では入社後期間は設定しない
    maxCount: maxCount,
    countScope: "qualification",
    quotaGroup: null,
    resetCycle: "none",
    fiscalYearStartMonth: 4,
    resultRequired: passRequired,
    targetScore: null,
    rewardEligible: rewardAmount > 0,
    rewardAmount: rewardAmount,
    rewardCondition: rewardAmount > 0 ? "承認時設定：報奨金額 " + rewardAmount + "円（架空）" : "",
    managerComment: settings.comment || "",
    sourceCheckRequestId: request.id
  };
  data.qualifications.push(qualification);

  // 元の申請レコードにも承認内容を反映する
  request.status = "approved";
  request.ruleType = ruleType;
  request.resultType = "passFail";
  request.periodMonths = null;
  request.maxCount = maxCount;
  request.countScope = "qualification";
  request.quotaGroup = null;
  request.resetCycle = "none";
  request.fiscalYearStartMonth = 4;
  request.resultRequired = passRequired;
  request.targetScore = null;
  request.rewardEligible = rewardAmount > 0;
  request.rewardAmount = rewardAmount;
  request.managerComment = settings.comment || "";
  request.decisionDate = settings.decidedDate;
  request.resultQualificationId = qualification.id;

  return { error: null, qualificationId: qualification.id };
};

/**
 * 制度確認申請を却下する。資格マスタには追加しない。
 * すでに処理済みの申請は却下できない。
 *
 * @param {Object} data   - 保存データ全体
 * @param {string} requestId - 却下する申請ID
 * @param {string} comment - 却下理由
 * @returns {{error: string|null}} 成否
 */
Stage2.rejectCheckRequest = function (data, requestId, comment) {
  const request = data.qualificationCheckRequests.find(function (r) {
    return r.id === requestId;
  });
  if (!request) {
    return { error: "申請が見つかりません。" };
  }
  if (request.status !== "pending") {
    return {
      error: "この申請はすでに処理済み（" +
        (Stage2.STATUS_LABELS[request.status] || request.status) +
        "）のため、却下できません。"
    };
  }
  request.status = "rejected";
  request.rejectionReason = (comment || "").trim();
  request.decisionDate = todayStr();
  return { error: null };
};

/**
 * 指定した社員が送った制度確認申請を返す。
 *
 * @param {Object} data - 保存データ全体
 * @param {string} employeeId - 社員ID
 * @returns {Array} その社員の申請（申請日の新しい順）
 */
Stage2.getRequestsOf = function (data, employeeId) {
  return data.qualificationCheckRequests
    .filter(function (r) {
      return r.applicantId === employeeId;
    })
    .slice()
    .reverse(); // 新しい申請を上に表示
};

/* ===================== 画面描画 ===================== */

/**
 * 資格一覧を描画し直す（検索ボックスの入力に応じて呼ばれる）。
 *
 * @param {Array} filtered - 絞り込み後の資格配列
 * @param {Object} data    - 保存データ全体
 * @param {string} keyword - 現在の検索キーワード
 */
function renderQualifResults(filtered, data, keyword) {
  const box = document.getElementById("qualif-results");

  if (!filtered.length) {
    const kw = (keyword || "").trim();
    const href = "#/check-request?name=" + encodeURIComponent(kw);
    box.innerHTML =
      '<p class="empty-text">該当する資格は見つかりませんでした。</p>' +
      '<p class="empty-text">一覧にない資格は、制度確認を申請してください。</p>' +
      '<a class="btn btn-primary" href="' + href + '">制度確認を申請する</a>';
    return;
  }

  const employeeId = Stage2.CURRENT_EMPLOYEE_ID;
  const html = filtered.map(function (q) {
    const covered = q.ruleType !== "notEligible";
    const coverText = covered ? "会社負担対象" : "会社負担対象外";
    const coverBadge = covered ? "badge-ok" : "badge-danger";
    const rewardText = q.rewardEligible ? ("報奨金 " + q.rewardAmount + "円") : "報奨金なし";

    // 上限回数の表示（資格単独の回数制限がある場合は残り回数も併記）
    let limitText = describeLimitValue(q.maxCount);
    if (q.countScope === "qualification" && q.maxCount !== null && q.maxCount !== undefined) {
      const rem = Stage2.getRemainingCount(data, q, employeeId);
      limitText += "（残り" + rem + "回）";
    }

    return (
      '<article class="card qualif-card">' +
        '<div class="qualif-head">' +
          "<h3>" + escapeHtml(q.name) + "</h3>" +
          '<span class="badge badge-info">' + escapeHtml(q.category || "未分類") + "</span>" +
          '<span class="badge ' + coverBadge + '">' + coverText + "</span>" +
          (q.rewardEligible ? '<span class="badge badge-warn">報奨金あり</span>' : "") +
        "</div>" +
        '<dl class="qualif-detail">' +
          "<dt>負担条件</dt><dd>" + escapeHtml(Stage2.describeCondition(q)) + "</dd>" +
          "<dt>負担上限回数</dt><dd>" + limitText + "</dd>" +
          "<dt>報奨金</dt><dd>" + rewardText + "</dd>" +
        "</dl>" +
        (q.description ? '<p class="qualif-description">' + escapeHtml(q.description) + "</p>" : "") +
        '<div class="qualif-actions">' +
          '<a class="btn btn-primary btn-sm" href="#/exam-apply?qualificationId=' + encodeURIComponent(q.id) + '">受験申請</a>' +
        "</div>" +
      "</article>"
    );
  }).join("");

  box.innerHTML = '<div class="card-grid">' + html + "</div>";
}

/**
 * 新入社員向け「資格制度一覧と検索」画面を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素（#app-content）
 * @param {Object} route - ルート定義
 */
Stage2.renderQualifications = function (content, route) {
  const data = CERT_FLOW.loadData();

  // カテゴリ一覧を重複なしで作る
  const categories = [];
  data.qualifications.forEach(function (q) {
    if (q.category && categories.indexOf(q.category) === -1) {
      categories.push(q.category);
    }
  });
  categories.sort();

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    '<div class="toolbar">' +
      '<input type="search" id="q-search" class="form-input" placeholder="資格名で検索" />' +
      '<select id="q-category" class="form-select">' +
        '<option value="すべて">カテゴリ：すべて</option>' +
        categories.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + "</option>"; }).join("") +
      "</select>" +
      '<select id="q-coverage" class="form-select">' +
        '<option value="all">負担可否：すべて</option>' +
        '<option value="eligible">会社負担対象</option>' +
        '<option value="notEligible">会社負担対象外</option>' +
      "</select>" +
    "</div>" +
    '<div id="qualif-results"></div>';

  const searchBox = document.getElementById("q-search");
  const catSelect = document.getElementById("q-category");
  const covSelect = document.getElementById("q-coverage");

  // 現在の入力から結果を再描画する
  function apply() {
    const filtered = Stage2.filterQualifications(
      data.qualifications,
      searchBox.value,
      catSelect.value,
      covSelect.value
    );
    renderQualifResults(filtered, data, searchBox.value);
  }

  searchBox.addEventListener("input", apply);
  catSelect.addEventListener("change", apply);
  covSelect.addEventListener("change", apply);
  apply();
};

/**
 * 自分の申請一覧（新入社員向け）をHTML文字列にして返す。
 *
 * @param {Array} requests - 本人の制度確認申請の配列
 * @returns {string} HTML文字列
 */
function renderOwnRequestsList(requests) {
  if (!requests.length) {
    return '<p class="empty-text">まだ申請はありません。</p>';
  }
  return requests.map(function (r) {
    const label = Stage2.STATUS_LABELS[r.status] || r.status;
    let decidedText = "";
    if (r.status === "approved") {
      decidedText =
        '<div class="list-row-sub">承認時の設定：上限回数 ' + describeLimitValue(r.maxCount) +
        "／報奨金 " + (r.rewardEligible ? r.rewardAmount + "円" : "なし") + "</div>";
      if (r.managerComment) {
        decidedText += '<div class="list-row-sub">上司コメント：' + escapeHtml(r.managerComment) + "</div>";
      }
    } else if (r.status === "rejected") {
      decidedText = '<div class="list-row-sub">却下理由：' + escapeHtml(r.rejectionReason || "（理由未入力）") + "</div>";
    }

    return (
      '<div class="list-row">' +
        '<div class="list-row-head">' +
          '<span class="list-title">' + escapeHtml(r.qualificationName) + "</span>" +
          '<span class="badge ' + statusClass(r.status) + '">' + label + "</span>" +
        "</div>" +
        '<div class="list-row-sub">カテゴリ：' + escapeHtml(r.category || "-") +
          "／申請日：" + escapeHtml(r.createdDate || "-") + "</div>" +
        '<div class="list-row-sub">申請理由：' + escapeHtml(r.reason) + "</div>" +
        decidedText +
      "</div>"
    );
  }).join("");
}

/**
 * 新入社員向け「未登録資格の制度確認申請」画面を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 */
Stage2.renderCheckRequest = function (content, route) {
  const data = CERT_FLOW.loadData();
  const prefillName = App.currentQuery.name || "";
  const myRequests = Stage2.getRequestsOf(data, Stage2.CURRENT_EMPLOYEE_ID);

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    '<div class="split">' +
      '<section class="card">' +
        '<h3 class="section-title">新規申請</h3>' +
        '<form id="check-request-form" novalidate>' +
          '<div class="form-group"><label>資格名 <em>（必須）</em></label>' +
            '<input type="text" id="cr-name" class="form-input" value="' + escapeHtml(prefillName) +
              '" placeholder="例：架空クラウド実務認定" />' +
          "</div>" +
          '<div class="form-group"><label>カテゴリ <em>（必須）</em></label>' +
            '<input type="text" id="cr-category" class="form-input" placeholder="例：IT" />' +
          "</div>" +
          '<div class="form-group"><label>資格の概要 <em>（任意）</em></label>' +
            '<input type="text" id="cr-desc" class="form-input" placeholder="簡単に説明" />' +
          "</div>" +
          '<div class="form-group"><label>申請理由 <em>（必須）</em></label>' +
            '<textarea id="cr-reason" class="form-input" rows="3" placeholder="業務で使うため など"></textarea>' +
          "</div>" +
          '<div id="cr-message"></div>' +
          '<div class="form-actions">' +
            '<button type="submit" class="btn btn-primary">制度確認を申請する</button>' +
          "</div>" +
        "</form>" +
      "</section>" +
      '<section class="card">' +
        '<h3 class="section-title">自分の申請一覧</h3>' +
        '<div id="own-requests">' + renderOwnRequestsList(myRequests) + "</div>" +
      "</section>" +
    "</div>";

  // 申請フォームの送信処理
  document.getElementById("check-request-form").addEventListener("submit", function (event) {
    event.preventDefault();
    const input = {
      qualificationName: document.getElementById("cr-name").value,
      category: document.getElementById("cr-category").value,
      qualificationDescription: document.getElementById("cr-desc").value,
      reason: document.getElementById("cr-reason").value,
      employeeId: Stage2.CURRENT_EMPLOYEE_ID,
      createdDate: todayStr()
    };
    const result = Stage2.createCheckRequest(data, input);
    const box = document.getElementById("cr-message");
    if (result.error) {
      box.innerHTML = '<div class="message message-error">' + escapeHtml(result.error) + "</div>";
      return;
    }
    CERT_FLOW.saveData(data);
    box.innerHTML = '<div class="message message-success">申請しました。ステータスは「確認待ち」です。</div>';
    document.getElementById("check-request-form").reset();
    // 自分の申請一覧を更新
    document.getElementById("own-requests").innerHTML =
      renderOwnRequestsList(Stage2.getRequestsOf(data, Stage2.CURRENT_EMPLOYEE_ID));
  });
};

/**
 * 申請者の名前を返す（いない場合は「不明」）。
 *
 * @param {Object} data - 保存データ全体
 * @param {string} employeeId - 社員ID
 * @returns {string} 社員名
 */
function getEmployeeName(data, employeeId) {
  const emp = data.employees.find(function (e) {
    return e.id === employeeId;
  });
  return emp ? emp.name : "不明";
}

/**
 * 承認フォーム（1件分）を返す。
 *
 * @param {Object} r - 申請レコード
 * @param {Object} data - 保存データ全体（申請者名の取得用）
 * @returns {string} HTML文字列
 */
function approvalCardHtml(r, data) {
  return (
    '<div class="card approval-card" id="ac-' + escapeHtml(r.id) + '">' +
      '<div class="list-row-head">' +
        '<span class="list-title">' + escapeHtml(r.qualificationName) + "</span>" +
        '<span class="badge badge-warn">確認待ち</span>' +
      "</div>" +
      '<div class="list-row-sub">カテゴリ：' + escapeHtml(r.category || "-") +
        "／申請者：" + escapeHtml(getEmployeeName(data, r.applicantId)) +
        "／申請日：" + escapeHtml(r.createdDate || "-") + "</div>" +
      '<div class="list-row-sub">申請理由：' + escapeHtml(r.reason) + "</div>" +
      '<div class="approval-form">' +
        '<div class="form-group"><label>会社負担可否</label>' +
          '<select class="form-select ac-covered" data-id="' + escapeHtml(r.id) + '">' +
            '<option value="eligible">会社負担対象</option>' +
            '<option value="notEligible">会社負担対象外</option>' +
          "</select>" +
        "</div>" +
        '<div class="form-group"><label>負担上限回数（空欄＝上限なし）</label>' +
          '<input type="number" class="form-input ac-maxcount" data-id="' + escapeHtml(r.id) +
            '" min="0" placeholder="例：2" />' +
        "</div>" +
        '<div class="form-group"><label>費用負担条件</label>' +
          '<select class="form-select ac-condition" data-id="' + escapeHtml(r.id) + '">' +
            '<option value="any">合否問わず</option>' +
            '<option value="passRequired">合格時のみ</option>' +
          "</select>" +
        "</div>" +
        '<div class="form-group"><label>報奨金額（0＝なし。法人設定例：10000）</label>' +
          '<input type="number" class="form-input ac-reward" data-id="' + escapeHtml(r.id) + '" min="0" value="0" />' +
        "</div>" +
        '<div class="form-group"><label>コメント（承認：任意／却下：必須）</label>' +
          '<textarea class="form-input ac-comment" data-id="' + escapeHtml(r.id) + '" rows="2" placeholder="承認・却下のコメント"></textarea>' +
        "</div>" +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-success" data-action="approve" data-id="' + escapeHtml(r.id) + '">承認</button> ' +
          '<button type="button" class="btn btn-danger" data-action="reject" data-id="' + escapeHtml(r.id) + '">却下</button>' +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

/**
 * 処理済み（承認／却下）の申請1件をHTML文字列にして返す。
 *
 * @param {Object} r - 申請レコード
 * @param {Object} data - 保存データ全体（申請者名の取得用）
 * @returns {string} HTML文字列
 */
function historyRowHtml(r, data) {
  const label = Stage2.STATUS_LABELS[r.status] || r.status;
  let extra = "";
  if (r.status === "approved") {
    extra =
      '<div class="list-row-sub">追加資格ID：' + escapeHtml(r.resultQualificationId || "-") +
      "／上限回数：" + describeLimitValue(r.maxCount) +
      "／報奨金：" + (r.rewardEligible ? r.rewardAmount + "円" : "なし") + "</div>";
  } else if (r.status === "rejected") {
    extra = '<div class="list-row-sub">却下理由：' + escapeHtml(r.rejectionReason || "（理由未入力）") + "</div>";
  }
  if (r.managerComment) {
    extra += '<div class="list-row-sub">上司コメント：' + escapeHtml(r.managerComment) + "</div>";
  }

  return (
    '<div class="list-row">' +
      '<div class="list-row-head">' +
        '<span class="list-title">' + escapeHtml(r.qualificationName) + "</span>" +
        '<span class="badge ' + statusClass(r.status) + '">' + label + "</span>" +
      "</div>" +
      '<div class="list-row-sub">カテゴリ：' + escapeHtml(r.category || "-") +
        "／申請者：" + escapeHtml(getEmployeeName(data, r.applicantId)) +
        "／申請日：" + escapeHtml(r.createdDate || "-") +
        "／判定日：" + escapeHtml(r.decisionDate || "-") + "</div>" +
      '<div class="list-row-sub">申請理由：' + escapeHtml(r.reason) + "</div>" +
      extra +
    "</div>"
  );
}

/**
 * 上司向け「制度確認承認一覧」画面を描画する。
 *
 * @param {HTMLElement} content - 画面を表示する要素
 * @param {Object} route - ルート定義
 * @param {Object|null} msg - 直前の操作結果メッセージ（{text, type}）
 */
Stage2.renderCheckApprovals = function (content, route, msg) {
  const data = CERT_FLOW.loadData();
  const pending = data.qualificationCheckRequests.filter(function (r) {
    return r.status === "pending";
  });
  const decided = data.qualificationCheckRequests.filter(function (r) {
    return r.status !== "pending";
  });

  const messageHtml = msg
    ? '<div class="message message-' + msg.type + '">' + escapeHtml(msg.text) + "</div>"
    : "";

  content.innerHTML =
    '<h2 class="view-title">' + route.label + "</h2>" +
    messageHtml +
    '<section class="card">' +
      '<h3 class="section-title">確認待ち（' + pending.length + "件）</h3>" +
      (pending.length
        ? '<div class="approval-list">' + pending.map(function (r) { return approvalCardHtml(r, data); }).join("") + "</div>"
        : '<p class="empty-text">確認待ちの申請はありません。</p>') +
    "</section>" +
    '<section class="card">' +
      '<h3 class="section-title">処理済み（承認／却下）</h3>' +
      (decided.length
        ? '<div class="approval-history">' + decided.map(function (r) { return historyRowHtml(r, data); }).join("") + "</div>"
        : '<p class="empty-text">処理済みの申請はありません。</p>') +
    "</section>";

  // 会社負担可否を「対象外」にすると回数・条件・報奨金を無効化する
  content.querySelectorAll(".ac-covered").forEach(function (sel) {
    const sync = function () {
      const disabled = sel.value === "notEligible";
      const card = document.getElementById("ac-" + sel.dataset.id);
      [".ac-maxcount", ".ac-condition", ".ac-reward"].forEach(function (cls) {
        const input = card.querySelector(cls);
        if (input) {
          input.disabled = disabled;
        }
      });
    };
    sel.addEventListener("change", sync);
    sync();
  });

  // 承認／却下ボタンの処理
  content.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const card = document.getElementById("ac-" + id);
      const comment = card.querySelector(".ac-comment").value;

      if (action === "approve") {
        const settings = {
          companyCovered: card.querySelector(".ac-covered").value,
          maxCount: card.querySelector(".ac-maxcount").value,
          condition: card.querySelector(".ac-condition").value,
          rewardAmount: card.querySelector(".ac-reward").value,
          comment: comment,
          decidedDate: todayStr()
        };
        const result = Stage2.approveCheckRequest(data, id, settings);
        if (result.error) {
          Stage2.renderCheckApprovals(content, route, { text: result.error, type: "error" });
          return;
        }
        CERT_FLOW.saveData(data);
        Stage2.renderCheckApprovals(content, route, {
          text: "申請 " + id + " を承認し、資格マスタへ追加しました。（追加資格ID：" + result.qualificationId + "）",
          type: "success"
        });
      } else {
        if (!comment.trim()) {
          Stage2.renderCheckApprovals(content, route, {
            text: "却下する場合はコメント（理由）を入力してください。",
            type: "error"
          });
          return;
        }
        const result = Stage2.rejectCheckRequest(data, id, comment);
        if (result.error) {
          Stage2.renderCheckApprovals(content, route, { text: result.error, type: "error" });
          return;
        }
        CERT_FLOW.saveData(data);
        Stage2.renderCheckApprovals(content, route, {
          text: "申請 " + id + " を却下しました。資格マスタには追加しません。",
          type: "success"
        });
      }
    });
  });
};

/* ===================== 描画関数の登録 ===================== */

// 実装済みの画面を app.js（renderView）から呼び出せるように登録する
CERT_FLOW.App.registerViewRenderer("qualifications", Stage2.renderQualifications);
CERT_FLOW.App.registerViewRenderer("check-request", Stage2.renderCheckRequest);
CERT_FLOW.App.registerViewRenderer("check-approvals", Stage2.renderCheckApprovals);
