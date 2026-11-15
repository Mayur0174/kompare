export type LiveOffer = {
  title: string; source: string; price: number; oldPrice: number | null; link: string; googleLink: string | null;
  image: string | null; rating: number | null; reviews: number | null; delivery: string | null; productId: string | null;
};
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
export function serpApiUrl(query: string, apiKey: string): string;
export function fetchLiveOffers(query: string, apiKey: string, fetchImpl?: FetchLike): Promise<LiveOffer[]>;
export function normalizeResults(data: unknown): LiveOffer[];
export function platformIdFor(source: string): string;
