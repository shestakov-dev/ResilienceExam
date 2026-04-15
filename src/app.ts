import express, { type Request, type Response } from "express";
import { Counter, Registry, collectDefaultMetrics } from "prom-client";

export const PRIMARY_URL = "https://jsonplaceholder.typicode.com/todos";
export const FALLBACK_URL = "https://dummyjson.com/todos";

type FetchLike = typeof fetch;

type AppOptions = {
	fetchImpl?: FetchLike;
	logger?: Pick<Console, "error">;
};

type TodosPayload = unknown[] | { todos?: unknown[] };

export function isFailureInjected(value: unknown): boolean {
	if (value == null) {
		return false;
	}

	return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

async function fetchJson(
	fetchImpl: FetchLike,
	url: string,
): Promise<TodosPayload> {
	const response = await fetchImpl(url);

	if (!response.ok) {
		throw new Error(`Request to ${url} failed with status ${response.status}`);
	}

	return (await response.json()) as TodosPayload;
}

function normalizeTodos(payload: TodosPayload): unknown[] {
	if (Array.isArray(payload)) {
		return payload;
	}

	if (Array.isArray(payload?.todos)) {
		return payload.todos;
	}

	return [];
}

export function createApp({
	fetchImpl = fetch,
	logger = console,
}: AppOptions = {}) {
	const app = express();
	const registry = new Registry();

	collectDefaultMetrics({ register: registry });

	const fallbackTriggerCounter = new Counter({
		name: "fallback_trigger_total",
		help: "Number of times the fallback API was used",
		registers: [registry],
	});

	app.get("/todos", async (req: Request, res: Response) => {
		try {
			if (isFailureInjected(req.query.failPrimary)) {
				throw new Error(
					"Primary API failure intentionally injected via failPrimary query param",
				);
			}

			const primaryPayload = await fetchJson(fetchImpl, PRIMARY_URL);

			return res.json({
				source: "primary",
				todos: normalizeTodos(primaryPayload),
			});
		} catch (primaryError) {
			const typedPrimaryError = primaryError as Error;
			fallbackTriggerCounter.inc();

			logger.error(
				JSON.stringify({
					event: "fallback_triggered",
					timestamp: new Date().toISOString(),
					route: "/todos",
					primaryUrl: PRIMARY_URL,
					fallbackUrl: FALLBACK_URL,
					reason: typedPrimaryError.message,
				}),
			);

			try {
				const fallbackPayload = await fetchJson(fetchImpl, FALLBACK_URL);

				return res.json({
					source: "fallback",
					todos: normalizeTodos(fallbackPayload),
				});
			} catch (fallbackError) {
				const typedFallbackError = fallbackError as Error;

				return res.status(502).json({
					error: "Both primary and fallback providers failed",
					details: {
						primary: typedPrimaryError.message,
						fallback: typedFallbackError.message,
					},
				});
			}
		}
	});

	app.get("/metrics", async (_req: Request, res: Response) => {
		res.set("Content-Type", registry.contentType);
		res.send(await registry.metrics());
	});

	app.get("/health", (_req: Request, res: Response) => {
		res.json({ status: "ok" });
	});

	app.locals.metrics = { registry, fallbackTriggerCounter };

	return app;
}
