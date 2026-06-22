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

async function verifyMasterToken(token: string): Promise<{ user: { id: string; name: string; role: string; sectors: string[] } } | null> {
  if (!AUREOON_JWT_SECRET) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(AUREOON_JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigInput = `${headerB64}.${payloadB64}`;
    const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(sigInput));
    if (!valid) return null;

    const payloadText = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadText);
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    const meta = payload.app_metadata || {};
    return {
      user: {
        id: payload.sub,
        name: meta.name || payload.sub,
        role: meta.user_role || "user",
        sectors: meta.sectors || [],
      },
    };
  } catch {
    return null;
  }
}

function isAdmin(auth: { user: { role: string } }) {
  return auth.user.role === "admin";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const authHeader = req.headers.get("x-company-auth") || req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Não autorizado" }, 401);
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  // Try company token first, then master JWT
  let auth = await verifyCompanyToken(token);
  if (!auth) {
    auth = await verifyMasterToken(token);
  }
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { action, data } = await req.json();

  try {
    switch (action) {
      case "list": {
        const { data: leads, error } = await supabase
          .from("leads")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);

        const { data: assigns, error: assignErr } = await supabase
          .from("roleta_assigns")
          .select("*");
        const assignsMap: Record<number, string> = {};
        if (!assignErr && assigns) {
          assigns.forEach((a: any) => { assignsMap[a.lead_id] = a.user_id; });
        }

        const enriched = (leads || []).map((l: any) => ({
          ...l,
          assigned_to: assignsMap[l.id] || null,
        }));

        return json(enriched);
      }

      case "create": {
        const { data: lead, error } = await supabase
          .from("leads")
          .insert(data)
          .select("id")
          .single();
        if (error) return json({ error: error.message }, 500);
        return json(lead, 201);
      }

      case "update": {
        const { error } = await supabase
          .from("leads")
          .update(data)
          .eq("id", data.id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "delete": {
        const { error } = await supabase
          .from("leads")
          .delete()
          .eq("id", data.id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "settings_get": {
        const { data: rows, error } = await supabase
          .from("settings")
          .select("*");
        if (error) return json({ error: error.message }, 500);
        const map: Record<string, string> = {};
        (rows || []).forEach((r: any) => { map[r.key] = r.value; });
        return json(map);
      }

      case "settings_save": {
        if (!data) return json({ error: "data é obrigatório" }, 400);
        const settings = data;
        for (const key of Object.keys(settings)) {
          const { error } = await supabase
            .from("settings")
            .upsert({ key, value: settings[key] }, { onConflict: "key" });
          if (error) return json({ error: error.message }, 500);
        }
        return json({ success: true });
      }

      case "roleta_config_get": {
        const { data: row, error } = await supabase
          .from("roleta_config")
          .select("config")
          .eq("id", 1)
          .single();
        if (error) return json({ error: error.message }, 500);
        return json(row.config);
      }

      case "roleta_config_set": {
        const config = data.config;
        if (!config) return json({ error: "config é obrigatório" }, 400);
        const { error } = await supabase
          .from("roleta_config")
          .update({ config: config })
          .eq("id", 1);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "roleta_assigns_get": {
        const { data: assigns, error } = await supabase
          .from("roleta_assigns")
          .select("*");
        if (error) return json({ error: error.message }, 500);
        const map: Record<number, string> = {};
        (assigns || []).forEach((a: any) => { map[a.lead_id] = a.user_id; });
        return json(map);
      }

      default:
        return json({ error: "Ação inválida" }, 400);
    }
  } catch (err) {
    return json({ error: err.message || "Erro interno" }, 500);
  }
});
