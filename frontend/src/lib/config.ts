export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL as string | undefined
)?.trim() || 'http://localhost:3000';

export const AUTH_TOKEN_STORAGE_KEY = 'mesa-access-token';
export const AUTH_TOKEN_EXPIRY_STORAGE_KEY = 'mesa-access-token-expires-at';
