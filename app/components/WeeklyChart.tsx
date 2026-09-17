type WeeklyCount = { week_start: string; count: number };

export function WeeklyChart({ data }: { data: WeeklyCount[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const width = 240;
  const height = 56;
  const barGap = 4;
  const barWidth = (width - barGap * (data.length - 1)) / data.length;

  return (
    <svg width={width} height={height} className="block">
      {data.map((d, i) => {
        const barHeight = Math.max(2, (d.count / max) * (height - 14));
        const x = i * (barWidth + barGap);
        const y = height - barHeight - 14;
        return (
          <g key={d.week_start}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={2}
              className="fill-slate-700"
            />
            <text
              x={x + barWidth / 2}
              y={height - 2}
              textAnchor="middle"
              className="fill-slate-400"
              fontSize="8"
            >
              {d.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
