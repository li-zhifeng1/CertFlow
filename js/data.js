/**
 * data.js（データ層）
 *
 * CertFlow の保存データの「形」と、保存の仕組みを担当する。
 *  - 初期サンプルデータの定義（すべて架空）
 *  - localStorage（ブラウザ内の簡易データ保存領域）への読み書き
 *  - サンプルデータの初期化（リセット）
 *
 * 保存形式：
 *   localStorage の1キー「certflow_data」の中に JSON 形式で1つのオブジェクトを保存し、
 *   その中に複数の配列（同じ種類のデータを並べたもの）を持たせる。
 *
 *   - employees                 : 利用者（新入社員／上司）
 *   - qualifications            : 資格制度マスタ（正式に登録された資格の台帳）
 *   - qualificationCheckRequests: 未登録資格の制度確認申請
 *   - examApplications          : 受験申請
 *   - examReports               : 試験結果報告・受験履歴
 *   - reimbursementRequests     : 費用申請
 *   - achievementRecords        : 資格取得実績（報奨金の予定額も含む）
 *
 * 注意：
 *   ES Modules（モジュール分割の仕組み）は HTML を直接開いたときに
 *   ブラウザにブロックされる場合があるため、使わない。
 *   その代わり「CERT_FLOW」という1つのオブジェクトに関数をまとめる。
 */

"use strict";

const CERT_FLOW = {};

/* ================= 保存に使うキー名 ================= */
CERT_FLOW.STORAGE_KEY = "certflow_data"; // データ本体を保存するキー
CERT_FLOW.ROLE_KEY    = "certflow_role"; // 現在の役割（employee / supervisor）

/**
 * 簡単な連番IDを生成する（第1段階の共通部品。以降の段階でも使う）。
 *
 * @param {string} prefix - 接頭辞（例："Q" なら Q001, Q002 …）
 * @param {Array}  array  - すでに存在するデータ配列
 * @param {string} key    - IDが入っているフィールド名（省略時は "id"）
 * @returns {string}      重複しない新しいID
 */
CERT_FLOW.generateId = function (prefix, array, key) {
  const field = key || "id";
  let max = 0;
  array.forEach(function (item) {
    const num = Number(String(item[field]).replace(prefix, "")) || 0;
    if (num > max) {
      max = num;
    }
  });
  // 例：max が 5 なら "Q006" になる（001 の形にそろえる）
  return prefix + String(max + 1).padStart(3, "0");
};

/**
 * 今日の日付を「YYYY-MM-DD」形式で返す（共通部品）。
 * 受験日の「過去日チェック」など、日付比較に使う。
 *
 * @returns {string} 例："2026-09-02"
 */
CERT_FLOW.todayStr = function () {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
};

/**
 * 画面に表示する文字列を安全な文字列へ変換する（XSS対策の共通部品）。
 * < > & " ' などがHTMLとして解釈されないようにする。
 *
 * @param {*} value - 変換したい値
 * @returns {string} 変換後の文字列
 */
CERT_FLOW.escapeHtml = function (value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

/**
 * サンプルデータを新しく作り直す（すべて架空の内容）。
 * 実在するのは資格名（日商簿記3級、ITパスポート、基本情報技術者試験、
 * TOEIC、SAP関連資格、応用情報技術者試験など）だけで、
 * 会社名・社員名・費用負担制度・報奨金額・目標点数・申請データはすべて架空。
 *
 * @returns {Object} 初期状態のデータ全体
 */
CERT_FLOW.createDefaultData = function () {
  return {
    /* ===== 利用者 ===== */
    employees: [
      { id: "EMP001", name: "新人A", role: "employee",   joinedDate: "2026-04-01" },
      { id: "EMP002", name: "新人B", role: "employee",   joinedDate: "2026-04-01" },
      { id: "EMP003", name: "新人C", role: "employee",   joinedDate: "2026-06-01" },
      { id: "SUP001", name: "上司X", role: "supervisor", joinedDate: null }
      // joinedDate = 入社日。費用負担の期限はこの日から計算する（固定日付は保存しない）。
    ],

    /* ===== 資格制度マスタ =====
       各項目の意味は README.md / CLAUDE.md を参照。
       ruleType の種類：
         withinJoiningPeriod=入社後一定期間内（資格ごと） / annualCategoryLimit=年度ごとグループ
         passRequired=合格時のみ / scoreRequired=目標点数以上 / notEligible=対象外
    */
    qualifications: [
      {
        id: "Q001",
        name: "日商簿記3級",
        category: "簿記",
        description: "商業簿記と工業簿記の基礎知識を証明する資格（例示）。",
        ruleType: "withinJoiningPeriod",
        resultType: "passFail",
        periodMonths: 3,          // 入社後3か月以内の受験だけ負担対象
        maxCount: 2,              // この資格だけで最大2回
        countScope: "qualification", // 回数を資格単独で数える
        quotaGroup: null,
        resetCycle: "none",       // 期間終了後も回数は更新しない
        fiscalYearStartMonth: 4,
        resultRequired: false,    // 合否に関係なく対象
        targetScore: null,
        rewardEligible: false,
        rewardAmount: 0,
        rewardCondition: "",
        managerComment: "",
        sourceCheckRequestId: null
      },
      {
        id: "Q002",
        name: "ITパスポート",
        category: "IT基礎",
        description: "ITを活用する社会人の基礎知識を証明する資格（例示）。",
        ruleType: "withinJoiningPeriod",
        resultType: "passFail",
        periodMonths: 3,
        maxCount: 2,              // ITパスポート単独で最大2回（簿記の回数とは合算しない）
        countScope: "qualification",
        quotaGroup: null,
        resetCycle: "none",
        fiscalYearStartMonth: 4,
        resultRequired: false,
        targetScore: null,
        rewardEligible: false,
        rewardAmount: 0,
        rewardCondition: "",
        managerComment: "",
        sourceCheckRequestId: null
      },
      {
        id: "Q003A",
        name: "SAP関連資格A",
        category: "SAP",
        description: "SAP関連の資格（例示・架空の内容）。",
        ruleType: "annualCategoryLimit",
        resultType: "passFail",
        periodMonths: null,
        maxCount: 4,              // グループ全体で1年度に4回
        countScope: "quotaGroup", // 回数をグループ単位で数える
        quotaGroup: "SAP",        // 同じ「SAP」グループとしてまとまる
        resetCycle: "fiscalYear", // 年度ごとに利用回数をリセット
        fiscalYearStartMonth: 4,  // 年度開始は4月
        resultRequired: false,    // 合否に関係なく対象
        targetScore: null,
        rewardEligible: false,
        rewardAmount: 0,
        rewardCondition: "",
        managerComment: "",
        sourceCheckRequestId: null
      },
      {
        id: "Q003B",
        name: "SAP関連資格B",
        category: "SAP",
        description: "SAP関連の資格（例示・架空の内容）。Aと同じグループで集計する。",
        ruleType: "annualCategoryLimit",
        resultType: "passFail",
        periodMonths: null,
        maxCount: 4,
        countScope: "quotaGroup",
        quotaGroup: "SAP",
        resetCycle: "fiscalYear",
        fiscalYearStartMonth: 4,
        resultRequired: false,
        targetScore: null,
        rewardEligible: false,
        rewardAmount: 0,
        rewardCondition: "",
        managerComment: "",
        sourceCheckRequestId: null
      },
      {
        id: "Q004",
        name: "基本情報技術者試験",
        category: "IT",
        description: "ITエンジニアの基礎知識とスキルを証明する試験（例示）。",
        ruleType: "passRequired", // 合格した場合だけ負担対象
        resultType: "passFail",
        periodMonths: null,       // 入社後期限なし
        maxCount: null,           // 第一版は回数上限を設定しない（マスタ変更で設定可能）
        countScope: "qualification",
        quotaGroup: null,         // 応用情報技術者試験（Q006）とは別管理（quotaGroup を共有しない）
        resetCycle: "none",
        fiscalYearStartMonth: 4,
        resultRequired: true,     // 合格が必要
        targetScore: null,
        rewardEligible: true,     // 報奨金あり
        rewardAmount: 50000,      // 報奨金予定額（架空）
        rewardCondition: "合格した場合",
        managerComment: "",
        sourceCheckRequestId: null
      },
      {
        id: "Q006",
        name: "応用情報技術者試験",
        category: "IT",
        description: "応用的な知識とスキルを証明するIT試験（例示）。",
        ruleType: "passRequired",
        resultType: "passFail",
        periodMonths: null,
        maxCount: null,
        countScope: "qualification",
        quotaGroup: null,         // 基本情報技術者試験（Q004）とは別管理
        resetCycle: "none",
        fiscalYearStartMonth: 4,
        resultRequired: true,
        targetScore: null,
        rewardEligible: true,
        rewardAmount: 100000,     // 報奨金予定額（架空）
        rewardCondition: "合格した場合",
        managerComment: "",
        sourceCheckRequestId: null
      },
      {
        id: "Q005",
        name: "TOEIC",
        category: "語学",
        description: "英語運用能力を測る試験（例示）。",
        ruleType: "scoreRequired", // 目標点数以上で負担対象
        resultType: "score",       // 結果報告では「点数」を入力する
        periodMonths: null,
        maxCount: null,            // 第一版は回数上限なし（マスタ変更で設定可能）
        countScope: "qualification",
        quotaGroup: null,
        resetCycle: "none",
        fiscalYearStartMonth: 4,
        resultRequired: false,
        targetScore: 730,          // 会社が定めた目標点数（架空の値）
        rewardEligible: false,
        rewardAmount: 0,
        rewardCondition: "",
        managerComment: "",
        sourceCheckRequestId: null
      }
    ],

    /* ===== 未登録資格の制度確認申請（サンプル：申請中） ===== */
    qualificationCheckRequests: [
      {
        id: "C001",
        qualificationName: "プロジェクトマネージャ試験",
        category: "IT",
        qualificationDescription: "プロジェクト管理の知識を問う試験（例示・架空の申請データ）",
        reason: "上流工程のプロジェクト管理を担当したいため（サンプル）",
        applicantId: "EMP001",
        status: "pending", // pending=申請中 / approved=承認 / rejected=却下
        createdDate: "2026-04-15",
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
        resultQualificationId: null // 承認後にマスタへ追加した資格ID（追加時にセット）
      }
    ],

    /* ===== 受験申請（サンプル：承認待ち1件） =====
       status: pending=承認待ち / approved=承認済み / rejected=却下 / completed=結果報告済み
       受験日は実際の受験日。費用負担や回数の判定はこの日で行う。 */
    examApplications: [
      {
        id: "A001",
        qualificationId: "Q002", // ITパスポート
        applicantId: "EMP001",
        examDate: "2026-10-15",
        expectedCost: 7500,
        purpose: "ITの基礎知識を身につけるため（サンプル）",
        status: "pending",
        rejectionReason: null,
        createdDate: "2026-09-01",
        approvedDate: null
      }
    ],

    /* ===== 試験結果報告・受験履歴（第3段階で増えていく） ===== */
    examReports: [],

    /* ===== 費用申請（第3段階で増えていく） ===== */
    reimbursementRequests: [],

    /* ===== 資格取得実績（第3段階で増えていく） ===== */
    achievementRecords: []
  };
};

/**
 * データを読み込む。
 * まだ保存されていない場合や、保存内容が壊れている場合は初期サンプルデータを返す。
 *
 * @returns {Object} 保存されているデータ（なければ初期サンプルデータ）
 */
CERT_FLOW.loadData = function () {
  const raw = localStorage.getItem(CERT_FLOW.STORAGE_KEY);
  if (!raw) {
    const data = CERT_FLOW.createDefaultData();
    CERT_FLOW.saveData(data);
    return data;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    // JSONとして読み込めない場合は初期化し直す
    const data = CERT_FLOW.createDefaultData();
    CERT_FLOW.saveData(data);
    return data;
  }
};

/**
 * データを localStorage へ保存する。
 *
 * @param {Object} data - 保存するデータ全体
 */
CERT_FLOW.saveData = function (data) {
  localStorage.setItem(CERT_FLOW.STORAGE_KEY, JSON.stringify(data));
};

/**
 * サンプルデータを初期状態へ戻す（テスト用の便利機能）。
 *
 * @returns {Object} 初期化後のデータ
 */
CERT_FLOW.resetData = function () {
  const data = CERT_FLOW.createDefaultData();
  CERT_FLOW.saveData(data);
  return data;
};

/* ================= 現在の役割の保存・読み込み ================= */

/**
 * 現在の役割を読み込む。
 *
 * @returns {string} "employee"（新入社員）または "supervisor"（上司）。デフォルトは employee
 */
CERT_FLOW.loadRole = function () {
  const role = localStorage.getItem(CERT_FLOW.ROLE_KEY);
  return role === "supervisor" ? "supervisor" : "employee";
};

/**
 * 現在の役割を保存する。
 *
 * @param {string} role - "employee" または "supervisor"
 */
CERT_FLOW.saveRole = function (role) {
  localStorage.setItem(CERT_FLOW.ROLE_KEY, role);
};
