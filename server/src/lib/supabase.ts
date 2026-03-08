/**
 * Supabase 客户端（服务端，使用 service_role  bypass RLS）
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  console.warn("SUPABASE_URL / SUPABASE_SERVICE_KEY 未配置，数据库功能不可用");
}

export const supabase = url && serviceKey ? createClient(url, serviceKey) : null;
