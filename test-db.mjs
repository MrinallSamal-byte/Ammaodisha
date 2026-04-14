import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://rynghcbuafynvxvtsuyn.supabase.co";
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5bmdoY2J1YWZ5bnZ4dnRzdXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMTQwMjMsImV4cCI6MjA5MTU5MDAyM30.ZUkuytwHVjBELpmVoy2XmrFH4wJcqK1lx0AM3DT0XPU";

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
