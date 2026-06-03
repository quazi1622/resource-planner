import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
    responseLimit: false,
  },
};

type ExpressHandler = (req: NextApiRequest, res: NextApiResponse) => void;

let app: ExpressHandler | null = null;

function getBackendApp() {
  if (!app) {
    app = require("../../../server.js") as ExpressHandler;
  }
  return app;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const originalUrl = req.url || "/";
    const rewrittenUrl = originalUrl.replace(/^\/api\/backend/, "") || "/";
    req.url = rewrittenUrl.startsWith("/") ? rewrittenUrl : `/${rewrittenUrl}`;
    getBackendApp()(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backend proxy failed";
    console.error("Backend proxy error:", message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: message });
    }
  }
}
