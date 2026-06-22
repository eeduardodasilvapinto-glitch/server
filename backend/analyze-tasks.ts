import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-company-auth",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const AUREOON_JWT_SECRET = Deno.env.get("AUREOON_JWT_SECRET");

async function verifyCompanyToken(token: string) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: session } = await supabase.from("company_sessions")
    .select("*, company:companies(*), user:company_users(*)").eq("token", token).maybeSingle();
  return session ? { company: session.company, user: session.user } : null;
}

async function verifyMasterToken(token: string): Promise<{ user: any } | null> {
  if (!AUREOON_JWT_SECRET) return null;
  try {
    const parts = token.split("."); if (parts.length !== 3) return null;
    const [h64, p64, s64] = parts;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(AUREOON_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sigBytes = Uint8Array.from(atob(s64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(`${h64}.${p64}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(p64.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    const meta = payload.app_metadata || {};
    return { user: { id: payload.sub, name: meta.name || payload.sub, role: meta.user_role || "user" } };
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const authHeader = req.headers.get("x-company-auth") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  if (!token) return json({ error: "Não autorizado" }, 401);

  let auth = await verifyCompanyToken(token);
  if (!auth) auth = await verifyMasterToken(token);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { tasks, instructions } = await req.json();

  if (!tasks || !tasks.length) return json({ error: "tasks é obrigatório" }, 400);

  let apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
  let model = "openai/gpt-4o-mini";
  const { data: settings } = await supabase.from("settings").select("key, value");
  if (settings) {
    settings.forEach((s: any) => { if (s.key === "openrouter_api_key" && s.value) apiKey = s.value; if (s.key === "openrouter_model" && s.value) model = s.value; });
  }
  if (!apiKey) return json({ error: "API da IA não configurada" }, 502);

  const taskList = tasks.map((t: any) => `- [${t.sector}] ${t.label} (score: ${t.score || 50})`).join("\n");
  const prompt = `Analise estas tarefas e retorne um JSON com recomendações:\n${taskList}\n\n${instructions || "Sugira prioridades, prazos e scores."}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://aureoon.app" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: "Você é um analista de produtividade. Retorne APENAS JSON válido." }, { role: "user", content: prompt }], temperature: 0.3, max_tokens: 2000 }),
  });

  if (!response.ok) return json({ error: "Erro na API de IA" }, 502);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";
  return json({ text });
});
