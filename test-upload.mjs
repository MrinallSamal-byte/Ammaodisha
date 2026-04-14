import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://rynghcbuafynvxvtsuyn.supabase.co";
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5bmdoY2J1YWZ5bnZ4dnRzdXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMTQwMjMsImV4cCI6MjA5MTU5MDAyM30.ZUkuytwHVjBELpmVoy2XmrFH4wJcqK1lx0AM3DT0XPU";

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
