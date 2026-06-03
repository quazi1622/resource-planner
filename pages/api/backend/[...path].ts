import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";

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
    const nodeRequire = eval("require") as NodeRequire;
    app = nodeRequire(path.join(process.cwd(), "server.js")) as ExpressHandler;
  }
  return app;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const originalUrl = req.url || "/";
  const rewrittenUrl = originalUrl.replace(/^\/api\/backend/, "") || "/";
  req.url = rewrittenUrl.startsWith("/") ? rewrittenUrl : `/${rewrittenUrl}`;
  getBackendApp()(req, res);
}
