import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v2.8/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-company-auth",
};

interface AnalyzeBody {
  prompt: string;
  context?: string;
  apiKey?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function verifyCompanyToken(token: string) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data: session } = await supabase
    .from("company_sessions")
    .select("*, company:companies(*), user:company_users(*)")
    .eq("token", token)
    .maybeSingle();
  if (!session) return null;
  return { company: session.company, user: session.user };
}

async function verifyMasterToken(token: string) {
  const jwtSecret = Deno.env.get("AUREOON_JWT_SECRET");
  if (!jwtSecret) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    await verify(token, key);
    const parts = token.split(".");
    const payloadText = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadText);
    const meta = payload.app_metadata || {};
    return {
      user: { id: payload.sub, name: meta.name || payload.sub, role: meta.user_role || "user" },
    };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

    const auth = req.headers.get("Authorization") || req.headers.get("x-company-auth");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : auth;
    if (!token) return json({ error: "Não autorizado" }, 401);

    // Try company token first, then master JWT
    let authUser = await verifyCompanyToken(token);
    if (!authUser) {
      authUser = await verifyMasterToken(token);
    }
    if (!authUser) {
      return json({ error: "Token inválido" }, 401);
    }

    const body: AnalyzeBody = await req.json();
    const { prompt, context } = body;
    if (!prompt) return json({ error: "Campo prompt é obrigatório" }, 400);

    let apiKey = body.apiKey || "";
    let model = "openai/gpt-4o-mini";

    if (!apiKey) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { data: settings } = await supabaseAdmin
        .from("settings")
        .select("key, value");

      if (settings) {
        const map: Record<string, string> = {};
        settings.forEach((s: { key: string; value: string }) => map[s.key] = s.value);
        apiKey = map.openrouter_api_key || Deno.env.get("OPENROUTER_API_KEY") || "";
        model = map.openrouter_model || "openai/gpt-4o-mini";
      } else {
        apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
      }
    }

    if (!apiKey) return json({ error: "API da IA não configurada" }, 502);

    const startTime = Date.now();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://aureoon.app",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "Você é um analista da agência Aureoon. Responda em português de forma objetiva.",
          },
          { role: "user", content: context ? `${context}\n\n${prompt}` : prompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`OpenRouter error (${response.status}): ${errBody.slice(0, 200)}`);
      return json({ error: "Erro na API de IA" }, 502);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    console.log(`IA: ${model} ${duration}ms`);

    return json({ text });
  } catch (err) {
    console.error("Analyze error:", err.message);
    return json({ error: "Erro interno" }, 500);
  }
});
