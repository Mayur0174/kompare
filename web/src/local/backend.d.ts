export function localApi(path: string, opts?: { method?: string; body?: unknown; token?: string | null }): Promise<{ status: number; body: any }>;
