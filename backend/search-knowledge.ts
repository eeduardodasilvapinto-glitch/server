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

async function verifyMasterToken(token: string): Promise<{ user: any } | null> {
  if (!AUREOON_JWT_SECRET) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(AUREOON_JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sigInput = `${headerB64}.${payloadB64}`;
    const sigBytes = Uint8Array.from(
      atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(sigInput));
    if (!valid) return null;
    const payloadText = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadText);
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    const meta = payload.app_metadata || {};
    return { user: { id: payload.sub, name: meta.name || payload.sub, role: meta.user_role || "user" } };
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const authHeader = req.headers.get("x-company-auth") || req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Não autorizado" }, 401);
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  let auth = await verifyCompanyToken(token);
  if (!auth) auth = await verifyMasterToken(token);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { query, sector } = await req.json();
  if (!query) return json({ error: "query é obrigatório" }, 400);

  let q = supabase.from("documents").select("id,title,content_text,sector,min_role,file_path,file_name,created_at");

  if (query.trim()) {
    q = q.ilike("title", `%${query}%`);
  }
  if (sector) {
    q = q.eq("sector", sector);
  }

  const { data, error } = await q.limit(20);
  if (error) return json({ error: error.message }, 500);
  return json(data || []);
});
