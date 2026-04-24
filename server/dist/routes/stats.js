/**
 * 统计仪表盘路由
 * GET /api/stats  —— 聚合用户的文档、会话、消息、向量块统计数据
 */
import { Router } from "express";
import { supabase } from "../lib/supabase.js";
const router = Router();
router.get("/stats", async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: "未登录" });
    if (!supabase)
        return res.status(500).json({ error: "Supabase 未配置" });
    try {
        // 并行获取所有原始数据
        const [docsResult, convsResult, msgsResult, chunksResult] = await Promise.all([
            supabase
                .from("documents")
                .select("id, name, type, size, status, created_at")
                .eq("user_id", userId),
            supabase
                .from("conversations")
                .select("id, created_at, updated_at")
                .eq("user_id", userId),
            supabase
                .from("messages")
                .select("id, role, created_at, conversation_id")
                .eq("user_id", userId),
            supabase
                .from("chunks")
                .select("id, document_id, vector_type, created_at")
                .eq("user_id", userId)
                .eq("vector_type", "enriched_main"),
        ]);
        const docs = docsResult.data ?? [];
        const convs = convsResult.data ?? [];
        const msgs = msgsResult.data ?? [];
        const chunks = chunksResult.data ?? [];
        // ── 文档统计 ──────────────────────────────────────────────
        const docsByType = docs.reduce((acc, d) => {
            const t = d.type || "unknown";
            acc[t] = (acc[t] ?? 0) + 1;
            return acc;
        }, {});
        const docsByStatus = docs.reduce((acc, d) => {
            const s = d.status || "unknown";
            acc[s] = (acc[s] ?? 0) + 1;
            return acc;
        }, {});
        const totalStorageBytes = docs.reduce((sum, d) => sum + (d.size ?? 0), 0);
        // 文档最近 30 天上传趋势（按日聚合）
        const docsByDay = buildDailyTrend(docs, 30, (d) => d.created_at);
        // ── 会话统计 ──────────────────────────────────────────────
        const convsByDay = buildDailyTrend(convs, 30, (c) => c.created_at);
        // 每个会话的消息数分布
        const msgsPerConv = {};
        for (const m of msgs) {
            const cid = m.conversation_id;
            msgsPerConv[cid] = (msgsPerConv[cid] ?? 0) + 1;
        }
        const msgCountBuckets = buildBuckets(Object.values(msgsPerConv), [1, 5, 10, 20, 50]);
        // ── 消息统计 ──────────────────────────────────────────────
        const msgsByRole = msgs.reduce((acc, m) => {
            const r = m.role || "unknown";
            acc[r] = (acc[r] ?? 0) + 1;
            return acc;
        }, {});
        const msgsByDay = buildDailyTrend(msgs, 30, (m) => m.created_at);
        // ── 向量块统计 ────────────────────────────────────────────
        const chunksByDoc = {};
        for (const c of chunks) {
            const did = c.document_id;
            chunksByDoc[did] = (chunksByDoc[did] ?? 0) + 1;
        }
        // 取切片数 Top 10 文档（关联文档名称）
        const docNameMap = docs.reduce((acc, d) => {
            acc[d.id] = d.name;
            return acc;
        }, {});
        const topChunkDocs = Object.entries(chunksByDoc)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([docId, count]) => ({ docId, name: docNameMap[docId] ?? docId.slice(0, 8), count }));
        // ── 最近活跃 7 天热力图（消息数） ────────────────────────
        const activityHeatmap = buildDailyTrend(msgs, 60, (m) => m.created_at);
        res.json({
            overview: {
                totalDocuments: docs.length,
                totalConversations: convs.length,
                totalMessages: msgs.length,
                totalChunks: chunks.length,
                totalStorageBytes,
                vectorizedDocuments: docs.filter((d) => d.status === "completed").length,
            },
            documents: {
                byType: docsByType,
                byStatus: docsByStatus,
                dailyUploads: docsByDay,
            },
            conversations: {
                dailyCreated: convsByDay,
                msgCountDistribution: msgCountBuckets,
            },
            messages: {
                byRole: msgsByRole,
                dailySent: msgsByDay,
            },
            chunks: {
                topDocuments: topChunkDocs,
                total: chunks.length,
            },
            activity: {
                heatmap: activityHeatmap,
            },
        });
    }
    catch (e) {
        console.error("[stats] error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "统计失败" });
    }
});
export default router;
// ─── 工具函数 ─────────────────────────────────────────────────────────
/**
 * 将数据按最近 N 天分组聚合，返回 [{date: "YYYY-MM-DD", count: number}]
 */
function buildDailyTrend(items, days, getDate) {
    const now = new Date();
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        result.push({ date: d.toISOString().slice(0, 10), count: 0 });
    }
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    for (const item of items) {
        const dateStr = getDate(item)?.slice(0, 10);
        if (!dateStr)
            continue;
        const itemDate = new Date(dateStr);
        if (itemDate <= cutoff)
            continue;
        const entry = result.find((r) => r.date === dateStr);
        if (entry)
            entry.count += 1;
    }
    return result;
}
/**
 * 将数值数组按桶分组，如 [1, 5, 10, 20, 50] 对应标签 "1", "2-5", "6-10", "11-20", "21-50", "50+"
 */
function buildBuckets(values, thresholds) {
    const buckets = [];
    const sorted = [...thresholds].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
        const low = i === 0 ? 1 : sorted[i - 1] + 1;
        const high = sorted[i];
        buckets.push({ label: low === high ? `${low}` : `${low}-${high}`, count: 0 });
    }
    buckets.push({ label: `${sorted[sorted.length - 1] + 1}+`, count: 0 });
    for (const v of values) {
        let placed = false;
        for (let i = 0; i < sorted.length; i++) {
            const low = i === 0 ? 1 : sorted[i - 1] + 1;
            const high = sorted[i];
            if (v >= low && v <= high) {
                buckets[i].count += 1;
                placed = true;
                break;
            }
        }
        if (!placed)
            buckets[buckets.length - 1].count += 1;
    }
    return buckets;
}
