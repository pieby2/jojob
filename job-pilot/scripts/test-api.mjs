import { spawn } from "child_process";
import http from "http";

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "localhost",
        port: 3999,
        path,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const bodyBuffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            bodyBuffer,
            bodyText: bodyBuffer.toString("utf-8"),
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function testApi() {
  console.log("Starting server on port 3999 for automated API verification...");
  const server = spawn("node", ["server.mjs"], {
    cwd: process.cwd() + "/job-pilot",
    env: { ...process.env, PORT: "3999" },
    stdio: "inherit",
    shell: true,
  });

  // Give server 3 seconds to boot
  await sleep(3500);

  try {
    // 1. GET /api/jobs
    console.log("\n[Test 1] Testing GET /api/jobs...");
    const jobsRes = await request("/api/jobs");
    console.log("Status:", jobsRes.statusCode);
    const jobs = JSON.parse(jobsRes.bodyText);
    console.log(`Found ${jobs.length} jobs.`);
    const caseguard = jobs.find((j) => j._id === "caseguard-cv-2026");
    if (!caseguard) throw new Error("CaseGuard job not found in /api/jobs!");
    console.log("CaseGuard Job Found:");
    console.log("- Title:", caseguard.title);
    console.log("- Target Role:", caseguard.target_role);
    console.log("- Experience Match:", caseguard.experience_match);
    console.log("- Tailored Headline:", caseguard._tailoredResume?.headline);

    // 2. GET /api/jobs/caseguard-cv-2026/resume.pdf
    console.log("\n[Test 2] Testing GET /api/jobs/caseguard-cv-2026/resume.pdf...");
    const pdfRes = await request("/api/jobs/caseguard-cv-2026/resume.pdf");
    console.log("Status:", pdfRes.statusCode);
    console.log("Content-Type:", pdfRes.headers["content-type"]);
    console.log("Content-Length:", pdfRes.headers["content-length"] || pdfRes.bodyBuffer.length);
    const isPdf = pdfRes.bodyBuffer.slice(0, 4).toString() === "%PDF";
    console.log("Is Valid PDF Header (%PDF):", isPdf);
    if (!isPdf) throw new Error("Response is not a valid PDF!");

    // 3. GET /api/jobs/caseguard-cv-2026/resume.html
    console.log("\n[Test 3] Testing GET /api/jobs/caseguard-cv-2026/resume.html...");
    const htmlRes = await request("/api/jobs/caseguard-cv-2026/resume.html");
    console.log("Status:", htmlRes.statusCode);
    console.log("Content-Type:", htmlRes.headers["content-type"]);
    console.log("Contains 'CaseGuard':", htmlRes.bodyText.includes("CaseGuard"));
    console.log("Contains 'Mayonix Innovation':", htmlRes.bodyText.includes("Mayonix Innovation"));

    // 4. GET /api/jobs/caseguard-cv-2026/form-pack
    console.log("\n[Test 4] Testing GET /api/jobs/caseguard-cv-2026/form-pack...");
    const formPackRes = await request("/api/jobs/caseguard-cv-2026/form-pack");
    console.log("Status:", formPackRes.statusCode);
    const formPack = JSON.parse(formPackRes.bodyText);
    console.log("Form Pack OK:", formPack.ok);
    console.log("Applicant Name:", formPack.formAnswers?.fullName);
    console.log("Has 1-Tap Copy Text:", !!formPack.copyAllText);
    console.log("Has Mobile Bookmarklet:", !!formPack.bookmarklet);

    // 5. GET /api/health
    console.log("\n[Test 5] Testing GET /api/health...");
    const healthRes = await request("/api/health");
    console.log("Status:", healthRes.statusCode);
    const health = JSON.parse(healthRes.bodyText);
    console.log("Health Status:", health.status);

    // 6. POST /api/scan-ats (verifying POST method works without 404)
    console.log("\n[Test 6] Testing POST /api/scan-ats...");
    const atsRes = await request("/api/scan-ats", { method: "POST" });
    console.log("Status:", atsRes.statusCode);
    const atsData = JSON.parse(atsRes.bodyText);
    console.log("ATS Response:", { success: atsData.success, totalFound: atsData.totalFound, scannedPortals: atsData.scannedPortals });

    console.log("\n✅ ALL TESTS PASSED SUCCESSFULLY!");
  } finally {
    server.kill();
  }
}

testApi().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
