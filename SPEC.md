# Metro Beat

## Overview
ブラウザで動くシンプルなメトロノームアプリ。個人練習やリハーサル時に、BPM 調整に加えて曲ライブラリとセットリストから素早くテンポを呼び出したい演奏者向け。

## Stack
- Framework: Vite を使った素の HTML/CSS/JavaScript 構成。依存を増やさず、単一ページの UI を直接制御している
- Audio: Web Audio と `HTMLAudioElement` を併用し、foreground / background で再生経路を切り替える
- Storage: 保存先はブラウザ `localStorage`。サーバー保存や同期機構は持たない
- Tests: Node 標準 `node:test` を依存追加なしで使用する。テストは `src/` 配下に co-located で `*.test.js` として置き、`npm test` で実行する（Vite ビルドは何処からも import されない `*.test.js` を bundle graph に含めない）

## Structure
- `index.html`: 現在の本番エントリ。メトロノーム、セットリスト、ライブラリの3ビューを同一 HTML 内に持つ
- `src/main.js`: アプリの composition root。i18n インスタンス、metronome / collections controller、paywall、swipe panel、bottom nav を生成して接続する。機能ロジック本体は `src/app/*` と `src/ui/*` / `src/state/*` 側へ分離する
- `src/app/metronome-controller.js`: メトロノーム機能 controller (`createMetronomeController`)。BPM/拍子/音量/拍状態/ミュート/再生状態、foreground scheduler、background playback、Wake Lock、settings panel、ボール描画、メトロノーム画面内の i18n 反映を束ねる。曲/セットリストの永続データは持たず、外部から `applySongConfig` / `currentBeatVolumes` / `currentBeatStates` などの小さな API で操作される
- `src/app/collections-controller.js`: セットリスト・曲ライブラリ controller (`createCollectionsController`)。setlist/library ストア、UI 選択状態、CRUD、DnD、曲フォーム、ライブラリピッカー、Now Playing を束ねる。曲選択時のテンポ反映・再生トグルは `metronome-controller` の公開 API 経由で行う
- `src/config.js`: BPM / 拍子 / スウィング / クリック音 / フリープラン上限などの定数と `localStorage` キー (`LS_KEYS`) を集約する
- `src/i18n.js`: ja/en 翻訳辞書と `createI18n(initialLang)` ファクトリ。言語切替は `localStorage` の `metro-lang` を経由する
- `src/audio/synth.js`: スクエア波クリックの共通レンダラ `renderClick` と `getSubdivisionsPerBeat` を持つ。live AudioContext と OfflineAudioContext の双方から共有される
- `src/audio/timing.js`: BPM からの拍長・小節長・native loop の拍位置・foreground scheduler の直近拍位置・スウィング適用後の小節内サブビート時刻を計算する純粋関数群。`main.js`、`src/ui/ball.js`、`src/audio/scheduler.js`、`src/audio/bg-loop.js` から共有する
- `src/audio/scheduler.js`: 16 分音符解像度の foreground スケジューラ (`createScheduler`)。スウィング適用済みの小節内イベント、タイマー ID、直近スケジュール済み拍時刻を内包し、`start` / `stop` / `getScheduledBeatTimes` を公開する
- `src/audio/bg-loop.js`: バックグラウンド再生用の WAV ループを `OfflineAudioContext` で構築する `createBgLoopBuilder` ファクトリ。BPM/拍子/音量/スウィングのシグネチャでキャッシュする
- `src/audio/bg-playback.js`: バックグラウンド再生コントローラ (`createBgPlayback`)。`HTMLAudioElement` 経路と Capacitor `MetronomeAudio` プラグイン経路の両方の lifecycle (warm-up・start/stop・mute 同期・遅延付き refresh・native prepare promise) を内包し、`start` / `stop` / `refreshNow` / `refreshWhenSafe` / `refreshAndResume` / `cancelDeferredRefresh` / `syncMuted` / `syncNativeState` / `awaitNativePrepare` / `warmUp` を公開する
- `src/state/setlist.js`: セットリストの永続化ストア (`createSetlistStore`)。`setlists` 配列を保持し、`add` / `update` / `remove` / `reorder` のセットリスト単位ミューテーションと `addSong` / `updateSong` / `replaceSong` / `removeSong` / `reorderSongs` のネスト曲単位ミューテーションを公開する。すべてのミューテーションで自動的に `localStorage` (`metro-setlists`) を flush する。`all` / `count` / `findById` / `findSong` で読み出しを行う。UI 状態 (`currentSlId`・`activeSlId`・`activeSongId`・`editingSlId`・`editingSongId`) は `src/state/ui-selection.js` と `src/app/collections-controller.js` 側が扱う
- `src/state/song-library.js`: 曲ライブラリの永続化ストア (`createSongLibraryStore`)。`songs` 配列とソートモード (`'manual' | 'name' | 'bpm'`) を保持し、`add` / `update` / `remove` / `reorder` 経由のミューテーションで自動的に `localStorage` (`metro-song-lib`) を flush する。`all` / `count` / `findById` / `sortedForDisplay` / `getSortMode` / `setSortMode` を公開する。UI 選択状態 (`activeLibSongId`)・フォーム状態・DOM 描画は `src/app/collections-controller.js` 側が扱う
- `src/state/song-config.js`: 保存済み曲・ライブラリ曲・フォーム値の曲設定デフォルト (`tsNum` / `tsDen` / `beatStates` / `beatVolumes` / `swingMode` / `swingAmount`) を正規化する小さな helper。セットリスト曲がライブラリ曲を参照する場合の fallback chain もここを経由する
- `src/state/beat-states.js`: 拍状態 (`accent` / `normal` / `mute`) の初期化・正規化・循環 (`buildDefaultBeatStates` / `normalizeBeatStates` / `getNextBeatState`) を持つ。複合拍子 (`6/8`、`9/8`、`12/8`) の3カウントごとのアクセント規則もここに集約する
- `src/state/ui-selection.js`: UI 選択状態 (`currentSetlistId`・`activeSongId`・`activeSetlistId`・`activeLibrarySongId`・各種 editing id) をまとめる `createUiSelection`。選択/解除/編集中 ID の更新メソッドを提供する。状態の用途判断や副作用 (`updateNowPlaying` / row active 同期) はホスト側に残す
- `src/ui/dnd.js`: タッチ/マウス共通の DnD 並び替えロジック (`setupDnD`)
- `src/ui/song-row.js`: セットリスト/ライブラリで共通の曲行レンダラ (`renderSongRows`)。トラック番号・ドラッグハンドルの有無や `data-action` 名、各種コールバックを引数で渡してビュー差分を吸収する。ID keyed reconciliation で既存行を再利用し、追加/削除/並び替え時もリスト全体の HTML 再生成を避ける。各行の `apply` / `edit` / `delete` ハンドラは `.onclick =` プロパティ代入で再描画ごとに最新 callback へ張り替えるため、行データが同一でも stale closure 化しない。選択行だけの切り替えは `setActiveRow(listEl, activeId)` で `.active` クラスのみを同期する
- `src/ui/setlist-row.js`: セットリスト一覧行レンダラ (`renderSetlistRows`)。セットリスト名・曲数・編集/削除アイコン・DnD ハンドルの DOM と listener 配線を内包し、ホスト側は `onOpen` / `onEdit` / `onDelete` を渡す。ID keyed reconciliation で既存行を再利用し、`.onclick =` 経由のハンドラ張り替えで stale closure を避ける
- `src/ui/library-picker.js`: セットリスト曲フォーム内のライブラリ選択リスト (`renderLibraryPicker`)。ライブラリ曲候補の DOM と選択 listener 配線を内包する。ID keyed reconciliation で候補行を再利用し、`onPick` ハンドラは `.onclick =` で張り替える
- `src/ui/ts-picker.js`: セットリスト曲フォーム/ライブラリフォーム共通の拍子ピッカー。セットリスト曲フォームはボタン式、ライブラリフォームは選択式で描画し、`setTsPickerValues` でマウント済みピッカーの選択値を後から差し替える。`prefix` (`'pfTs'` / `'libTs'`) で入力 id を分岐する
- `src/ui/song-form.js`: セットリスト曲フォーム (`pf*` id) とライブラリフォーム (`lib*` id) で共通の手動入力ライフサイクル (`createSongForm`)。名前・BPM・拍子ピッカー・キャプチャプレビュー・保存/キャンセル/Enter ハンドリング・`beatVolumes` / `beatStates` / `swingMode` / `swingAmount` の一時バッファを内包し、`open` / `close` / `applyCapture` / `focusName` を公開する。外側のフォーム可視制御 (`#presetForm.style.display` / `#libForm.style.display`)・Pro ゲート・ストア dispatch・`propagateLibSongChange` などのクロスカット処理は `src/app/collections-controller.js` 側が担当する
- `src/ui/paywall.js`: Pro 状態と paywall モーダルのライフサイクル (`createPaywall`)。Web では dev-only の Pro 切替トグルと `localStorage` の `metro-dev-force-pro` 同期を内包し、`isPro` / `requirePro` を公開する。フリープラン上限との比較や、Pro 状態変更後のリスト再描画は `src/app/collections-controller.js` 側が担当する
- `src/ui/modal-a11y.js`: モーダル共通のフォーカス管理 (`createModalFocusController`)。開いたときの初期フォーカス、閉じた後のフォーカス復帰、Escape 閉鎖、Tab / Shift+Tab のフォーカストラップを提供する
- `src/ui/settings-panel.js`: 設定モーダル (`createSettingsPanel`)。開閉、言語切替、Wake Lock 切替、Bluetooth 補正、補正タップ、ボール方向/スクワッシュ切替の入力配線と active 状態同期を内包する。実際の状態更新・永続化・i18n 再適用・Wake Lock acquire/release はホストから渡された callback が担当する
- `src/ui/now-playing.js`: Now Playing バナーの表示制御 (`createNowPlaying`)。曲名/BPM の反映、表示/非表示、再生/停止アイコンと paused クラス同期、クリック時の再生トグル callback 配線を内包する
- `src/ui/beat-dots.js`: 拍ドット UI (`createBeatDots`)。拍数・拍状態からボタン群を構築し、active / idle クラスを同期する。直前と同じ拍状態なら DOM 再構築を避ける
- `src/ui/bpm-controls.js`: BPM スライダー、数値直接編集、± ボタンの DOM 配線 (`createBpmControls`)。BPM 値の正規化や再生中リフレッシュは `src/app/metronome-controller.js` の `setBPM` が担当する
- `src/ui/time-signature-controls.js`: 拍子ピッカーの分子/分母上下ボタン配線 (`createTimeSignatureControls`)。許可値範囲に沿った次値計算のみを持ち、拍状態・再生系への反映はホストの `setTimeSig` が担当する
- `src/ui/view-nav.js`: Metronome / Setlist / Library のボトムナビ切替 (`createViewNav`)。active クラス同期とビュー進入時 callback を内包する
- `src/ui/volume-layout.js`: 拍子カードの高さに合わせた音量カードの高さ・縦余白同期 (`createVolumeLayout`)。クローン挿入、リサイズ、メトロノームビュー復帰時にホストから再測定される
- `src/ui/ball.js`: ボール演出の RAF アニメータ (`createBallAnimator`)。`.ball-canvas` 群の取得・リサイズ、Web Audio パスとネイティブループパスを跨いだフェーズ計算、ボール/影/接地線の描画を内包し、`refresh` / `resize` / `start` を公開する
- `src/ui/swipe-panel.js`: 実ページ数＋両端クローンのカルーセル (`createSwipePanel`)。両端のクローン挿入、タッチ/マウスドラッグ、`transitionend` でのスロット巻き戻し、ドット連動を内包し、`onAfterClonesInserted` と `onPageEnter` フックでホスト側 (ボール初期化・ページ0復帰時のリサイズ) に通知する。クローンは sentinel として `id` を除去し、`aria-hidden` / `inert` を付ける
- `src/utils/storage.js`: `localStorage` の安全な読み書きラッパー。破損 JSON は `${key}.corrupt-backup` に退避してフォールバックを返す
- `src/utils/dom.js`: HTML エスケープなど DOM 関連の小ユーティリティ (`escHtml`)
- `src/utils/id.js`: ms 解像度＋シーケンス付きの衝突しにくい ID 生成 (`nextId`)
- `src/audio/timing.test.js`: `audio/timing.js` の純粋関数群（スウィング演算、小節内イベントの並び順、native ループ拍位置）の `node:test` ベースユニットテスト
- `src/state/beat-states.test.js`: `state/beat-states.js` の `node:test` ベースユニットテスト。複合拍子のデフォルトアクセント、不正値の正規化、状態循環をカバー
- `src/style.css`: 全画面スタイルのエントリ。`src/styles/*.css` を `@import` で順番に読み込む薄いインデックスで、`<link rel="stylesheet">` (index.html) と `import './style.css'` (main.js) の双方からこのファイルを参照する
- `src/styles/`: 用途別に分割された CSS。`base.css` (リセット・カラートークン・body) → `layout.css` (`.view` コンテナ) → `metronome-screen.css` (メトロ画面: metro-top / 拍ドット / BPM / スワイプ / メトロ下部 / Play・Tap / ボール / トグル行) → `volume.css` (Page 1 音量) → `swing.css` (Page 2 スウィング) → `ts-picker.css` (Page 3 拍子ピッカー) → `setlist-screen.css` (card-label・セットリストリスト・ドラッグハンドル・DnD・preset 行・モードセレクター) → `song-form.css` (`createSongForm` 用フォーム) → `nav.css` (ボトムナビ・設定モーダル) → `setlist-views.css` (セットリスト詳細/フル表示・Now Playing) → `paywall.css` の順で `@import` する。Vite がバンドル時にインライン化する
- `legacy/metro-beat.html`: 旧プロトタイプの単一 HTML。現行の Vite エントリではないため、基本的には `index.html` / `src/*` を正とする
- `vite.config.js`: 開発サーバー設定。現状は `X-Frame-Options: SAMEORIGIN` を付与している

## Core Flows
- メトロノーム画面では、START/STOP ボタンまたは Space キーで再生状態を切り替える
- BPM はスライダー、増減ボタン、数値直接編集、TAP TEMPO から変更できる。再生中に変更した場合も現在のテンポへ追従する
- TAP TEMPO は直近のタップ間隔から BPM を算出する。一定時間タップが空くと計測はリセットされる
- 拍子画面では分子 `2` から `12`、分母 `4` / `8` を切り替えられる。変更時はビート表示を更新し、再生中ならメトロノームをその拍子で再始動する
- BPM は拍子の分母音符のテンポとして扱う。例として `4/4 BPM120` は4分音符=120、`6/8 BPM120` は8分音符=120として再生する
- スウィング画面ではスウィング対象 (`OFF` / `8分` / `16分`) とスウィング幅 (`0.1` から `99.9`) を設定できる。スウィング幅はペア内の後ろ側ノート位置として扱い、`50.0` が 1:1、`66.7` が約 2:1、`50.0` 未満は裏拍が前に寄る逆スウィングになる。初期状態は `OFF`、幅の初期値は `66.7`。スウィング幅はスライダーと数値入力で直接編集できる。目盛りは `0` / `50` / `66.7` / `100` と表示し、それぞれ内部値 `0.1` / `50.0` / `66.7` / `99.9` へジャンプするプリセットボタンとして動作する。`OFF` 時は幅スライダー・数値入力・プリセットボタンを無効化する
- ボール画面では移動方向とスクワッシュ演出を切り替えられる。これは視覚表現だけに影響し、テンポや音価は変えない。ボール色は音声側の拍状態に追従し、強拍は赤、通常拍は紫、ミュート拍は灰色で表示する
- 設定モーダルでは Bluetooth 補正 (`0` から `500` ms、5ms刻み) を調整できる。無線アンプなどで音声が遅れて聞こえる場合に、音声スケジューリングは変更せず、ボール描画と拍点灯だけを指定ms遅らせる。値は `localStorage` に保存する。再生中に音へ合わせて3回タップすると、直近拍の音声スケジュール時刻との差分中央値から補正値を推定して設定する
- Setlist ビューではセットリストの作成・編集・削除・並び替えができる
- セットリスト詳細では曲の追加・編集・削除・並び替えができる。曲追加は直接入力とライブラリ選択の2モードを持つ
- セットリスト内の曲をタップすると、その曲の BPM を現在値へ反映して自動再生する。同じ曲を再タップした場合は再生/停止のトグルとして扱う
- Library ビューでは曲ライブラリの作成・編集・削除ができる。ソートは手動、曲名、BPM を切り替えられ、手動ソート時のみ DnD 並び替えを許可する
- ライブラリ内の曲をタップすると、その曲の BPM を現在値へ反映して自動再生する。同じ曲を再タップした場合は再生/停止のトグルとして扱う
- Now Playing バナーは、セットリストまたはライブラリから現在選択中の曲があるときだけ表示する。バナーをタップすると再生/停止を切り替える
- ブラウザがバックグラウンドに入った場合、foreground の Web Audio スケジューラを止めて background 用の `HTMLAudioElement` ループへ切り替える。復帰時は foreground 側へ戻す

## Data Model
- 永続化されるセットリストは `localStorage` の `metro-setlists` に保存する
- セットリストの構造は `[{ id, name, songs: [{ id, name, bpm, tsNum, tsDen, beatVolumes, beatStates, swingMode, swingAmount }] }]` を基本とする
- 永続化される曲ライブラリは `localStorage` の `metro-song-lib` に保存する
- 曲ライブラリの構造は `[{ id, name, bpm, tsNum, tsDen, beatVolumes, beatStates, swingMode, swingAmount }]` を基本とする
- セットリスト、曲、ライブラリ曲の ID は文字列で保持する。現行実装では `src/utils/id.js` の `nextId()`（ms 解像度＋同 ms 内のシーケンス付き）で生成している
- 現在開いているセットリスト、現在アクティブな曲、現在 BPM、再生中フラグ、ライブラリのソート状態、フォームの開閉状態、スワイプ位置、ボール演出設定はメモリ上の UI 状態であり永続化しない
- リロードや別端末では、永続化済みのセットリストとライブラリは復元されるが、現在再生中の曲や画面状態は引き継がれない

## Rules
- メトロノーム音声は 16 分音符解像度でスケジューリングする。拍子分母が `4` の場合は1カウントを16分4ステップ、分母が `8` の場合は1カウントを16分2ステップとして処理する
- スウィングはスケジューラとバックグラウンド WAV ループで同じ `src/audio/timing.js` の小節内イベント計算を使う。`8分` スウィングは8分ペア、`16分` スウィングは16分ペアの後ろ側を `swingAmount / 100` の位置へ移動する
- 拍ボタン・音・ボールは分子の各カウントに対応する。初期アクセントは通常1拍目のみ、`6/8`、`9/8`、`12/8` では複合拍子として3カウントごとに強拍にする
- Bluetooth 補正は視覚補正のみで、クリック音・バックグラウンド再生・保存曲データには影響しない。タップ推定はユーザーの反応時間や演奏環境に左右されるため、最終的な補正値は手動調整できる状態を保つ
- 音量設定の音価表示は拍子分母に追従する。`x/8` では通常拍を8分、細分を16分として表示し、16分解像度より細かい32分相当の項目は無効化する。`8分` スウィング中は16分音量 UI を 0 表示で無効化し、再生時の有効音量も 0 とする。ただし保存済みの16分音量値は破棄せず、スウィング解除時に復元する
- 背景再生は foreground の Web Audio と hidden 時の `HTMLAudioElement` ループを併用している。テンポや音量変更時は両方の再生系への影響を確認する
- 並び替えは DnD 実装に依存しており、ライブラリは `manual` ソート時のみ手動並び替えが有効
- パラメータ範囲・初期値はコード上の定数を正とする。`SPEC.md` には重複記載しない
- 機能追加時は、まず `src/app/metronome-controller.js` / `src/app/collections-controller.js` の責務を崩さないか確認する。大きく拡張する場合のみ controller 内の責務分割を検討する

## Known Issues
- `src/main.js` は 100 行台の composition root まで縮小済み。現在の大きな責務単位は `src/app/metronome-controller.js` と `src/app/collections-controller.js` に分離されている。`metronome-controller.js` 自体は依然として 900 行台で、audio runtime（scheduler / bg-playback / wake lock / visibilitychange）・volume 配線・swing 配線・visual delay calibration・settings panel wiring を抱えており、さらに `audio-runtime` / `volume-controller` / `swing-controller` / `visual-delay-calibration` 等へ分割する余地がある
- 永続ドメインモデルはストアへ集約済み（セットリスト=`src/state/setlist.js`、曲ライブラリ=`src/state/song-library.js`）。UI セレクション状態は `src/state/ui-selection.js` に集約済みで、選択変更に伴う副作用 (`setActiveRow` / `updateNowPlaying` / フォーム開閉) は `src/app/collections-controller.js` が orchestration する。再生中フラグ・AudioContext・native loop アンカー・Wake Lock センチネルなど audio runtime のミュータブル状態は `metronome-controller.js` のクロージャに残る
- 曲設定のデフォルト埋め (`tsNum` / `tsDen` / `beatStates` / `beatVolumes` / `swingMode` / `swingAmount`) は `src/state/song-config.js` の `withSongDefaults` に集約済み。setlist 曲がライブラリ曲を参照する fallback chain も `withSongDefaults(p, linkedLibSong)` 経由
- セットリスト追加フォームとライブラリ追加フォームは `src/ui/song-form.js` の `createSongForm` で共通化済み（名前・BPM・拍子・キャプチャプレビュー・保存/キャンセル/Enter ハンドリング）。外側フォーム可視制御・Pro ゲート・ストア dispatch・ライブラリ→セットリスト伝播 (`propagateLibSongChange`) は `src/app/collections-controller.js` 側が担当する
- 型チェック（`@ts-check` / JSDoc 型注釈）は未導入。`src/state/song-config.js` の `withSongDefaults` を起点に、controller / song-form の I/O 表面から段階的に型を入れる余地がある
- 自動テストは `node:test` ベースで `src/audio/timing.js` と `src/state/beat-states.js` の最小カバレッジのみ。`src/state/song-config.js` / 各ストア (`setlist.js` / `song-library.js`) のミューテーション / `src/audio/synth.js` などは未カバー
- ページドット、拍子矢印、音量入力、編集/削除アイコンなど一部の icon-only / context-only 操作には accessible name を付与済み。settings / paywall モーダルは初期フォーカス・フォーカス復帰・Escape 閉鎖・Tab フォーカストラップに対応済み。静的な `aria-label` は `data-i18n-aria-label` 経由で言語切替に追従する。主要フォーム入力には screen-reader 用 label を付与済み。包括的な a11y 監査は未対応
- データは `localStorage` のみのため、ブラウザ削除・端末変更・プライベートモードでは失われる
- `legacy/metro-beat.html` は旧プロトタイプとして残存している（現行実装との二重管理に見える点は緩和）
