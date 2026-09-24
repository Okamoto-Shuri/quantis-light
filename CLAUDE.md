# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 現状

アプリケーションコードはまだ存在しない。このリポジトリには、短いプロンプトからアプリを段階的に構築する3エージェント開発ハーネスの設定だけがある。技術スタック・ビルド/テストコマンドはジェネレーターが Sprint 1 で決定する。決まったら、このファイルにコマンドとアーキテクチャを追記すること。

## 開発ハーネス（planner → generator → evaluator）

起動: `/harness <1〜4行のプロンプト>`（`.claude/skills/harness/SKILL.md`）。メインセッションはオーケストレーターに徹し、自分では実装もテストもしない。

- `planner`（`.claude/agents/planner.md`）: プロンプトを `docs/harness/spec.md` に展開する。「何を作るか」だけを書き、実装の詳細（DB スキーマ、ライブラリ、API 設計）は書かない。受け入れ基準は、ブラウザ操作で合否を判定できる形にする。
- `generator`（`.claude/agents/generator.md`）: 1スプリントで1機能を実装する。モードは契約・実装・修正の3つ。スタブやダミーデータで動いているように見せることは禁止。git リポジトリであれば、スプリントごとに `sprint-NN: <機能名>` でコミットする。
- `evaluator`（`.claude/agents/evaluator.md`）: Playwright MCP（`.mcp.json`）で実際に操作し、画面・API・データベースの3段階で検証する。ソースコードは編集しない（Edit 禁止）。

サブエージェント同士は直接会話できない。受け渡しはすべて次のファイルで行う。

```
docs/harness/spec.md
docs/harness/sprints/sprint-NN/{contract.md, contract-review.md, self-review.md, evaluation-R.md}
```

合否判定: 機能性 ≥8、仕様充足度 ≥7、デザイン ≥6、コード品質 ≥6。1つでも閾値を下回るか、契約の完了条件が1つでも未達、または起動失敗・リグレッションがあれば不合格。同じスプリントで5ラウンド不合格になったら、ループを止めてユーザーに判断を仰ぐ。
