/**
 * app.js（画面制御）
 *
 * 第1段階で実装する内容：
 *   - 共通ヘッダーの描画と役割切替（新入社員／上司）
 *   - 画面（ビュー）の切替仕組み（URL の「#」以降の文字で画面を切り替える）
 *   - 各画面の仮組み（プレースホルダ）表示
 *   - 「サンプルデータを初期化」ボタン
 *
 * 第2段階以降で、各画面の中身（検索・申請・承認などの機能）を実装する。
 * 実装済み画面は、各スクリプト（例：stage2.js）が
 * App.registerViewRenderer で描画関数を登録し、このファイルが呼び分ける。
 * まだ実装していない機能を作らないこと（実装段階の守る範囲）。
 *
 * 役割について：
 *   ログインを実装せず、ヘッダーのボタンで役割を切り替える疑似的な再現にする。
 *   現在の役割は localStorage の "certflow_role" に保存する。
 */

"use strict";

const App = CERT_FLOW.App = {};

/**
 * 実装済みの画面「描画関数」を登録する場所。
 * 各段階のスクリプト（例：stage2.js）が renderView の代わりに対象画面の中身を描画する。
 *   id          : 画面ID（App.ROUTES の id と同じ）
 *   viewRenders : { 画面ID: 描画関数 }
 *   currentQuery: URL（#）のクエリ部分を画面へ渡すための値（例：?name=基本情報）
 */
App.viewRenderers = {};
App.registerViewRenderer = function (viewId, renderer) {
  App.viewRenderers[viewId] = renderer;
};
App.currentQuery = {};

/* ===================== 画面（ルート）の定義 =====================
 *   id    : 画面の識別名（URLの「#/〜」の部分）
 *   role  : 見える役割（employee=新入社員 / supervisor=上司）
 *   label : 画面名
 *   stage : 実装予定の段階
 *   note  : その画面で実装する機能の説明（プレースホルダに表示する）
 */
App.ROUTES = [
  // ---- 新入社員向け ----
  {
    id: "top",
    role: "employee",
    label: "新入社員ダッシュボード",
    stage: "第2段階",
    note: "自分の「申請中」件数、直近の受験予定、資格取得実績の件数と報奨金予定額合計などをまとめて表示します。"
  },
  {
    id: "qualifications",
    role: "employee",
    label: "資格制度一覧と検索",
    stage: "第2段階",
    note: "資格制度一覧の表示と、資格名・カテゴリでの検索。会社負担の可否・期限・残り回数・報奨金・目標点数を確認できるようにします。"
  },
  {
    id: "check-request",
    role: "employee",
    label: "未登録資格の制度確認申請",
    stage: "第2段階",
    note: "一覧にない資格について、資格名・概要・理由を入力して上司に制度確認を申請します。"
  },
  {
    id: "exam-apply",
    role: "employee",
    label: "受験申請",
    stage: "第3段階",
    note: "受験日・予定費用・受験目的を入力して受験申請を行います。同じ社員・同じ資格・同じ受験日の重複申請はできません。"
  },
  {
    id: "report",
    role: "employee",
    label: "試験結果報告",
    stage: "第4段階",
    note: "承認済みの受験申請について、合格/不合格（または取得点数）・実際の費用・領収書提出状況を報告します。"
  },
  {
    id: "my-history",
    role: "employee",
    label: "自分の申請履歴",
    stage: "第5段階",
    note: "自分の制度確認・受験・費用申請の履歴とステータス、却下理由を確認します。"
  },
  {
    id: "my-achievements",
    role: "employee",
    label: "自分の資格取得実績",
    stage: "第5段階",
    note: "合格した資格の実績と、報奨金予定額の資格別内訳・合計を確認します。"
  },

  // ---- 上司向け ----
  {
    id: "supervisor",
    role: "supervisor",
    label: "上司用承認待ちダッシュボード",
    stage: "第5段階",
    note: "制度確認・受験・費用申請の承認待ち件数などをまとめて表示し、各承認画面へ誘導します。"
  },
  {
    id: "check-approvals",
    role: "supervisor",
    label: "制度確認承認一覧",
    stage: "第2段階",
    note: "確認待ちの申請を確認し、会社負担可否・上限回数・合否条件・報奨金額・コメントを設定して承認または却下します。"
  },
  {
    id: "exam-approvals",
    role: "supervisor",
    label: "受験申請承認一覧",
    stage: "第3段階",
    note: "受験申請を申請ごとに個別に承認または却下します。"
  },
  {
    id: "money-approvals",
    role: "supervisor",
    label: "費用申請承認一覧",
    stage: "第4段階",
    note: "費用申請を確認し、回数上限の再確認のうえ承認または却下します。"
  },
  {
    id: "all-history",
    role: "supervisor",
    label: "全員の受験履歴と資格取得実績",
    stage: "第5段階",
    note: "全社員の受験履歴・資格取得実績・スコア実績を確認します。"
  }
];

/* ===================== 補助的な関数 ===================== */

/**
 * 役割ごとの既定画面IDを返す。
 *
 * @param {string} role - "employee" または "supervisor"
 * @returns {string} 既定の画面ID
 */
function getDefaultRoute(role) {
  return role === "employee" ? "top" : "supervisor";
}

/**
 * 現在の役割から見て表示する画面IDを決める。
 * URLの「#」以降に別の画面があっても、その役割にない画面なら既定画面に戻す。
 *
 * @param {string} role - 現在の役割
 * @returns {string} 表示する画面ID
 */
function resolveViewId(role) {
  // 「#/check-request?name=〜」のようにクエリが付いていても画面ID（check-request）を取り出す
  const raw = location.hash.replace(/^#\/?/, "").split("?")[0];
  const found = App.ROUTES.find(function (route) {
    return route.id === raw && route.role === role;
  });
  return found ? found.id : getDefaultRoute(role);
}

/**
 * 指定した役割がその画面を見られるかを判定する。
 *
 * @param {string} role - 役割
 * @param {string} viewId - 画面ID
 * @returns {boolean} 見られるなら true
 */
function isRouteAccessible(role, viewId) {
  return App.ROUTES.some(function (route) {
    return route.id === viewId && route.role === role;
  });
}

/* ===================== 描画処理 ===================== */

/**
 * 共通ヘッダーを描画する。
 * 役割切替ボタン・現在の役割表示・サンプルデータ初期化ボタンを配置する。
 *
 * @param {string} role - 現在の役割
 */
function renderHeader(role) {
  const el = document.getElementById("header-actions");
  const roleName = role === "employee" ? "新入社員" : "上司";

  el.innerHTML =
    '<span class="current-role">現在の役割：' + roleName + "</span>" +
    '<button class="btn' + (role === "employee" ? " is-active" : "") +
      '" data-role="employee">新入社員</button>' +
    '<button class="btn' + (role === "supervisor" ? " is-active" : "") +
      '" data-role="supervisor">上司</button>' +
    '<button class="btn btn-outline-danger" id="reset-data-btn">サンプルデータを初期化</button>';

  // 役割切替ボタンに処理を割り当てる
  el.querySelectorAll("[data-role]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchRole(btn.dataset.role);
    });
  });

  // 初期化ボタンに処理を割り当てる
  document.getElementById("reset-data-btn").addEventListener("click", resetSampleData);
}

/**
 * 画面ナビゲーションを描画する。
 * 現在の役割で見られる画面だけをタブ状に並べる。
 *
 * @param {string} role - 現在の役割
 */
function renderNav(role) {
  const nav = document.getElementById("app-nav");
  const current = resolveViewId(role);

  const links = App.ROUTES
    .filter(function (route) {
      return route.role === role;
    })
    .map(function (route) {
      const active = route.id === current ? " is-active" : "";
      return '<a class="nav-link' + active + '" href="#/' + route.id + '">' + route.label + "</a>";
    })
    .join("");

  nav.innerHTML = links;
}

/**
 * 画面の中身を描画する。
 * - 実装済みの画面は、App.registerViewRenderer で登録された描画関数を呼ぶ
 * - 未実装の画面は「仮組み（プレースホルダ）」としてタイトルと予定の説明を表示する
 *
 * @param {string} role - 現在の役割
 */
function renderView(role) {
  const content = document.getElementById("app-content");
  const viewId = resolveViewId(role);
  const route = App.ROUTES.find(function (r) {
    return r.id === viewId;
  });

  // 実装済みの画面があれば、その描画関数を使う
  const renderer = App.viewRenderers[viewId];
  if (renderer) {
    renderer(content, route);
    return;
  }

  content.innerHTML =
    '<div class="placeholder">' +
      '<span class="placeholder-stage">この画面は ' + route.stage + ' で実装予定</span>' +
      '<h2 class="placeholder-title">' + route.label + "</h2>" +
      '<p class="placeholder-text">' + route.note + "</p>" +
      '<p class="placeholder-note">この画面の中身は、次の段階で実装します。</p>' +
    "</div>";
}

/**
 * 画面全体を描画し直す。
 * 役割の読み込み、URL（#）の整え、ヘッダー・ナビ・中身の描画を行う。
 */
function render() {
  const role = CERT_FLOW.loadRole();

  // URL（#）に付いたクエリ（例：#/check-request?name=基本情報）を画面へ渡す
  App.currentQuery = {};
  const hashAll = location.hash.replace(/^#\/?/, ""); // "#/" を除去
  const qIndex = hashAll.indexOf("?");
  if (qIndex >= 0) {
    const params = new URLSearchParams(hashAll.slice(qIndex + 1));
    params.forEach(function (value, key) {
      App.currentQuery[key] = value;
    });
  }

  // URL（#）を現在の役割に合う画面IDへ整える（クエリ部分は含めない）
  const target = resolveViewId(role);
  const raw = hashAll.split("?")[0];
  if (raw !== target) {
    location.hash = "#/" + target;
  }

  renderHeader(role);
  renderNav(role);
  renderView(role);
}

/* ===================== イベント処理 ===================== */

/**
 * 役割を切り替える。
 * 切り替えた先の役割で見られない画面を表示していた場合は、その役割の既定画面へ移動する。
 *
 * @param {string} nextRole - 切り替え先の役割
 */
function switchRole(nextRole) {
  const prevRole = CERT_FLOW.loadRole();
  if (prevRole === nextRole) {
    return; // 同じ役割なら何もしない
  }
  const currentView = resolveViewId(prevRole); // 切り替え前の画面ID
  CERT_FLOW.saveRole(nextRole);

  // 切り替え後の役割で見られない画面なら、既定画面へ移動する
  if (!isRouteAccessible(nextRole, currentView)) {
    location.hash = "#/" + getDefaultRoute(nextRole);
  }
  render();
}

/**
 * サンプルデータを初期状態へ戻す（確認ダイアログ付き）。
 * 現在の役割（certflow_role）はそのまま残す。
 */
function resetSampleData() {
  const ok = window.confirm("サンプルデータを初期状態に戻します。よろしいですか？");
  if (!ok) {
    return;
  }
  CERT_FLOW.resetData();
  render(); // 画面を描画し直す
}

/* ===================== 起動処理 ===================== */

// HTMLが読み込み終わったら初期描画する。
// URLの「#」が変わったとき（画面リンクを押したとき）も描画し直す。
document.addEventListener("DOMContentLoaded", function () {
  window.addEventListener("hashchange", render);
  render();
});
