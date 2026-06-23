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

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { action, data } = await req.json();

  try {
    switch (action) {
      case "register": {
        const { companyName, adminName, password } = data;
        if (!companyName || !adminName || !password) {
          return json({ error: "Campos obrigatórios: companyName, adminName, password" }, 400);
        }

        const { data: existing } = await supabase
          .from("companies")
          .select("id")
          .eq("name", companyName)
          .maybeSingle();
        if (existing) {
          return json({ error: "Empresa já existe" }, 409);
        }

        const { data: company, error: compErr } = await supabase
          .from("companies")
          .insert({ name: companyName, permissions: {}, active: true })
          .select()
          .single();
        if (compErr) return json({ error: compErr.message }, 500);

        const hashedPw = await hashPassword(password);
        const { data: user, error: userErr } = await supabase
          .from("company_users")
          .insert({
            company_id: company.id,
            name: adminName,
            password: hashedPw,
            role: "admin",
            active: true,
          })
          .select()
          .single();
        if (userErr) {
          await supabase.from("companies").delete().eq("id", company.id);
          return json({ error: userErr.message }, 500);
        }

        return json({ ok: true, company, user });
      }

      case "login": {
        const { companyName, adminName, password } = data;
        if (!companyName || !adminName || !password) {
          return json({ error: "Campos obrigatórios: companyName, adminName, password" }, 400);
        }

        const { data: company } = await supabase
          .from("companies")
          .select("*")
          .eq("name", companyName)
          .eq("active", true)
          .maybeSingle();
        if (!company) return json({ error: "Empresa não encontrada" }, 401);

        const { data: user } = await supabase
          .from("company_users")
          .select("*")
          .eq("company_id", company.id)
          .eq("name", adminName)
          .eq("active", true)
          .maybeSingle();
        if (!user) return json({ error: "Usuário não encontrado" }, 401);

        const hashedInput = await hashPassword(password);
        if (user.password !== hashedInput) {
          return json({ error: "Senha inválida" }, 401);
        }

        const token = generateToken();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const { error: sessErr } = await supabase
          .from("company_sessions")
          .insert({
            company_id: company.id,
            user_id: user.id,
            token,
            expires_at: expiresAt,
          });
        if (sessErr) return json({ error: sessErr.message }, 500);

        return json({
          token,
          company: {
            id: company.id,
            name: company.name,
            permissions: company.permissions,
          },
          user: { id: user.id, name: user.name, role: user.role },
        });
      }

      case "verify": {
        const authHeader = req.headers.get("x-company-auth");
        if (!authHeader) return json({ error: "Token não fornecido" }, 401);

        const { data: session } = await supabase
          .from("company_sessions")
          .select("*, company:companies(*), user:company_users(*)")
          .eq("token", authHeader)
          .maybeSingle();
        if (!session) return json({ error: "Sessão inválida" }, 401);

        if (session.expires_at && new Date(session.expires_at) < new Date()) {
          await supabase.from("company_sessions").delete().eq("id", session.id);
          return json({ error: "Sessão expirada" }, 401);
        }

        return json({ ok: true, company: session.company, user: session.user });
      }

      case "list": {
        const { data: companies } = await supabase
          .from("companies")
          .select("*")
          .order("name");
        return json({ companies: companies || [] });
      }

      case "create": {
        const { name, permissions, active, adminName, adminPassword } = data;
        if (!name) return json({ error: "Nome da empresa é obrigatório" }, 400);
        const { data: company, error } = await supabase
          .from("companies")
          .insert({ name, permissions: permissions || {}, active: active !== false })
          .select()
          .single();
        if (error) return json({ error: error.message }, 500);
        if (adminName && adminPassword) {
          const hashedPw = await hashPassword(adminPassword);
          const { error: userErr } = await supabase
            .from("company_users")
            .insert({ company_id: company.id, name: adminName, password: hashedPw, role: "admin", active: true });
          if (userErr) console.error("Error creating admin user:", userErr.message);
        }
        return json({ company });
      }

      case "get": {
        const { id } = data;
        const { data: company } = await supabase
          .from("companies")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (!company) return json({ error: "Empresa não encontrada" }, 404);
        return json({ company });
      }

      case "update": {
        const { id, ...updates } = data;
        const { data: company, error } = await supabase
          .from("companies")
          .update(updates)
          .eq("id", id)
          .select()
          .single();
        if (error) return json({ error: error.message }, 500);
        return json({ company });
      }

      case "delete": {
        const { id } = data;
        await supabase.from("company_sessions").delete().eq("company_id", id);
        await supabase.from("company_users").delete().eq("company_id", id);
        await supabase.from("companies").delete().eq("id", id);
        return json({ ok: true });
      }

      case "list_users": {
        const { company_id } = data;
        const { data: users } = await supabase
          .from("company_users")
          .select("id, name, role, active, created_at")
          .eq("company_id", company_id)
          .order("name");
        return json({ users: users || [] });
      }

      case "create_user": {
        const { company_id, name, password, role } = data;
        if (!company_id || !name || !password) {
          return json({ error: "Campos obrigatórios: company_id, name, password" }, 400);
        }
        const hashedPw = await hashPassword(password);
        const { data: user, error } = await supabase
          .from("company_users")
          .insert({
            company_id,
            name,
            password: hashedPw,
            role: role || "user",
            active: true,
          })
          .select()
          .single();
        if (error) return json({ error: error.message }, 500);
        return json({ user: { id: user.id, name: user.name, role: user.role } });
      }

      case "update_user": {
        const { id, ...updates } = data;
        if (updates.password) {
          updates.password = await hashPassword(updates.password);
        }
        const { data: user, error } = await supabase
          .from("company_users")
          .update(updates)
          .eq("id", id)
          .select()
          .single();
        if (error) return json({ error: error.message }, 500);
        return json({ user: { id: user.id, name: user.name, role: user.role } });
      }

      case "delete_user": {
        const { id } = data;
        await supabase.from("company_sessions").delete().eq("user_id", id);
        await supabase.from("company_users").delete().eq("id", id);
        return json({ ok: true });
      }

      default:
        return json({ error: "Ação desconhecida: " + action }, 400);
    }
  } catch (err) {
    return json({ error: err.message || "Erro interno" }, 500);
  }
});
