/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 */

export default {
	async fetch(req) {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '* * * * *');
		return new Response(`To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`);
	},

	async scheduled(event, env, ctx) {
		const magentoHost = env.MAGENTO_HOST;
		const token = env.MAGENTO_TOKEN;
		const ZOHO_CLIQ_API_ENDPOINT = env.ZOHO_CLIQ_API_ENDPOINT;
		const ZOHO_CLIQ_WEBHOOK_TOKEN = env.ZOHO_CLIQ_WEBHOOK_TOKEN;
		const ZOHO_CLIQ_BOTNAME = env.ZOHO_CLIQ_BOTNAME;

		const pageSize = 100;
		let currentPage = 1;
		let allOrders = [];

		const now = new Date();
		const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
		const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

		// Helper to send message to Zoho Cliq via incoming webhook
		async function sendToCliq(webhookUrl, messageText) {
			const message = { text: messageText };
			const response = await fetch(webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(message),
			});
			const responseString = await response.text();
			if (!response.ok) {
				console.log('Cliq response:', responseString);
				throw new Error(`Failed to send message to Cliq: ${response.statusText}; ${responseString}`);
			}
			console.log('Cliq response:', responseString);
		}

		// Build the webhook URL
		const cliqWebhookUrl = `${ZOHO_CLIQ_API_ENDPOINT}?zapikey=${ZOHO_CLIQ_WEBHOOK_TOKEN}`;

		if (event.cron === '0 4 * * *') {
			// Calculate yesterday's date range in UTC (00:00:00 to 23:59:59)
			const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
			const startOfDay = new Date(yesterday.setHours(0, 0, 0, 0)).toISOString();
			const endOfDay = new Date(yesterday.setHours(23, 59, 59, 999)).toISOString();

			let currentPage = 1;
			let allOrders = [];

			while (true) {
				const ordersUrl =
					`${magentoHost}/rest/V1/orders?` +
					`searchCriteria[filter_groups][0][filters][0][field]=status` +
					`&searchCriteria[filter_groups][0][filters][0][value]=processing` +
					`&searchCriteria[filter_groups][0][filters][0][condition_type]=eq` +
					`&searchCriteria[filter_groups][1][filters][0][field]=created_at` +
					`&searchCriteria[filter_groups][1][filters][0][value]=${startOfDay}` +
					`&searchCriteria[filter_groups][1][filters][0][condition_type]=gteq` +
					`&searchCriteria[filter_groups][1][filters][1][field]=created_at` +
					`&searchCriteria[filter_groups][1][filters][1][value]=${endOfDay}` +
					`&searchCriteria[filter_groups][1][filters][1][condition_type]=lteq` +
					`&searchCriteria[pageSize]=${pageSize}` +
					`&searchCriteria[currentPage]=${currentPage}`;

				const resp = await fetch(ordersUrl, {
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
				});

				if (!resp.ok) {
					console.log(`Failed to fetch orders: ${resp.status} ${resp.statusText}`);
					break;
				}

				const data = await resp.json();
				const items = data.items || [];
				allOrders = allOrders.concat(items);

				console.log(`Fetched page ${currentPage}: ${items.length} orders`);

				if (items.length < pageSize) {
					break; // Last page reached
				}
				currentPage++;
			}

			console.log(`Total fetched processing orders for yesterday: ${allOrders.length}`);

			// Filter orders with grand_total > 500
			const start = new Date(startOfDay);
			const end = new Date(endOfDay);

			const onlyYesterdayOrders = allOrders.filter((order) => {
				const created = new Date(order.created_at);
				return created >= start && created <= end;
			});

			// Now filter for grand_total > 500
			const highValueOrders = onlyYesterdayOrders.filter((order) => parseFloat(order.grand_total) > 500);
			const orderNumbers = highValueOrders.map((order) => order.increment_id);
			console.log('High Value Order Numbers:', orderNumbers);

			const chunkSize = 10;
			for (let i = 0; i < orderNumbers.length; i += chunkSize) {
				const chunk = orderNumbers.slice(i, i + chunkSize);
				const messageText = `💰 Processing orders > $500 from yesterday (${i + 1}-${i + chunk.length} of ${
					orderNumbers.length
				}):\n${chunk.join(', ')}`;
				await sendToCliq(cliqWebhookUrl, messageText);
				await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay to avoid rate limit
			}
		} else if (event.cron === '0 5 * * *') {
			// Fetch holded orders within the last 7 days
			currentPage = 1;
			allOrders = [];

			while (true) {
				const ordersUrl =
					`${magentoHost}/rest/V1/orders?` +
					`searchCriteria[filter_groups][0][filters][0][field]=status` +
					`&searchCriteria[filter_groups][0][filters][0][value]=holded` +
					`&searchCriteria[filter_groups][0][filters][0][condition_type]=eq` +
					`&searchCriteria[filter_groups][1][filters][0][field]=created_at` +
					`&searchCriteria[filter_groups][1][filters][0][value]=${thirtyDaysAgo}` +
					`&searchCriteria[filter_groups][1][filters][0][condition_type]=gteq` +
					`&searchCriteria[filter_groups][1][filters][1][field]=created_at` +
					`&searchCriteria[filter_groups][1][filters][1][value]=${now.toISOString()}` +
					`&searchCriteria[filter_groups][1][filters][1][condition_type]=lteq` +
					`&searchCriteria[pageSize]=${pageSize}` +
					`&searchCriteria[currentPage]=${currentPage}`;

				const resp = await fetch(ordersUrl, {
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
				});

				if (!resp.ok) {
					console.log(`Failed to fetch holded orders: ${resp.status} ${resp.statusText}`);
					break;
				}

				const data = await resp.json();
				const items = data.items || [];
				allOrders = allOrders.concat(items);

				console.log(`Fetched page ${currentPage}: ${items.length} holded orders`);

				if (items.length < pageSize) {
					break; // Last page reached
				}
				currentPage++;
			}

			console.log(`Total fetched holded orders within last 30 days: ${allOrders.length}`);

			const orderNumbers = allOrders.map((order) => order.increment_id);
			console.log('Holded Order Numbers:', orderNumbers);

			const chunkSize = 10;
			for (let i = 0; i < orderNumbers.length; i += chunkSize) {
				const chunk = orderNumbers.slice(i, i + chunkSize);
				const messageText = `📦 Holded orders within last 30 days (${i + 1}-${i + chunk.length} of ${orderNumbers.length}):\n${chunk.join(
					', '
				)}`;
				await sendToCliq(cliqWebhookUrl, messageText);
				await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay to avoid rate limit
			}
		}
	},
};
