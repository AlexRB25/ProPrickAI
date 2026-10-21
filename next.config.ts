import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las variables visibles en el navegador se llaman PB_* en lugar de NEXT_PUBLIC_*,
  // así que Next.js solo incluye las que se listan aquí.
  env: {
    PB_SUPABASE_URL: process.env.PB_SUPABASE_URL ?? "",
    PB_SUPABASE_PUBLISHABLE_KEY: process.env.PB_SUPABASE_PUBLISHABLE_KEY ?? "",
  },
};

export default nextConfig;
