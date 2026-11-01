# ミッション・ファインダー

好きなこと3つ・嫌いなこと3つから、選択25問＋自由記述3回でミッションの下書きをつくるツール。記事の中に埋め込んで使う。

## 記事に置く

置きたい場所に、1行だけ書く。

```md
::mission-finder
```

記事ページのスクリプト（`src/layouts/PostLayout.astro`）が、この枠を見つけたときだけツールを読み込む。

## 結果画面

- ミッションは2つまで。1つ目は本人が最後に書いた文。2つ目は「6つに共通していた気持ち」から下書きをつくり、結果画面で自分の言葉に書き換えられる（1つ目と同じ気持ちなら、次に強い気持ちから）。
- 「6つに共通していたこと」：好き・嫌いの6項目それぞれに、どの気持ちが出ていたかを並べる。ミッションのもとになった気持ちは強調する。
- 「PDFで保存」：結果をA4の紙面にして、ブラウザの印刷を開く。「PDFとして保存」を選ぶ（iPhone は「共有 → PDF」）。日本語フォントを埋め込まないので、ページは重くならない。

## 構成

| 場所 | 役割 |
|---|---|
| `src/lib/mission-finder/flow.js` | 質問の骨組み（順番・問数・何を測るか）。ここは固定 |
| `src/lib/mission-finder/codes.js` | 動機コード K1〜K7、方向性（記事の4分類）などの定義 |
| `src/lib/mission-finder/generator/template.js` | テンプレート版の生成器。AIが使えないときの受け皿 |
| `src/lib/mission-finder/generator/ai.js` | AI版の生成器（選択肢の言い換え・自由記述の分析） |
| `src/lib/mission-finder/scoring.js` | 集計（AIを使わず決定的に計算） |
| `src/lib/mission-finder/app.js` | 画面と操作。`mountMissionFinder(枠)` |
| `src/styles/mission-finder.css` | 見た目（記事内アンケートと同じ系統） |
| `supabase/functions/neulog-mission/` | AIを呼ぶ Edge Function。APIキーはここにだけ置く |
| `supabase/migrations/20261028000000_add_mission_finder_rate_limits.sql` | 1日の回数制限に使うアクション名を追加 |

## AIを有効にする（公開の手順）

AIの関数を公開するまでは、ツールはテンプレート版で動く（壊れない）。

1. 回数制限のマイグレーションを当てる（Supabase の SQL Editor で実行してもよい）

   ```bash
   supabase db push
   ```

2. APIキーを secret に入れる

   ```bash
   supabase secrets set ANTHROPIC_API_KEY=（あなたのキー）
   ```

3. 関数を公開する（neulog-community と同じく、ログインなしで呼べるようにする）

   ```bash
   supabase functions deploy neulog-mission --no-verify-jwt
   ```

### 調整できる secret

| 名前 | 既定 | 内容 |
|---|---|---|
| `MISSION_MODEL` | `claude-haiku-5-5` | 使うモデル。文言の質を上げたいなら `claude-sonnet-5-5` など |
| `MISSION_VISITOR_DAILY_LIMIT` | `24` | 1人あたり1日のAI呼び出し回数（1回の利用でおよそ8回） |
| `MISSION_DAILY_LIMIT` | `800` | サイト全体の1日のAI呼び出し回数（およそ100人ぶん） |
| `MISSION_AI_ENABLED` | （なし） | `false` にするとAIを止め、全員テンプレート版になる |

費用の目安（Haiku 5.5、ざっくり）：1回通して1円未満。サイト全体の上限まで使われても、1日数十円ほど。

上限を超えると、画面に一度だけお知らせを出して、定型の選択肢で続ける。

## 手元で試す

`npm run dev` で記事を開き、URL に次を付ける（開発中だけ効く）。

| パラメータ | 動き |
|---|---|
| `?mission-ai=mock` | 偽のAIで、言い換え・引用つき分析・相談先の表示を試す |
| `?mission-ai=mock-limit` | 「今日の上限に達した」状態を試す |
| `?mission-ai=off` | AIなし（テンプレート版） |
| `?mission-ai=local` | 手元で動かしたAIの関数（localhost:8000）につなぐ。下の「本物のAIを手元で試す」 |
| `?mission-debug` | 結果画面にスコアと回答データを出す |

### 本物のAIを手元で試す（公開せずに）

1. `supabase/functions/.env` を作り、1行だけ書く（`.gitignore` の `.env` で Git には入らない）

   ```
   ANTHROPIC_API_KEY=（Anthropic Console で発行したキー）
   ```

2. 関数を手元で起動する（回数制限なしの手元モード）

   ```bash
   MISSION_LOCAL=1 deno run --no-lock --node-modules-dir=none --allow-net --allow-env --allow-read --env-file=supabase/functions/.env supabase/functions/neulog-mission/index.ts
   ```

3. `npm run dev` の記事を `?mission-ai=local` 付きで開く

キーを書き換えたら、関数を起動し直す（キーは起動時に読む）。

入力画面の「サンプルを入れる」も開発中だけ出る。

関数のチェックとテスト：

```bash
deno test --no-lock supabase/functions/neulog-mission/validate_test.ts
deno check --no-lock --node-modules-dir=none supabase/functions/neulog-mission/index.ts
```

## AIの使い方の決まりごと

- 質問の骨組みと集計はAIに任せない。AIは「選択肢の文言」と「自由記述の読み取り」だけ。
- 選択肢は、動機コードの枠（スロット）を固定したまま文言だけ言い換える。足りない枠はテンプレ文言で埋める。
- 自由記述は、本人の文章からの引用つきで読み取る。引用が本文に無いものは捨てる。本人が言っていること（testimony）だけをスコアに入れ、推測（inference）は表示だけ。
- 自殺・自傷・虐待などが読み取れたら、先へ進む前に相談先を出す。
