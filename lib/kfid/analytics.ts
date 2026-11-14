export type DailyCount = { date: string; count: number };
export function timeSeries(
  rows: DailyCount[],
  from: string,
  to: string,
  bucket: "day" | "week" | "month",
  monthlyTarget: number,
) {
  const values = new Map<
    string,
    { date: string; count: number; target: number }
  >();
  const counts = new Map(rows.map((r) => [r.date, r.count]));
  const cursor = new Date(`${from}T00:00:00Z`),
    end = new Date(`${to}T00:00:00Z`);
  let days = 0;
  while (cursor <= end && days++ < 1830) {
    const day = cursor.toISOString().slice(0, 10);
    const keyDate = new Date(cursor);
    if (bucket === "week")
      keyDate.setUTCDate(
        keyDate.getUTCDate() - ((keyDate.getUTCDay() + 6) % 7),
      );
    const key =
      bucket === "month"
        ? day.slice(0, 7)
        : bucket === "week"
          ? keyDate.toISOString().slice(0, 10)
          : day;
    const row = values.get(key) || { date: key, count: 0, target: 0 };
    row.count += counts.get(day) || 0;
    row.target +=
      monthlyTarget /
      new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
      ).getUTCDate();
    values.set(key, row);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  let cumulative = 0,
    cumulativeTarget = 0;
  return [...values.values()].map((row) => {
    cumulative += row.count;
    cumulativeTarget += row.target;
    return {
      ...row,
      target: Math.round(row.target * 10) / 10,
      cumulative,
      cumulativeTarget: Math.round(cumulativeTarget * 10) / 10,
    };
  });
}
