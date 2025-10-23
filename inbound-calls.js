 import WebSocket from "ws";

 export function registerInboundRoutes(fastify) {
   // Check for the required environment variables
   const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID } = process.env;

   if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
     console.error("Missing required environment variables");
     throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID");
   }

+  // Small helper to build public base URL safely
+  const getBaseUrl = (req) => {
+    const fromEnv = process.env.PUBLIC_BASE_URL;
+    if (fromEnv && fromEnv.startsWith("http")) return fromEnv;
+    // fallback to request host
+    const host = req?.headers?.host || "localhost";
+    return `https://${host}`;
+  };

   // Helper function to get signed URL for authenticated conversations
   async function getSignedUrl() {
     try {
       const response = await fetch(
         `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
         {
           method: 'GET',
           headers: {
             'xi-api-key': ELEVENLABS_API_KEY
           }
         }
       );

       if (!response.ok) {
         throw new Error(`Failed to get signed URL: ${response.statusText}`);
       }

       const data = await response.json();
       return data.signed_url;
     } catch (error) {
       console.error("Error getting signed URL:", error);
       throw error;
     }
   }

-  // Route to handle incoming calls from Twilio
-  fastify.all("/incoming-call-eleven", async (request, reply) => {
-    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
-      <Response>
-        <Connect>
-          <Stream url="wss://${request.headers.host}/media-stream" />
-        </Connect>
-      </Response>`;
-
-    reply.type("text/xml").send(twimlResponse);
-  });
+  // 1) Inbound: önce tuş bekletiyoruz
+  fastify.all("/incoming-call-eleven", async (request, reply) => {
+    const baseUrl = getBaseUrl(request);
+    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
+    <Response>
+      <Gather action="${baseUrl}/gather-handler" numDigits="1">
+        <Say>Press any key to connect to your AI assistant.</Say>
+      </Gather>
+      <Say>No input received. Goodbye.</Say>
+    </Response>`;
+    reply.type("text/xml").send(twiml);
+  });
+
+  // 2) Tuşa basılınca AI agent'a bağla
+  fastify.post("/gather-handler", async (request, reply) => {
+    const digits = request.body?.Digits || "";
+    const from = request.body?.From || "";
+    console.log(`📞 Tuş basıldı: ${digits} - Arayan: ${from}`);
+
+    const baseUrl = getBaseUrl(request);
+    const wsUrl = baseUrl.replace("https://", "wss://");
+
+    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
+    <Response>
+      <Say>Connecting you to the AI agent now.</Say>
+      <Connect>
+        <Stream url="${wsUrl}/media-stream" />
+      </Connect>
+    </Response>`;
+
+    reply.type("text/xml").send(twimlResponse);
+  });

   // WebSocket route for handling media streams from Twilio
   fastify.register(async (fastifyInstance) => {
     fastifyInstance.get("/media-stream", { websocket: true }, async (connection, req) => {
       console.info("[Server] Twilio connected to media stream.");

       let streamSid = null;
       let elevenLabsWs = null;

       try {
         // Get authenticated WebSocket URL
         const signedUrl = await getSignedUrl();

         // Connect to ElevenLabs using the signed URL
         elevenLabsWs = new WebSocket(signedUrl);

         // Handle open event for ElevenLabs WebSocket
         elevenLabsWs.on("open", () => {
           console.log("[II] Connected to Conversational AI.");
         });

         // Handle messages from ElevenLabs
         elevenLabsWs.on("message", (data) => {
           try {
             const message = JSON.parse(data);
             handleElevenLabsMessage(message, connection);
           } catch (error) {
             console.error("[II] Error parsing message:", error);
           }
         });
