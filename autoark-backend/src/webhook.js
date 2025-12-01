const http = require("http");
const crypto = require("crypto");
const { exec } = require("child_process");
const SECRET = "zww199976";

function verifySignature(signature, body) {
  if (!signature) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  return (
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    return res.end("Not Found");
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const signature = req.headers["x-hub-signature-256"];
    if (!verifySignature(signature, body)) {
      res.writeHead(403);
      return res.end("Invalid signature");
    }

    console.log("Webhook verified. Running deploy script...");
    exec("bash /root/auto-deploy.sh", (error, stdout, stderr) => {
      if (error) {
        console.error("Deploy failed:", error);
      }
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    });

    res.writeHead(200);
    res.end("Deploy Triggered");
  });
});

server.listen(3001, () => {
  console.log("GitHub Webhook Server Running on port 3001");
});

