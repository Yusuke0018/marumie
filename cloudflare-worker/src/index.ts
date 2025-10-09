/**
 * Marumie Data API - Cloudflare Worker
 * CSV データの保存と取得を行うAPI
 */

interface Env {
	MARUMIE_DATA: R2Bucket;
}

// ユニークIDを生成
function generateId(): string {
	return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// CORS ヘッダーを追加
function corsHeaders(origin: string | null) {
	// localhost と本番URL、Vercelプレビューを許可
	const allowedOrigins = [
		'http://localhost:3000',
		'http://localhost:3001',
		'http://localhost:3002',
		'https://yusuke0018.github.io',
	];

	// Vercelプレビューも許可（*.vercel.app）
	const isVercelPreview = origin && origin.includes('.vercel.app');
	const isAllowed = origin && (allowedOrigins.includes(origin) || isVercelPreview);

	return {
		'Access-Control-Allow-Origin': isAllowed ? origin : '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	};
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');

		// CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: corsHeaders(origin),
			});
		}

		// POST /api/upload - CSVデータをアップロード
		if (request.method === 'POST' && url.pathname === '/api/upload') {
			try {
				const body = await request.json() as {
					type: 'reservation' | 'listing' | 'survey' | 'karte';
					category?: string;
					data: string;
				};

				const id = generateId();
				const key = `${body.type}/${id}.json`;

				// R2に保存
				await env.MARUMIE_DATA.put(key, JSON.stringify({
					type: body.type,
					category: body.category,
					data: body.data,
					uploadedAt: new Date().toISOString(),
				}));

				// Next.jsアプリのURLを返す
				const appUrl = origin || 'https://yusuke0018.github.io/marumie';
				return new Response(JSON.stringify({ id, url: `${appUrl}?data=${id}` }), {
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders(origin),
					},
				});
			} catch (error) {
				return new Response(JSON.stringify({ error: 'Upload failed', details: (error as Error).message }), {
					status: 500,
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders(origin),
					},
				});
			}
		}

		// GET /api/data/:id - データを取得
		if (request.method === 'GET' && url.pathname.startsWith('/api/data/')) {
			const id = url.pathname.split('/').pop();
			if (!id) {
				return new Response(JSON.stringify({ error: 'ID is required' }), {
					status: 400,
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders(origin),
					},
				});
			}

			try {
				// 3つのタイプを全て検索
				const types = ['reservation', 'listing', 'survey', 'karte'];
				
				for (const type of types) {
					const key = `${type}/${id}.json`;
					const object = await env.MARUMIE_DATA.get(key);
					
					if (object) {
						const data = await object.text();
						return new Response(data, {
							headers: {
								'Content-Type': 'application/json',
								...corsHeaders(origin),
							},
						});
					}
				}

				return new Response(JSON.stringify({ error: 'Data not found' }), {
					status: 404,
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders(origin),
					},
				});
			} catch (error) {
				return new Response(JSON.stringify({ error: 'Fetch failed', details: (error as Error).message }), {
					status: 500,
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders(origin),
					},
				});
			}
		}

		// GET /api/health - ヘルスチェック
		if (request.method === 'GET' && url.pathname === '/api/health') {
			return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
				headers: {
					'Content-Type': 'application/json',
					...corsHeaders(origin),
				},
			});
		}

		return new Response(JSON.stringify({ error: 'Not Found' }), {
			status: 404,
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders(origin),
			},
		});
	},
};
