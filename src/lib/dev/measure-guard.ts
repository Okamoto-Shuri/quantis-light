/**
 * React 19.2 の開発用パフォーマンス計測（Server Components のトラック）の不具合への対策。開発時だけ使う。
 *
 * React はサーバーコンポーネントの時刻を「サーバーの timeOrigin − ブラウザの timeOrigin」で換算する。
 * エラーになったコンポーネント（notFound()／redirect() を投げたもの）の記録では、開始時刻は 0 未満を 0 に丸めるが、
 * 終了時刻は丸めない。サーバーの時計がブラウザより遅れていると（dev サーバーを長く動かすと起きる）終了時刻が負になり、
 * performance.measure が TypeError を投げる（"'<名前>' cannot have a negative time stamp"。Sprint 2 評価の B1）。
 * ここでは、React が開始時刻に対して行っているのと同じ丸めを、終了時刻にも行う。計測の記録以外に影響は無い。
 */
const GUARD = Symbol.for("quantis.measureGuard");

type GuardedPerformance = Performance & { [GUARD]?: true };

export function installNegativeMeasureGuard(perf: Performance): void {
  const target = perf as GuardedPerformance;
  if (target[GUARD]) return;
  const original = target.measure.bind(target);

  target.measure = ((name: string, startOrOptions?: string | PerformanceMeasureOptions, endMark?: string) => {
    if (startOrOptions && typeof startOrOptions === "object") {
      const options = { ...startOrOptions };
      if (typeof options.start === "number" && options.start < 0) options.start = 0;
      if (typeof options.end === "number" && options.end < 0) options.end = 0;
      return original(name, options);
    }
    return original(name, startOrOptions, endMark);
  }) as Performance["measure"];
  target[GUARD] = true;
}
