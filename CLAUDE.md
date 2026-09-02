# CertFlow — 開発者向け仕様メモ（Claude Code / 開発補助用）

このファイルは、CertFlow の開発を補助するとき（Claude Code など）が
引き継ぎやすいように、仕様の要点をまとめたものです。

---

## プロジェクト概要

- 「新人資格取得・費用申請管理ツール」の学習用個人制作（デモ）。
- 主な利用者：新入社員（資格制度の確認・受験申請・結果報告・費用申請）と
  上司（制度確認・受験申請・費用申請の承認、全員の履歴・実績の確認）。
- **架空の会社制度のデモ**。実在の資格名（日商簿記3級・ITパスポート・基本情報技術者試験・
  TOEIC・SAP関連資格・応用情報技術者試験など）は例として使用してよいが、
  会社名・社員名・報奨金額・目標点数・サンプル申請データなどは**すべて架空**であることを維持する。

## 技術制約（厳守）

- HTML / CSS / JavaScript **のみ**。フレームワーク・外部API・サーバー・ビルドツールは使わない。
- **ES Modules は使わない**（HTMLを直接開いたときにブロックされるため）。
  通常の `script` タグで、`data.js` → `app.js` → `stage2.js` → `stage3.js` → `stage4.js` → `stage5.js` の順に読み込む。
- グローバル空間には `CERT_FLOW` オブジェクトだけを置き、その中に関数をまとめる。
- データは localStorage のキー `certflow_data` に JSON 形式で1つのオブジェクトとして保存する。
- 画面は1つの HTML + JavaScript で切り替える（ハッシュ `#/画面ID` によるルーティング）。
- 実装済み画面は、各段階のスクリプトが `App.registerViewRenderer("画面ID", 描画関数)` で登録し、
  `app.js` の `renderView` が呼び分ける。未登録の画面はプレースホルダ表示のまま。
- URL（#）にクエリを付けて値を受け渡せる（例：`#/check-request?name=基本情報`）。
  `App.currentQuery` に解析結果が入る。
- ログイン・メール・振込・ファイルアップロードは実装しない。
- 領収書は「提出済み／未提出」（boolean）だけで扱う。
- 表示テキスト・コードのコメント・編集時の説明は**すべて日本語**で行う。

## ファイルの役割（現在の構成）

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の土台。ヘッダー・ナビ・表示領域だけを持ち、中身は JS が描画する |
| `css/style.css` | デザイン。PC中心・スマホ（600px以下）にも対応 |
| `js/data.js` | データ層。サンプルデータ定義、localStorage 読み書き、初期化、ID生成 |
| `js/app.js` | 画面制御。役割切替、画面定義（ルート）・切替、描画関数の呼び分け、初期化ボタン |
| `js/stage2.js` | 第2段階の画面：資格一覧・検索・制度確認申請・上司の承認（業務ロジックは DOM 非依存） |
| `js/stage3.js` | 第3段階の画面：受験申請・上司の受験申請承認（業務ロジックは DOM 非依存） |
| `js/stage4.js` | 第4段階の画面：結果報告・上司の費用申請承認と、費用負担判定（画面表示から分離した関数で実装） |
| `js/stage5.js` | 第5段階の画面：ダッシュボード（#/top・#/supervisor）と一覧（#/my-history・#/my-achievements・#/all-history） |
| `README.md` | 利用者向けの起動方法・構成説明 |

## データ構造（保存キー：`certflow_data`）

```
employees                : [{ id, name, role, joinedDate }]
qualifications           : [{ id, name, category, description, ruleType, resultType,
                             periodMonths, maxCount, countScope, quotaGroup, resetCycle,
                             fiscalYearStartMonth, resultRequired, targetScore,
                             rewardEligible, rewardAmount, rewardCondition,
                             managerComment, sourceCheckRequestId }]
qualificationCheckRequests: [{ id, qualificationName, category, qualificationDescription, reason,
                              applicantId, status, createdDate, ruleType, resultType,
                              periodMonths, maxCount, countScope, quotaGroup, resetCycle,
                              fiscalYearStartMonth, resultRequired, targetScore,
                              rewardEligible, rewardAmount, managerComment,
                              decisionDate, rejectionReason, resultQualificationId }]
examApplications         : [{ id, qualificationId, applicantId, examDate, expectedCost,
                             purpose, status, rejectionReason, createdDate, approvedDate }]
examReports              : [{ id, examApplicationId, qualificationId, applicantId, examDate,
                             resultType, pass, score, actualCost, receiptSubmitted, reportDate }]
reimbursementRequests    : [{ id, examReportId, examApplicationId, qualificationId,
                             applicantId, examDate, amount, status, rejectionReason,
                             createdDate, approvedDate }]
achievementRecords       : [{ id, qualificationId, applicantId, examReportId, achievedDate,
                             rewardEligible, rewardAmount, rewardStatus }]
```

- `joinedDate`：入社日。費用負担の期限は**この日から計算する**（固定日付は保存しない）。
- `examDate`：受験日。**判定はこの日で行う**（申請日・報告日は使わない）。
- `examApplications.status` は `pending`（承認待ち）/ `approved`（承認済み）/ `rejected`（却下）/ `completed`（結果報告済み）。
  表示は日本語で対応付け（`Stage3.EXAM_STATUS_LABELS`）。`completed` への遷移は第4段階で行う。

## 判定ルールの種類（ruleType）

| ruleType | 内容 |
|---|---|
| `withinJoiningPeriod` | 入社後一定期間内（`periodMonths`）で、資格ごとに回数を数える（`countScope: "qualification"`） |
| `annualCategoryLimit` | 年度ごとに資格グループ（`quotaGroup`）全体の回数を数える（デフォルト年度開始4月） |
| `passRequired` | 合格した場合だけ会社負担 |
| `scoreRequired` | `targetScore` 以上の場合だけ会社負担 |
| `notEligible` | 会社負担対象外 |

- `resultType`：`passFail`＝合格/不合格の選択、`score`＝点数入力（結果報告の入力形式を切り替える）。
- `maxCount: null` は「回数上限なし」。

## 費用負担の判定順序

1. 元の受験申請が承認済み（`approved`）か
2. 同じ試験結果からの費用申請が未作成か（二重作成防止）
3. `ruleType` ごとの条件（期限・合否・点数）を満たすか
4. 回数上限内か（本人・承認済み費用申請の件数で数える）
5. 領収書が提出済みか
→ すべて満たすときだけ費用申請を自動生成する。
**上司が費用申請を承認するときも回数を再確認**すること（上限到達なら承認不可）。

## 重複申請の判定（重要）

- category（カテゴリ）は重複判定に**使わない**。表示用の分類にすぎない。
- 重複と判定するのは次の条件を**すべて**満たす場合のみ：

```js
const isDuplicate = examApplications.some(application =>
  application.applicantId === applicantId &&
  application.qualificationId === qualificationId &&
  application.examDate === examDate &&
  application.status !== "rejected"
);
```

- 申請中・承認済み・結果報告済み（status が承認済みのまま）の場合は再申請できない。
- **卻下済み（rejected）の申請だけ**、同じ受験日でも再申請できる。

## 二重登録の防止（結果報告後）

各作成処理の前に既存データを確認する：

- 同じ `examApplicationId` から `examReport` を2件作らない
- 同じ `examReportId` から `achievementRecord` を2件作らない
- 同じ `examReportId` から `reimbursementRequest` を2件作らない
- 同じ `examReportId` から報奨金を2回記録しない（報奨金は achievementRecord に持たせる）

## 基本情報（Q004）と応用情報（Q006）は完全に別管理

- カテゴリはどちらも「IT」でも、`qualificationId` が異なるため同時申請できる。
- 申請・承認・結果報告・費用申請・取得実績・報奨金をすべて別々に扱う。
- `quotaGroup` を共有しないため、回数も合算しない。

## 報奨金と領収書

- 報奨金の判定と受験費用の判定は別々。
- 報奨金は合格（passRequired）または目標達成（scoreRequired）の条件だけで判定し、
  **領収書の有無に影響されない**。領収書は受験費用申請の条件。
- 報奨金は単位ごと（Q004=50,000円 / Q006=100,000円）に別々の実績として保存し、
  合計はダッシュボード表示時に足し算する（1件に合算保存しない）。

## 第2段階：制度確認申請のルール（実装済み）

- ステータス：保存は英語 `pending` / `approved` / `rejected`、表示は日本語
  「確認待ち / 承認済み / 却下」で対応付け（`Stage2.STATUS_LABELS`）。
- 新入社員の申請時チェック：
  - 資格名・カテゴリ・申請理由が必須。
  - **同じ資格名で `pending`（確認待ち）の申請があれば重複として拒否**。
- 上司の承認時に設定できる項目と、資格マスタへの反映：
  | 設定 | 反映先 |
  |---|---|
  | 会社負担可否（対象） | ruleType に影響（下記の2択） |
  | 会社負担可否（対象外） | ruleType = `notEligible`（上限・報奨金は無効） |
  | 費用負担条件「合否問わず」 | ruleType = `withinJoiningPeriod`（periodMonths = null ＝ 期限なし） |
  | 費用負担条件「合格時のみ」 | ruleType = `passRequired`（resultRequired = true） |
  | 負担上限回数（空欄＝上限なし） | maxCount = null |
  | 報奨金額（0＝なし） | rewardEligible / rewardAmount |
  | コメント | managerComment |
- 承認時：申請レコードを `approved` にし、`resultQualificationId` に追加した資格IDを記録。
- 却下時：`rejected` ＋ `rejectionReason`。マスタには追加しない。
- **処理済み（approved / rejected）の申請は再承認・再却下できない**（二重承認の防止）。
- 資格一覧で表示する「負担条件」は `Stage2.describeCondition`、「残り回数」は
  `Stage2.getRemainingCount`（＝上限 − 承認済み費用申請件数。第4段階で意味を持つ）。

## 第3段階：受験申請のルール（実装済み）

- ステータス：保存は `pending` / `approved` / `rejected` / `completed`、
  表示は日本語（承認待ち / 承認済み / 却下 / 結果報告済み）。
- 新入社員の受験申請時の入力チェック：
  - 資格（qualificationId）を選択していること
  - **受験日は今日以降**（`examDate < CERT_FLOW.todayStr()` なら「過去の日付は受験日にできません」）
  - 予定費用は 0 以上の整数
  - 受験目的が必須
  - **重複申請の防止**：同じ社員・同じ `qualificationId`・同じ `examDate` で、
    `status !== "rejected"` の申請があれば拒否（承認待ち・承認済み・結果報告済みは再申請不可、
    却下済みのみ再申請可）。カテゴリは判定に使わない。
- 会社負担対象外（ruleType = notEligible）の資格は、申請フォームで「自己負担（自費）」を明示する。
- 上司の承認／却下：
  - 承認：`status = approved`、`approvedDate = 判定日`。
  - 却下：**理由が必須**。`status = rejected`、`rejectionReason` に保存。
  - 処理済みの申請は再承認・再却下できない（二重承認の防止）。
- 画面遷移：資格一覧カードの「受験申請」ボタン → `#/exam-apply?qualificationId=Q○○○`（選択済みで遷移）。
- 使用する共通部品は `CERT_FLOW.todayStr` / `CERT_FLOW.escapeHtml`（data.js 定義）。

## 第4段階：結果報告・費用申請・取得実績のルール（実装済み）

### 結果報告（`Stage4.createExamReport`）
- 報告できるのは「承認済み（approved）かつ未報告」の受験申請だけ。
  同じ `examApplicationId` の `examReports` がすでにあれば「結果報告済み」としてブロック（二重報告防止）。
- 入力形式は `resultType` で切り替え：
  - `passFail` → 合格（pass=true）／不合格（pass=false）を選択
  - `score`（TOEIC） → 取得点数（score）を入力。**目標点数以上なら達成**（`score >= targetScore`）
- 共通：実際の受験費用（0以上の整数）、領収書提出有無（boolean）。
  合否型で合格の場合は**取得日**が必要（未来日不可）。スコア型は取得日不要（スコア実績は受験履歴で管理）。
- 保存処理：
  - 合否に関係なく `examReports` へ保存し、元の受験申請を `completed`（結果報告済み）に更新。
  - 合否型で合格した場合だけ `achievementRecords` を作成。
    報奨金（`rewardAmount > 0`）は合格が条件で、**領収書は条件にしない**（`rewardEligible` / `rewardAmount` / `rewardStatus="scheduled"`）。
  - スコア型は達成しても `achievementRecords` に入れない（スコア実績）。

### 費用申請の自動判定（`Stage4.evaluateReimbursement`／画面表示から分離）
次の順序で判定し、**最初に失敗した条件の理由**を返す。
1. この結果の費用申請が未作成か（`examReportId` で二重作成防止）
2. 会社負担対象か、制度の条件を満たすか（ruleType 別・**受験日に基づく**）
   - `withinJoiningPeriod`：`入社日 <= 受験日 < calcPeriodEnd(入社日, periodMonths)`
   - `passRequired`：`pass === true`（外れは「合格条件を満たしていません」）
   - `scoreRequired`：`score >= targetScore`（外れは「会社指定の目標点数に達していません」）
   - `notEligible`：「会社負担対象外の資格です」
   - `annualCategoryLimit`：回数と年度で判定（下記）
3. 負担上限回数未満：`countUsedApprovals` で「本人の承認済み費用申請件数」を数える
   - `countScope="qualification"`：同じ資格単独
   - `countScope="quotaGroup"`：同じ年度・同じ `quotaGroup`（SAPなど）で合算（`fiscalYearOf`）
   - `maxCount === null` は上限なし
4. 領収書が提出済み（未提出なら「領収書が未提出です」）
→ すべて満たすときだけ `reimbursementRequests` を自動生成（`amount = 実際費用`、status = pending）。

### 費用申請の承認・却下（`Stage4.approveReimbursement` / `rejectReimbursement`）
- 承認時にも回数上限を**再確認**し、上限に達していれば承認不可。
- 却下時は理由必須。処理済み（approved / rejected）の費用申請は再承認・再却下できない。

### その他の計算（`Stage4` に公開）
- `calcPeriodEnd(入社日, 月数)`：期限日（期間には含まない）。例：2026-04-01＋3 → 2026-07-01
- `fiscalYearOf(日付, 開始月)`：例：startMonth=4 で 2027-02-10 → 2026年度。

## 第5段階：ダッシュボード・一覧のルール（実装済み）

- 新入社員ダッシュボード（`Stage5.employeeSummary` / DOM非依存）
  - 制度確認申請中（pending の制度確認申請・本人分）
  - 受験申請 承認待ち（pending の受験申請・本人分）
  - 受験申請 承認済み（approved ＋ completed の合計）
  - 結果未報告（approved かつ examReports に紐づく報告がないもの）
  - 費用申請中（pending の費用申請・本人分）、取得資格数、報奨金予定額合計（rewardStatus="scheduled" の rewardAmount 合計）
- 上司ダッシュボード（`Stage5.supervisorSummary`）
  - 制度確認待ち／受験申請承認待ち／費用申請承認待ち（全員分の pending）
  - 当月の資格取得件数（achievedDate が今日の YYYY-MM で始まるもの）
- 一覧（`Stage5.filterRows`）…どのタブもキーワード検索・ステータス絞り込み・0件メッセージあり
  - 自分の申請履歴（#/my-history）：タブ `check`（制度確認）/ `exam`（受験）/ `money`（費用）
  - 自分の資格取得実績（#/my-achievements）：取得資格＋報奨金予定額合計
  - 全員の受験履歴・取得実績（#/all-history）：タブ `reports` / `achievements` / `money`
  - タブはURLクエリ（`?tab=exam` など）で切替え、hashchange で再描画される。
- ルート12件のすべてに描画関数が登録済み（App.viewRenderers のキー数 = App.ROUTES 数 = 12）。

## 実装ロードマップ（現在の状況）

| 段階 | 内容 | 状況 |
|---|---|---|
| 1 | 骨組み：ヘッダー・役割切替・画面切替・データ初期化・仮組み画面 | **完了** |
| 2 | 資格制度一覧と検索・絞り込み、未登録資格の制度確認申請（申請＋上司承認＋マスタ追加） | **完了** |
| 3 | 受験申請と上司の受験申請承認 | **完了** |
| 4 | 結果報告、費用申請の自動判定、取得実績・報奨金の記録、費用申請の承認 | **完了** |
| 5 | ダッシュボード、各一覧（検索・絞り込み）、デザイン調整、最終確認 | **完了** |

**全段階が完了している。** これから機能を追加・修正する場合は必ずこの仕様メモを参照し、
既に動く範囲（ヘッダー・役割切替・制度確認申請・受験申請・結果報告・費用申請・ダッシュボード）を壊さないこと。
実装後は全 JS の構文チェック（`node --check`）と、ブラウザを模した環境での一連の業務フローテスト（第1〜5段階）を必ず行うこと。
