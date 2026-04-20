import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://rynghcbuafynvxvtsuyn.supabase.co";
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseKey) {
  throw new Error("Set VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY before running this script.");
}

const client = createClient(supabaseUrl, supabaseKey);

async function test() {
  const file = fs.readFileSync("test.jpg");
  const path = `reports/test-${Date.now()}.jpg`;
  console.log("Uploading to", path);
  const { data, error } = await client.storage.from("garbage-photos").upload(path, file, {
    contentType: "image/jpeg"
  });
  if (error) {
    console.error("Upload error:", error);
  } else {
    console.log("Upload success:", data);
  }
}
test();
