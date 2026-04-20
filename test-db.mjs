import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://rynghcbuafynvxvtsuyn.supabase.co";
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseKey) {
  throw new Error("Set VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY before running this script.");
}

const client = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await client.from("garbage_reports").insert({
    id: crypto.randomUUID(),
    ward_number: 1,
    address: "Test Location",
    latitude: 20.296,
    longitude: 85.824,
    photo_url: "https://rynghcbuafynvxvtsuyn.supabase.co/storage/v1/object/public/garbage-photos/reports/test-1776083945187.jpg",
    severity: "medium",
    category: "mixed",
    is_test: true,
  }).select();
  if (error) {
    console.error("Insert error:", error);
  } else {
    console.log("Insert success:", data);
  }
}
test();
