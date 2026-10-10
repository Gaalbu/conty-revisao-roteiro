import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";

const port = Number(process.env.PORT ?? 43121);

serve({ fetch: createApp(openDatabase()).fetch, port }, (info) => {
  console.log(`revisão de roteiro em http://127.0.0.1:${info.port}`);
});
