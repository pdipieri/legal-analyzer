const https = require("https");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key non configurata" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Body non valido" }) };
  }

  const { text, images } = body;
  if (!text && (!images || images.length === 0)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Nessun contenuto da analizzare" }) };
  }

  const systemPrompt =
    "Sei un assistente legale specializzato in diritto italiano. " +
    "Rispondi SEMPRE e SOLO con un oggetto JSON valido. " +
    "ZERO testo prima o dopo. ZERO markdown. ZERO backtick. Solo JSON puro.\n\n" +
    'Schema: {"tipoAtto":"","parti":[],"oggetto":"","data":"","sintesi":"","clausoleCritiche":[{"titolo":"","descrizione":"","livelloRischio":"medio"}],"elementiMancanti":[],"raccomandazioni":[],"valutazioneGenerale":"neutra"}\n\n' +
    "livelloRischio: alto | medio | basso — valutazioneGenerale: positiva | neutra | critica";

  let userContent;
  if (text) {
    userContent = "Analizza questo atto legale:\n\n" + text.slice(0, 15000);
  } else {
    userContent = [
      { type: "text", text: "Analizza questo atto legale (pagine scansionate):" },
      ...images.slice(0, 4).map((b64) => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: b64 },
      })),
    ];
  }

  const payload = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": ANTHROPIC_API_KEY,
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode !== 200) {
              resolve({
                statusCode: res.statusCode,
                body: JSON.stringify({ error: parsed.error?.message || "Errore API" }),
              });
              return;
            }
            const raw = (parsed.content || [])
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("")
              .trim();
            const s = raw.indexOf("{");
            const e = raw.lastIndexOf("}");
            if (s === -1 || e === -1) {
              resolve({ statusCode: 500, body: JSON.stringify({ error: "Nessun JSON nella risposta" }) });
              return;
            }
            const analysis = JSON.parse(raw.slice(s, e + 1));
            resolve({
              statusCode: 200,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify(analysis),
            });
          } catch (err) {
            resolve({ statusCode: 500, body: JSON.stringify({ error: "Parse error: " + err.message }) });
          }
        });
      }
    );
    req.on("error", (err) => resolve({ statusCode: 500, body: JSON.stringify({ error: err.message }) }));
    req.write(payload);
    req.end();
  });
};
