import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const supabasePackagePath = path.resolve(process.cwd(), "node_modules/@supabase/supabase-js/package.json");
const supabaseStubPath = path.resolve(process.cwd(), "tests/v2/stubs/supabase-js.mjs");
const hasSupabasePackage = fs.existsSync(supabasePackagePath);

if (!hasSupabasePackage && process.env.CI === "true") {
  throw new Error("Missing @supabase/supabase-js in node_modules. Install dependencies before CI build.");
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: hasSupabasePackage
      ? {}
      : {
        "@supabase/supabase-js": supabaseStubPath,
      },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
