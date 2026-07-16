interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  SUBMISSION_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const allowedCategories = new Set(["ai-credits", "cloud-credits", "startup-programs", "grants", "funding", "discounts", "nonprofit-benefits", "student-benefits", "developer-programs", "accelerators", "fellowships", "business-perks"]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").trim().slice(0, max);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded")) return json({ message: "Unsupported request format." }, 415);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (env.SUBMISSION_RATE_LIMITER && !(await env.SUBMISSION_RATE_LIMITER.limit({ key: ip })).success) return json({ message: "Too many submissions. Please try again later." }, 429);
  const form = await request.formData();
  if (text(form, "website", 200)) return json({ message: "Submitted." }, 202);
  const provider = text(form, "provider", 100); const title = text(form, "title", 140); const category = text(form, "category", 40); const sourceUrl = text(form, "sourceUrl", 500); const details = text(form, "details", 2000); const email = text(form, "email", 254);
  if (!provider || !title || !allowedCategories.has(category) || details.length < 30 || form.get("affiliationConfirmed") !== "true") return json({ message: "Complete all required fields." }, 400);
  let parsedUrl: URL; try { parsedUrl = new URL(sourceUrl); } catch { return json({ message: "Enter a valid official source URL." }, 400); }
  if (parsedUrl.protocol !== "https:") return json({ message: "The source URL must use HTTPS." }, 400);
  const token = text(form, "cf-turnstile-response", 2048);
  if (env.TURNSTILE_SECRET_KEY) { const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }) }); const result = await verification.json() as { success: boolean }; if (!result.success) return json({ message: "Spam check failed. Please try again." }, 400); }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/submissions`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify({ provider, title, category, source_url: parsedUrl.toString(), details, submitter_email: email || null, status: "pending", ip_hash: null }) });
  if (!response.ok) { console.error(JSON.stringify({ event: "submission_insert_failed", status: response.status })); return json({ message: "The submission service is temporarily unavailable." }, 503); }
  console.log(JSON.stringify({ event: "submission_received", category })); return json({ message: "Submitted." }, 201);
};

export const onRequest: PagesFunction<Env> = async (context) => context.request.method === "POST" ? onRequestPost(context) : json({ message: "Method not allowed." }, 405);
