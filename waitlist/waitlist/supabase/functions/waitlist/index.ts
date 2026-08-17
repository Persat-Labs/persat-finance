// Persat Finance waitlist Edge Function.
// Deploy with: supabase functions deploy waitlist --no-verify-jwt
// The function uses the public Supabase key, so the table's INSERT-only RLS
// policy remains the final database permission boundary.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const roleTypes = new Set([
  "Bitcoin Holder (Borrower)",
  "Stablecoin Holder (Lender)",
  "Both",
  "Just Curious",
]);

const regions = new Set([
  "Africa",
  "Asia",
  "Europe",
  "North America",
  "South America",
  "Other",
]);

const referralSources = new Set([
  "Twitter/X",
  "Telegram",
  "A friend or colleague",
  "A crypto/Bitcoin community",
  "Search",
  "Other",
]);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ ok: false }, 405);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, errors: { form: "Invalid request." } }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch (_) {
    return json({ ok: false, errors: { form: "Invalid request." } }, 400);
  }

  // Do not tell automated senders that the honeypot was detected. A normal
  // success-shaped response keeps the rejection silent and stores no row.
  if (text(body.website)) {
    return json({ ok: true });
  }

  const fullName = text(body.full_name);
  const email = text(body.email).toLowerCase();
  const roleType = text(body.role_type);
  const region = text(body.region);
  const referralSource = text(body.referral_source);
  const errors: Record<string, string> = {};

  if (!fullName) {
    errors.full_name = "Full name is required.";
  } else if (fullName.length > 200) {
    errors.full_name = "Full name is too long.";
  }

  if (!email) {
    errors.email = "Email address is required.";
  } else if (email.length > 320 || !emailPattern.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!roleTypes.has(roleType)) {
    errors.role_type = "Please select an option.";
  }

  if (region && !regions.has(region)) {
    errors.region = "Please select a valid region.";
  }

  if (referralSource && !referralSources.has(referralSource)) {
    errors.referral_source = "Please select a valid referral source.";
  }

  if (Object.keys(errors).length > 0) {
    return json({ ok: false, errors }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase runtime variables are not configured");
    return json({ ok: false }, 500);
  }

  const insertResponse = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/waitlist_signups`,
    {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        full_name: fullName,
        email,
        role_type: roleType,
        region: region || null,
        referral_source: referralSource || null,
      }),
    },
  );

  if (insertResponse.ok) {
    return json({ ok: true, duplicate: false });
  }

  let databaseError: Record<string, unknown> = {};
  try {
    const parsed = await insertResponse.json();
    if (parsed && typeof parsed === "object") {
      databaseError = parsed as Record<string, unknown>;
    }
  } catch (_) {
    // Keep the response generic below if Supabase did not return JSON.
  }

  const databaseMessage = [
    databaseError.code,
    databaseError.message,
    databaseError.details,
  ]
    .filter(Boolean)
    .join(" ");

  const isDuplicate =
    insertResponse.status === 409 ||
    databaseError.code === "23505" ||
    /duplicate|unique|waitlist_signups_email_key/i.test(databaseMessage);

  if (isDuplicate) {
    return json({ ok: true, duplicate: true });
  }

  console.error("Supabase waitlist insert failed", {
    status: insertResponse.status,
  });
  return json({ ok: false }, 500);
});
