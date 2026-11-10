/**
 * End-to-end automated test suite for Job Pilot
 * Tests every endpoint, scraper, bridge, and data store.
 */

const BASE = "http://localhost:3000";

async function runTests() {
  console.log("==================================================");
  console.log("   🧪 RUNNING JOB PILOT FULL AUDIT & TEST SUITE   ");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Profile API
  try {
    const res = await fetch(`${BASE}/api/profile`);
    const data = await res.json();
    assert(res.status === 200, "GET /api/profile returns 200");
    assert(data.name.includes("Prakhar"), `Profile identifies candidate name: "${data.name}"`);
    assert(data.integrations?.careerOps && data.integrations?.aiJobSearch, "Both engines reported connected");
  } catch (e) {
    assert(false, `GET /api/profile failed: ${e.message}`);
  }

  // 2. Stats API
  try {
    const res = await fetch(`${BASE}/api/stats`);
    const data = await res.json();
    assert(res.status === 200, "GET /api/stats returns 200");
    assert(typeof data.local?.totalScanned === "number", `Local stats has totalScanned (${data.local?.totalScanned})`);
    assert(data.careerOps !== undefined, "careerOps stats object present");
  } catch (e) {
    assert(false, `GET /api/stats failed: ${e.message}`);
  }

  // 3. Tracked Applications API (career-ops)
  try {
    const res = await fetch(`${BASE}/api/tracked`);
    const data = await res.json();
    assert(res.status === 200, "GET /api/tracked returns 200");
    assert(Array.isArray(data), `Tracked applications is an array (length: ${data.length})`);
    if (data.length > 0) {
      assert(data[0].company && data[0].status, `First tracked item has company ("${data[0].company}") and status ("${data[0].status}")`);
    }
  } catch (e) {
    assert(false, `GET /api/tracked failed: ${e.message}`);
  }

  // 4. Salary Benchmark API (ai-job-search)
  try {
    // Known company
    const res1 = await fetch(`${BASE}/api/salary?company=Google`);
    const data1 = await res1.json();
    assert(res1.status === 200, "GET /api/salary?company=Google returns 200");
    assert(data1.company === "Google" && data1.categories?.engineering?.index > 0, `Google salary benchmark matched (Comp Index: ${data1.categories?.engineering?.index})`);

    // Unknown company fallback
    const res2 = await fetch(`${BASE}/api/salary?company=NonExistentCompanyXYZ123`);
    const data2 = await res2.json();
    assert(data2.found === false || data2 === null, "Unknown company handled gracefully with no crash");
  } catch (e) {
    assert(false, `GET /api/salary failed: ${e.message}`);
  }

  // 5. Jobs List API
  let testJobId = null;
  try {
    const res = await fetch(`${BASE}/api/jobs`);
    const data = await res.json();
    assert(res.status === 200, "GET /api/jobs returns 200");
    assert(Array.isArray(data) && data.length > 0, `Jobs list has ${data.length} items`);
    if (data.length > 0) {
      testJobId = data[0]._id;
      assert(testJobId && data[0].title, `Job has _id (${testJobId}) and title ("${data[0].title}")`);
    }
  } catch (e) {
    assert(false, `GET /api/jobs failed: ${e.message}`);
  }

  // 6. Security Guard verification on existing jobs
  try {
    const res = await fetch(`${BASE}/api/jobs`);
    const jobs = await res.json();
    const securedJobs = jobs.filter(j => j._security !== undefined);
    assert(securedJobs.length > 0, `${securedJobs.length} jobs have ai-job-search security verification report`);
    if (securedJobs[0]) {
      assert(securedJobs[0]._security.verdict.includes("clean") || securedJobs[0]._security.verdict.includes("guard"), `Security verdict present: "${securedJobs[0]._security.verdict}"`);
    }
  } catch (e) {
    assert(false, `Security guard check failed: ${e.message}`);
  }

  // 7. Status Update API & Sync to career-ops
  if (testJobId) {
    try {
      // Mark as Saved
      const res1 = await fetch(`${BASE}/api/jobs/${testJobId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "saved" }),
      });
      const data1 = await res1.json();
      assert(res1.status === 200 && data1.ok, `Updated job status to 'saved'`);

      // Reset to new
      await fetch(`${BASE}/api/jobs/${testJobId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "new" }),
      });
    } catch (e) {
      assert(false, `Status update test failed: ${e.message}`);
    }
  }

  // 8. Test evaluation on a real job with DeepSeek
  try {
    const res = await fetch(`${BASE}/api/jobs`);
    const jobs = await res.json();
    // Pick the Simplismart job from Wellfound
    const targetJob = jobs.find(j => (j.company_name || j.company || "").toLowerCase().includes("simplismart")) || jobs[0];

    if (targetJob) {
      console.log(`\n  ⚡ Testing full evaluation flow on: "${targetJob.title}" at "${targetJob.company_name || targetJob.company}"...`);
      const evalRes = await fetch(`${BASE}/api/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: targetJob._id }),
      });

      const evalData = await evalRes.json();
      assert(evalRes.status === 200, "POST /api/evaluate returned 200");
      assert(typeof evalData.evaluation?.score === "number" && evalData.evaluation.score > 0, `Evaluation score generated: ${evalData.evaluation?.score}/5`);
      assert(Boolean(evalData.evaluation?.verdict), `Verdict generated: ${evalData.evaluation?.verdict}`);
      assert(Boolean(evalData.evaluation?.archetype), `Archetype matched: ${evalData.evaluation?.archetype}`);
      assert(Object.keys(evalData.evaluation?.answers || {}).length > 0, `Draft answers generated (${Object.keys(evalData.evaluation?.answers || {}).length} questions)`);

      // Check if official report was saved
      if (evalData.evaluation?.reportPath) {
        assert(evalData.evaluation.reportPath.startsWith("reports/"), `Official report written to ${evalData.evaluation.reportPath}`);
      }
    }
  } catch (e) {
    assert(false, `Evaluation flow test failed: ${e.message}`);
  }

  // 9. Re-check tracked list to see if evaluation was registered in career-ops
  try {
    const res = await fetch(`${BASE}/api/tracked`);
    const tracked = await res.json();
    assert(tracked.length > 0, `career-ops tracker contains ${tracked.length} tracked applications`);
  } catch (e) {
    assert(false, `Re-checking tracked list failed: ${e.message}`);
  }

  // 10. Bookmarklet API test
  try {
    const res = await fetch(`${BASE}/api/bookmarklet`);
    const data = await res.json();
    assert(res.status === 200, "GET /api/bookmarklet returns 200");
    assert(data.bookmarklet?.startsWith("javascript:"), "Bookmarklet snippet is valid JavaScript protocol");
    assert(data.bookmarklet?.includes("Prakhar Pragyan Chaubey"), "Bookmarklet contains candidate name");
  } catch (e) {
    assert(false, `Bookmarklet test failed: ${e.message}`);
  }

  // 11. Tailored Resume PDF & HTML API test
  try {
    const resJobs = await fetch(`${BASE}/api/jobs`);
    const jobs = await resJobs.json();
    const evaluatedJob = jobs.find(j => j._tailoredResume || j._evaluation) || jobs[0];

    if (evaluatedJob) {
      const pdfRes = await fetch(`${BASE}/api/jobs/${evaluatedJob._id}/resume.pdf`);
      assert(pdfRes.status === 200, `GET /api/jobs/:id/resume.pdf returns 200 for job ${evaluatedJob._id}`);
      assert(pdfRes.headers.get("content-type")?.includes("pdf"), `Resume response is application/pdf (${pdfRes.headers.get("content-type")})`);

      const htmlRes = await fetch(`${BASE}/api/jobs/${evaluatedJob._id}/resume.html`);
      assert(htmlRes.status === 200, `GET /api/jobs/:id/resume.html returns 200`);
      const htmlText = await htmlRes.text();
      assert(htmlText.includes("Prakhar Pragyan Chaubey"), "Tailored HTML contains candidate name");
    }
  } catch (e) {
    assert(false, `Resume serving test failed: ${e.message}`);
  }

  // 12. Custom Portal Question Solver API test
  try {
    const resJobs = await fetch(`${BASE}/api/jobs`);
    const jobs = await resJobs.json();
    const target = jobs[0];

    const solveRes = await fetch(`${BASE}/api/jobs/${target._id}/solve-questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questions: ["Why are you interested in this position?", "What is your availability?"]
      }),
    });
    const solveData = await solveRes.json();
    assert(solveRes.status === 200, "POST /api/jobs/:id/solve-questions returns 200");
    assert(Array.isArray(solveData.answers) && solveData.answers.length === 2, `Solved 2 screening questions with DeepSeek`);
    assert(Boolean(solveData.answers[0]?.answer), `Answer 1 non-empty: "${solveData.answers[0]?.answer.substring(0, 60)}..."`);
  } catch (e) {
    assert(false, `Custom Question Solver test failed: ${e.message}`);
  }

  console.log("\n==================================================");
  console.log(`   TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");
}

runTests();
