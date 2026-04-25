import { defineConfig } from "vite";
import type { Connect } from "vite";

// Custom plugin to expose api/*.js endpoints during dev
function apiPlugin() {
  return {
    name: "api-plugin",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: Connect.NextFunction) => {
        if (!req.url?.startsWith("/api/")) {
          return next();
        }
        // Map /api/clone-voice -> ./api/clone-voice.js
        const fnName = req.url.split("?")[0].replace("/api/", "");
        try {
          const module = await server.ssrLoadModule(`/api/${fnName}.js`);
          await module.default(req, res);
        } catch (err) {
          console.error("API error:", err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [apiPlugin()],
});
