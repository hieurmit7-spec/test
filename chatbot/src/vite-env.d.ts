/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NVIDIA_NIM_API_KEY: string
  readonly VITE_NVIDIA_NIM_BASE_URL: string
  readonly VITE_NVIDIA_NIM_MODEL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_SUPABASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
