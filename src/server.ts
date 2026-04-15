import { createApp } from "./app";

const app = createApp();
const port = +(process.env.PORT ?? 3000);

app
	.listen(port, () => {
		console.log(JSON.stringify({ event: "server_started", port }));
	})
	.on("error", error => {
		console.error(JSON.stringify({ event: "server_error", error }));
	});
