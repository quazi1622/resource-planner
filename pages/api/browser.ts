import { exec } from "child_process";
import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { query } = req.body || {};
  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  const agentCommand = `agent-browser run "Go to Google Maps. Find coordinates for the start and end of a trip from ${query}. Output only a JSON object like {\\\"start\\\": {\\\"lat\\\": 0, \\\"lng\\\": 0, \\\"address\\\": \\\"\\\"}, \\\"end\\\": {\\\"lat\\\": 0, \\\"lng\\\": 0, \\\"address\\\": \\\"\\\"}}"`;

  exec(agentCommand, (error, stdout) => {
    if (error) {
      res.status(500).json({ error: "Agent failed to find locations." });
      return;
    }

    try {
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      const data = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      res.status(200).json(data);
    } catch {
      res.status(500).json({ error: "Could not parse agent data." });
    }
  });
}
