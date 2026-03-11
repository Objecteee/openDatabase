/**
 * 仪表盘页面 - 用户资源库统计
 * 使用原生 ECharts + useChart hook，不依赖 echarts-for-react
 */

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import * as echarts from "echarts";
import { useTranslation } from "react-i18next";
import { api } from "../lib/apiClient.js";
import { useThemeStore } from "../stores/themeStore.js";
import styles from "./DashboardPage.module.scss";

// ─── 类型定义 ─────────────────────────────────────────────────────────

interface DailyPoint { date: string; count: number }
interface BucketPoint { label: string; count: number }
interface TopDocItem { docId: string; name: string; count: number }

interface StatsData {
  overview: {
    totalDocuments: number;
    totalConversations: number;
    totalMessages: number;
    totalChunks: number;
    totalStorageBytes: number;
    vectorizedDocuments: number;
  };
  documents: {
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    dailyUploads: DailyPoint[];
  };
  conversations: {
    dailyCreated: DailyPoint[];
    msgCountDistribution: BucketPoint[];
  };
  messages: {
    byRole: Record<string, number>;
    dailySent: DailyPoint[];
  };
  chunks: {
    topDocuments: TopDocItem[];
    total: number;
  };
  activity: {
    heatmap: DailyPoint[];
  };
}

// ─── ECharts Hook ─────────────────────────────────────────────────────

function useChart(option: echarts.EChartsOption | null, isDark: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, isDark ? "dark" : undefined, { renderer: "svg" });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  useEffect(() => {
    if (option && chartRef.current) {
      chartRef.current.setOption(option, true);
    }
  }, [option]);

  return ref;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ─── 图表子组件 ───────────────────────────────────────────────────────

function Chart({ option, height, isDark }: { option: echarts.EChartsOption | null; height: number; isDark: boolean }) {
  const ref = useChart(option, isDark);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

// ─── 统计卡片子组件 ───────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────

export function DashboardPage() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";

  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/stats");
      setData(res.data as StatsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("dashboard.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ECharts 公共主题色
  const c = useMemo(() => ({
    grid: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    axisLine: isDark ? "#4b5563" : "#d1d5db",
    axisLabel: isDark ? "#9ca3af" : "#6b7280",
    tooltip: {
      bg: isDark ? "#1f2937" : "#ffffff",
      border: isDark ? "#374151" : "#e5e7eb",
      text: isDark ? "#f3f4f6" : "#111827",
    },
    palette: isDark
      ? ["#6366f1", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb923c", "#e879f9"]
      : ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#ea580c", "#c026d3"],
  }), [isDark]);

  const tooltipBase = useMemo(() => ({
    backgroundColor: c.tooltip.bg,
    borderColor: c.tooltip.border,
    textStyle: { color: c.tooltip.text, fontSize: 12 },
  }), [c]);

  const axisBase = useMemo(() => ({
    axisLine: { lineStyle: { color: c.axisLine } },
    splitLine: { lineStyle: { color: c.grid } },
    axisLabel: { color: c.axisLabel, fontSize: 11 },
  }), [c]);

  // ── 所有图表 option（依赖 data + theme） ─────────────────────────
  const options = useMemo(() => {
    if (!data) return null;

    const statusLabelMap: Record<string, string> = {
      completed: t("dashboard.docStatus.completed"),
      processing: t("dashboard.docStatus.processing"),
      pending: t("dashboard.docStatus.pending"),
      failed: t("dashboard.docStatus.failed"),
    };
    const statusColorMap: Record<string, string> = {
      completed: "#34d399", processing: "#fbbf24", pending: "#60a5fa", failed: "#f87171",
    };

    const pieBase = {
      tooltip: { trigger: "item" as const, ...tooltipBase, formatter: "{b}: {c} ({d}%)" },
      legend: { bottom: 0, textStyle: { color: c.axisLabel, fontSize: 11 } },
    };

    const docType: echarts.EChartsOption = {
      ...pieBase,
      color: c.palette,
      series: [{
        type: "pie", radius: ["40%", "68%"], center: ["50%", "42%"],
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 13, fontWeight: "bold" } },
        data: Object.entries(data.documents.byType).map(([name, value]) => ({ name, value })),
      }],
    };

    const docStatus: echarts.EChartsOption = {
      ...pieBase,
      series: [{
        type: "pie", radius: ["40%", "68%"], center: ["50%", "42%"],
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 13, fontWeight: "bold" } },
        data: Object.entries(data.documents.byStatus).map(([s, v]) => ({
          name: statusLabelMap[s] ?? s, value: v,
          itemStyle: { color: statusColorMap[s] },
        })),
      }],
    };

    const uploadTrend: echarts.EChartsOption = {
      tooltip: { trigger: "axis" as const, ...tooltipBase },
      grid: { left: 40, right: 16, top: 16, bottom: 40 },
      xAxis: { type: "category" as const, data: data.documents.dailyUploads.map((d) => d.date.slice(5)), ...axisBase },
      yAxis: { type: "value" as const, name: t("dashboard.uploadTrend.yAxis"), nameTextStyle: { color: c.axisLabel, fontSize: 11 }, minInterval: 1, ...axisBase },
      color: [c.palette[0]],
      series: [{ type: "line", smooth: true, symbol: "none", areaStyle: { opacity: 0.15 }, data: data.documents.dailyUploads.map((d) => d.count) }],
    };

    const msgTrend: echarts.EChartsOption = {
      tooltip: { trigger: "axis" as const, ...tooltipBase },
      grid: { left: 40, right: 16, top: 16, bottom: 40 },
      xAxis: { type: "category" as const, data: data.messages.dailySent.map((d) => d.date.slice(5)), ...axisBase },
      yAxis: { type: "value" as const, minInterval: 1, ...axisBase },
      color: [c.palette[0]],
      series: [{ type: "line", smooth: true, symbol: "none", areaStyle: { opacity: 0.1 }, data: data.messages.dailySent.map((d) => d.count) }],
    };

    const convTrend: echarts.EChartsOption = {
      tooltip: { trigger: "axis" as const, ...tooltipBase },
      grid: { left: 40, right: 16, top: 16, bottom: 40 },
      xAxis: { type: "category" as const, data: data.conversations.dailyCreated.map((d) => d.date.slice(5)), ...axisBase },
      yAxis: { type: "value" as const, minInterval: 1, ...axisBase },
      color: [c.palette[1]],
      series: [{ type: "bar", barMaxWidth: 20, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: data.conversations.dailyCreated.map((d) => d.count) }],
    };

    const msgDist: echarts.EChartsOption = {
      tooltip: { trigger: "axis" as const, ...tooltipBase },
      grid: { left: 48, right: 16, top: 16, bottom: 48 },
      xAxis: { type: "category" as const, data: data.conversations.msgCountDistribution.map((b) => b.label), name: t("dashboard.msgDistribution.xAxis"), nameLocation: "middle" as const, nameGap: 28, nameTextStyle: { color: c.axisLabel, fontSize: 11 }, ...axisBase },
      yAxis: { type: "value" as const, name: t("dashboard.msgDistribution.yAxis"), nameTextStyle: { color: c.axisLabel, fontSize: 11 }, minInterval: 1, ...axisBase },
      color: [c.palette[4]],
      series: [{ type: "bar", barMaxWidth: 32, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: data.conversations.msgCountDistribution.map((b) => b.count) }],
    };

    const topChunks: echarts.EChartsOption = {
      tooltip: { trigger: "axis" as const, ...tooltipBase },
      grid: { left: 10, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value" as const, name: t("dashboard.topChunks.xAxis"), nameTextStyle: { color: c.axisLabel, fontSize: 11 }, minInterval: 1, ...axisBase },
      yAxis: {
        type: "category" as const,
        data: [...data.chunks.topDocuments].reverse().map((d) => d.name.length > 14 ? d.name.slice(0, 13) + "…" : d.name),
        axisLine: { lineStyle: { color: c.axisLine } },
        axisLabel: { color: c.axisLabel, fontSize: 11 },
      },
      color: [c.palette[5]],
      series: [{
        type: "bar", barMaxWidth: 20, itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right" as const, color: c.axisLabel, fontSize: 11 },
        data: [...data.chunks.topDocuments].reverse().map((d) => d.count),
      }],
    };

    const heatmapDates = data.activity.heatmap.map((h) => h.date);
    const maxActivity = Math.max(...data.activity.heatmap.map((h) => h.count), 1);
    const heatmap: echarts.EChartsOption = {
      tooltip: {
        ...tooltipBase,
        formatter: (p: unknown) => {
          const params = p as { data: [string, number] };
          return `${params.data[0]}<br/>${t("dashboard.activity.tooltip")}: ${params.data[1]}`;
        },
      },
      visualMap: {
        min: 0, max: maxActivity, show: false,
        inRange: { color: isDark ? ["#1f2937", "#6366f1"] : ["#f3f4f6", "#4f46e5"] },
      },
      calendar: {
        top: 24, left: 30, right: 10, bottom: 0,
        range: [heatmapDates[0], heatmapDates[heatmapDates.length - 1]],
        itemStyle: { borderColor: isDark ? "#374151" : "#e5e7eb", color: isDark ? "#1f2937" : "#f9fafb" },
        splitLine: { show: false },
        dayLabel: { color: c.axisLabel, fontSize: 10 },
        monthLabel: { color: c.axisLabel, fontSize: 10 },
        yearLabel: { show: false },
      },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data: data.activity.heatmap.map((h) => [h.date, h.count]) }],
    };

    return { docType, docStatus, uploadTrend, msgTrend, convTrend, msgDist, topChunks, heatmap };
  }, [data, isDark, c, axisBase, tooltipBase, t]);

  if (loading) {
    return <div className={styles.page}><div className={styles.center}>{t("dashboard.loading")}</div></div>;
  }

  if (error || !data || !options) {
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <span>{error ?? t("dashboard.error")}</span>
          <button className={styles.retryBtn} onClick={fetchStats}>{t("dashboard.retry")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>{t("dashboard.title")}</h1>

      {/* 总览指标卡 */}
      <div className={styles.overviewGrid}>
        <StatCard label={t("dashboard.overview.totalDocuments")} value={data.overview.totalDocuments} sub={`${data.overview.vectorizedDocuments} ${t("dashboard.overview.vectorized")}`} />
        <StatCard label={t("dashboard.overview.totalConversations")} value={data.overview.totalConversations} />
        <StatCard label={t("dashboard.overview.totalMessages")} value={data.overview.totalMessages} />
        <StatCard label={t("dashboard.overview.totalChunks")} value={data.overview.totalChunks} />
        <StatCard label={t("dashboard.overview.storage")} value={formatBytes(data.overview.totalStorageBytes)} />
      </div>

      {/* 文档统计行 */}
      <div className={styles.chartGrid}>
        <div className={styles.chartCard}>
          <div className={styles.sectionTitle}>{t("dashboard.docType.title")}</div>
          <Chart option={options.docType} height={220} isDark={isDark} />
        </div>
        <div className={styles.chartCard}>
          <div className={styles.sectionTitle}>{t("dashboard.docStatus.title")}</div>
          <Chart option={options.docStatus} height={220} isDark={isDark} />
        </div>
        <div className={styles.chartCardFull}>
          <div className={styles.sectionTitle}>{t("dashboard.uploadTrend.title")}</div>
          <Chart option={options.uploadTrend} height={180} isDark={isDark} />
        </div>
      </div>

      {/* 消息和会话统计行 */}
      <div className={styles.chartGrid}>
        <div className={styles.chartCard}>
          <div className={styles.sectionTitle}>{t("dashboard.msgTrend.title")}</div>
          <Chart option={options.msgTrend} height={200} isDark={isDark} />
        </div>
        <div className={styles.chartCard}>
          <div className={styles.sectionTitle}>{t("dashboard.convTrend.title")}</div>
          <Chart option={options.convTrend} height={200} isDark={isDark} />
        </div>
        <div className={styles.chartCard}>
          <div className={styles.sectionTitle}>{t("dashboard.msgDistribution.title")}</div>
          <Chart option={options.msgDist} height={200} isDark={isDark} />
        </div>
        <div className={styles.chartCard}>
          <div className={styles.sectionTitle}>{t("dashboard.topChunks.title")}</div>
          <Chart option={options.topChunks} height={200} isDark={isDark} />
        </div>
      </div>

      {/* 活跃度热力图 */}
      <div className={styles.chartCardFull}>
        <div className={styles.sectionTitle}>{t("dashboard.activity.title")}</div>
        <Chart option={options.heatmap} height={130} isDark={isDark} />
      </div>
    </div>
  );
}
