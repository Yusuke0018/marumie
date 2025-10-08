const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://cloudflare-worker.youyou00181002.workers.dev';

export interface ShareDataRequest {
  type: 'reservation' | 'listing' | 'survey';
  category?: string;
  data: string; // CSV content
}

export interface ShareDataResponse {
  id: string;
  url: string;
}

export interface FetchDataResponse {
  type: string;
  category?: string;
  data: string;
  uploadedAt: string;
}

/**
 * データをR2にアップロードして共有URLを取得
 */
export async function uploadDataToR2(request: ShareDataRequest): Promise<ShareDataResponse> {
  const response = await fetch(`${WORKER_URL}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json() as { error?: string };
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

/**
 * 共有URLからデータを取得
 */
export async function fetchDataFromR2(id: string): Promise<FetchDataResponse> {
  const response = await fetch(`${WORKER_URL}/api/data/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json() as { error?: string };
    throw new Error(error.error || 'Fetch failed');
  }

  return response.json();
}
