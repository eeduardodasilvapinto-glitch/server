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
    return { user: { id: payload.sub, name: meta.name || payload.sub, role: meta.user_role || "user", sectors: meta.sectors || [] } };
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
  if (!auth.company) return json({ error: "Apenas administradores de empresa" }, 403);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { action, data } = await req.json();
  const companyId = auth.company.id;

  try {
    switch (action) {
      case "list": {
        const { data: users, error } = await supabase
          .from("company_users")
          .select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json(users || []);
      }

      case "create": {
        if (!data.name || !data.password) return json({ error: "Nome e senha são obrigatórios" }, 400);
        const hashed = await hashPassword(data.password);
        const { data: user, error } = await supabase
          .from("company_users")
          .insert({
            company_id: companyId,
            name: data.name,
            password: hashed,
            role: data.role || "user",
            active: data.active !== false,
          })
          .select()
          .single();
        if (error) {
          if (error.code === "23505") return json({ error: "Usuário já existe nesta empresa" }, 409);
          return json({ error: error.message }, 500);
        }
        return json({ id: user.id, name: user.name, role: user.role, active: user.active });
      }

      case "update": {
        const { id, ...updates } = data;
        if (!id) return json({ error: "ID do usuário é obrigatório" }, 400);
        const payload: Record<string, any> = {};
        if (updates.role !== undefined) payload.role = updates.role;
        if (updates.sectors !== undefined) payload.sectors = updates.sectors;
        if (updates.active !== undefined) payload.active = updates.active;
        if (updates.password) payload.password = await hashPassword(updates.password);

        const { error } = await supabase
          .from("company_users")
          .update(payload)
          .eq("id", id)
          .eq("company_id", companyId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "delete": {
        const { id } = data;
        if (!id) return json({ error: "ID do usuário é obrigatório" }, 400);
        const { error } = await supabase
          .from("company_users")
          .delete()
          .eq("id", id)
          .eq("company_id", companyId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "update-password": {
        const { id, password } = data;
        if (!id || !password) return json({ error: "ID e senha são obrigatórios" }, 400);
        const hashed = await hashPassword(password);
        const { error } = await supabase
          .from("company_users")
          .update({ password: hashed })
          .eq("id", id)
          .eq("company_id", companyId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "set-password": {
        const { id, password } = data;
        if (!id || !password) return json({ error: "ID e senha são obrigatórios" }, 400);
        const hashed = await hashPassword(password);
        const { error } = await supabase
          .from("company_users")
          .update({ password: hashed })
          .eq("id", id)
          .eq("company_id", companyId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      default:
        return json({ error: "Ação desconhecida" }, 400);
    }
  } catch (err) {
    return json({ error: err.message || "Erro interno" }, 500);
  }
});

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
